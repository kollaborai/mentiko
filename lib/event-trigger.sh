#!/bin/bash
# event-trigger.sh - File-based event system for mentiko
#
# usage:
#   source event-trigger.sh
#   emit-event <event-name> <source-agent> [data]
#   list-events [--unprocessed]
#   mark-processed <event-file>
#   archive-all-events

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/run-lib.sh" 2>/dev/null || true

# use EVENTS_DIR from config.sh if already set, otherwise resolve
if [[ -z "${EVENTS_DIR:-}" ]]; then
    EVENTS_DIR="${MENTIKO_PROJECT_ROOT:-${MENTIKO_NAMESPACE_ROOT:-$HOME/.mentiko/namespaces/${NAMESPACE_ID:-default}}}/events"
fi
mkdir -p "$EVENTS_DIR"

# -------------------------------------------------------------------
# emit-event: write an event file
# -------------------------------------------------------------------
event-filename-component() {
    local value="${1:-}"
    value="$(printf '%s' "$value" | LC_ALL=C sed 's#[/[:cntrl:]]#_#g; s#[^A-Za-z0-9._-]#_#g')"
    case "$value" in
        ""|"."|"..") value="_" ;;
    esac
    printf '%s' "$value"
}

emit-event() {
    local event_name="$1"
    local source_agent="$2"
    local data="${3:-}"

    if [[ -z "$event_name" || -z "$source_agent" ]]; then
        echo "usage: emit-event <event-name> <source-agent> [data]"
        return 1
    fi

    local run_id="${MENTIKO_RUN_ID:-${RUN_ID:-}}"
    # canonical event naming: ${run_id}-${source}-${event}.event (run_id prefix dropped
    # when empty for manual CLI use). the completion matcher keys off the source: field,
    # not the filename, but a stable predictable name lets it infer source from the
    # filename as a fallback. the OLD timestamp scheme (${timestamp}-${event}.event) was
    # the bug source: LLM agents couldn't reproduce it, so emitted events went unmatched.
    local source_file_part
    local event_file_part
    source_file_part="$(event-filename-component "$source_agent")"
    event_file_part="$(event-filename-component "$event_name")"
    local event_file="$EVENTS_DIR/${run_id:+${run_id}-}${source_file_part}-${event_file_part}.event"

    mkdir -p "$EVENTS_DIR"
    # NOTE: no heredoc here. emit-event is `export -f`'d and inherited by nearly every
    # engine subshell; a heredoc body can fail to serialize through export -f on some bash
    # builds (the _perf_ensure_file incident), breaking child-shell startup. printf is safe
    # and byte-identical to the old heredoc (test-agent-emit asserts the body).
    if ! printf 'event: %s\nsource: %s\nrun_id: %s\ntimestamp: %s\nprocessed: false\ndata: %s\n' \
        "$event_name" "$source_agent" "$run_id" "$(date -Iseconds)" "$data" > "$event_file"
    then
        echo "error: failed to write event file: $event_file" >&2
        return 1
    fi

    echo "  event emitted: $event_name"
    echo "  file: $event_file"
    _sys_log "info" "event-trigger" "event written: $event_name" "source: $source_agent, file: $(basename "$event_file")" || true
}

# -------------------------------------------------------------------
# list-events: show all events, optionally filter unprocessed
# -------------------------------------------------------------------
list-events() {
    local filter="${1:-}"

    echo ""
    echo "  events:"
    echo "  ---"

    local found=0
    for event_file in "$EVENTS_DIR"/*; do
        [[ -f "$event_file" ]] || continue
        [[ -d "$event_file" ]] && continue
        found=1

        local event=$(grep -im1 "^event:" "$event_file" 2>/dev/null | sed 's/^[Ee]vent:[[:space:]]*//' || true)
        local source=$(grep -im1 "^source:" "$event_file" 2>/dev/null | sed 's/^[Ss]ource:[[:space:]]*//' || true)
        local timestamp=$(grep -im1 "^timestamp:" "$event_file" 2>/dev/null | sed 's/^[Tt]imestamp:[[:space:]]*//' || true)
        local processed=$(grep -im1 "^processed:" "$event_file" 2>/dev/null | sed 's/^[Pp]rocessed:[[:space:]]*//' || true)

        if [[ "$filter" == "--unprocessed" && "$processed" == "true" ]]; then
            continue
        fi

        local status_icon="o"
        [[ "$processed" == "true" ]] && status_icon="x"

        printf "  %s  %-25s  from: %-25s  %s\n" "$status_icon" "$event" "$source" "$timestamp"
    done

    if [[ $found -eq 0 ]]; then
        echo "  no events found"
    fi
    echo ""
}

# -------------------------------------------------------------------
# mark-processed: mark an event as processed
# handles any format - agents write events unpredictably
# -------------------------------------------------------------------
mark-processed() {
    local event_file="$1"

    if [[ -z "$event_file" ]]; then
        echo "usage: mark-processed <event-file>"
        return 1
    fi

    if [[ ! -f "$event_file" ]]; then
        event_file="$EVENTS_DIR/$event_file"
    fi

    if [[ ! -f "$event_file" ]]; then
        echo "error: event file not found"
        return 1
    fi

    # check if file already has processed field
    if grep -qi "processed" "$event_file" 2>/dev/null; then
        local tmp_file="${event_file}.tmp"
        sed 's/^processed: false/processed: true/' "$event_file" > "$tmp_file"
        mv "$tmp_file" "$event_file"
    else
        # no processed field - append it
        echo "" >> "$event_file"
        echo "processed: true" >> "$event_file"
    fi
    echo "  marked processed: $(basename "$event_file")"
}

# -------------------------------------------------------------------
# _event-field: read a single "key: value" field from an event file.
# Splits on the FIRST colon, exactly like the consumer parsers
# (web/lib/runs/run-reconciler.ts parseEventRecord, indexOf(":")) so a value
# that itself contains colons (URLs, ISO timestamps in data:) never corrupts
# the field we extract. Case-insensitive on the key. Echoes the trimmed value
# (empty if absent). This is the field-read primitive the scoped archive below
# relies on instead of parsing the filename.
# -------------------------------------------------------------------
_event-field() {
    local file="$1" field="$2"
    [[ -f "$file" ]] || { printf ''; return 0; }
    # grep the first matching "key:" line (anchored, case-insensitive), then
    # strip everything up to and including the first colon, then trim spaces.
    grep -im1 "^${field}:" "$file" 2>/dev/null \
        | sed "s/^[^:]*:[[:space:]]*//" \
        | sed 's/[[:space:]]*$//' \
        | head -1
}

# -------------------------------------------------------------------
# _event-belongs-to: decide whether an event file is OWNED by the completion
# identified by <run_id> + <source> (the agent's source/session prefix), and
# may therefore be archived by it. Returns 0 (owned) / 1 (not owned).
#
# WHY FIELD-READ, NOT FILENAME-PARSE: the canonical name is
#   ${run_id}-${source}-${event}.event
# but run_id ("run-1700000000"), source ("route-coverage"), and event
# ("agent-complete") all legitimately contain hyphens, so splitting the
# filename on "-" is ambiguous and unreliable. The diagnostic scheme
# (${ts}-${run_id}-${agent_id}-${event}.event) is different again. BOTH schemes
# carry the authoritative run_id:/source: (and agent:) FIELDS inside the file,
# parsed the same way every consumer parses them — so we key off the fields.
#
# OWNERSHIP RULE (scoped to THIS completion, never a sibling):
#   1. run_id must match. A file whose run_id field differs belongs to another
#      run and MUST survive (cross-run isolation). A file with NO run_id is
#      treated as run-agnostic and judged on source alone (covers manual/CLI
#      events and the run-less fallback name).
#   2. source must be THIS agent. We accept an exact match OR the superstring
#      relationship the completion matcher itself uses
#      (run-reconciler source.includes(agentId)): the file's source contains
#      our source, or our source contains the file's source (session prefixes
#      like "researcher-7f3a" vs agent id "researcher"). Diagnostic events use
#      `source: monitor`/`source: chain-runner-complete` but ALSO carry
#      `agent: <id>`; we additionally match on that agent field so a diagnostic
#      for THIS agent is archived while a sibling's is not.
#   A file with neither a readable source nor agent field falls back to a
#   filename containment check against our source (last resort).
# -------------------------------------------------------------------
_event-belongs-to() {
    local file="$1" run_id="$2" src="$3"
    [[ -f "$file" ]] || return 1
    [[ -n "$src" ]] || return 1   # without an owner identity we never claim it

    local f_run f_src f_agent
    f_run="$(_event-field "$file" run_id)"
    f_src="$(_event-field "$file" source)"
    f_agent="$(_event-field "$file" agent)"

    # run scoping: a populated, mismatched run_id means a DIFFERENT run -> not ours.
    if [[ -n "$run_id" && -n "$f_run" && "$f_run" != "$run_id" ]]; then
        return 1
    fi

    # source/agent scoping (superstring both ways, mirroring the matcher).
    local candidate
    for candidate in "$f_src" "$f_agent"; do
        [[ -z "$candidate" ]] && continue
        if [[ "$candidate" == "$src" ]] \
           || [[ "$candidate" == *"$src"* ]] \
           || [[ "$src" == *"$candidate"* ]]; then
            return 0
        fi
    done

    # last resort: neither source nor agent field readable. Match on filename
    # containment of our source (the file at least names this agent).
    if [[ -z "$f_src" && -z "$f_agent" ]]; then
        case "$(basename "$file")" in
            *"$src"*) return 0 ;;
        esac
    fi

    return 1
}

# -------------------------------------------------------------------
# archive-run-events: archive ONLY the events this completion owns —
# its own triggered/processed event plus events whose run_id+source identify
# them as belonging to THIS run AND THIS agent. Sibling agents' events and
# other runs' events are left untouched (finding #6: archive-global-race).
#
# usage: archive-run-events <run_id> <source> [triggered_event_file]
#   <run_id>                this completion's run id (may be empty for CLI use)
#   <source>                this agent's source / session prefix (the owner key)
#   [triggered_event_file]  the specific event this completion processed; it is
#                           always archived even if its fields are unreadable,
#                           because the caller proved it owns it.
# -------------------------------------------------------------------
archive-run-events() {
    local run_id="$1"
    local src="$2"
    local triggered="${3:-}"

    local archive_dir="$EVENTS_DIR/archive"
    mkdir -p "$archive_dir"
    local archived=0
    local survived=0

    # 1. the explicitly-owned triggered event: always archive it.
    if [[ -n "$triggered" && -f "$triggered" ]]; then
        if mv "$triggered" "$archive_dir/" 2>/dev/null; then
            archived=$((archived + 1))
        fi
    fi

    # 2. every other event in the shared dir: archive only if it belongs to this
    #    run+agent; otherwise leave it for its own owner (sibling / other run).
    local event_file
    for event_file in "$EVENTS_DIR"/*; do
        [[ -f "$event_file" ]] || continue
        [[ -d "$event_file" ]] && continue
        if _event-belongs-to "$event_file" "$run_id" "$src"; then
            if mv "$event_file" "$archive_dir/" 2>/dev/null; then
                archived=$((archived + 1))
            fi
        else
            survived=$((survived + 1))
        fi
    done

    if [[ $archived -gt 0 ]]; then
        echo "  archived $archived event(s) for run '${run_id:-<none>}' source '${src:-<none>}' to events/archive/ ($survived left for other owners)"
    fi
}

# -------------------------------------------------------------------
# archive-all-events: BACK-COMPAT shim. Historically this moved EVERY file in
# the shared $EVENTS_DIR to archive on each completion — under parallel agents
# (fan-out) or concurrent runs the first completer archived sibling/other-run
# completion events that were never processed, so those siblings hung or fell
# into the (post-#2 failing) fallback (finding #6).
#
# It is now SCOPED: with arguments it delegates to archive-run-events (the
# correct, owned-only behavior). With NO arguments it scopes to the ambient
# run/source from the environment, never to a true global sweep — the global
# wipe is the bug and is not restored. (Stale archived files are pruned
# separately by clean-events, the explicitly-invoked broom; we do not add a new
# one here.)
# -------------------------------------------------------------------
archive-all-events() {
    local run_id="${1:-${MENTIKO_RUN_ID:-${RUN_ID:-}}}"
    local src="${2:-${MENTIKO_AGENT_SOURCE:-${SESSION_PREFIX:-${MENTIKO_AGENT_ID:-}}}}"
    local triggered="${3:-}"
    archive-run-events "$run_id" "$src" "$triggered"
}

# -------------------------------------------------------------------
# clean-events: remove archived events older than N days
# -------------------------------------------------------------------
clean-events() {
    local days="${1:-7}"
    find "$EVENTS_DIR/archive" -type f -mtime "+$days" -exec rm {} \; 2>/dev/null
    echo "  cleaned archived events older than ${days} days"
}

# exports
export -f emit-event
export -f event-filename-component
export -f list-events
export -f mark-processed
export -f _event-field
export -f _event-belongs-to
export -f archive-run-events
export -f archive-all-events
export -f clean-events

echo "  mentiko: event functions loaded"
