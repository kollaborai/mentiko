#!/bin/bash
# complete-agent.sh - Clean shutdown + chain trigger
#
# usage:
#   complete-agent.sh <session-name>
#
# what it does:
#   1. captures final output from the agent session
#   2. checks agents/events/ for unprocessed events from this agent
#   3. kills agent session + its monitor session
#   4. marks event as processed
#   5. archives all events (prevents stale pickup)
#   6. checks if another agent spec has a trigger matching this event
#   7. if yes: auto-launches the next agent

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

source "$SCRIPT_DIR/config.sh" 2>/dev/null || true

PROJECT_ROOT="${MENTIKO_GLOBAL_ROOT:-$HOME/.mentiko}"
PROJECT_NAME=$(basename "$PROJECT_ROOT")

# source dependencies
source "$SCRIPT_DIR/session-transport.sh"
source "$SCRIPT_DIR/event-trigger.sh"

# -------------------------------------------------------------------

SESSION_NAME="${1:-}"

if [[ -z "$SESSION_NAME" ]]; then
    echo "usage: complete-agent.sh <session-name>"
    exit 1
fi

echo ""
echo "  completing agent: $SESSION_NAME"
echo "  ---"

# -------------------------------------------------------------------
# 1. capture final output
# -------------------------------------------------------------------

# REPORTS_DIR from config.sh
REPORT_DIR="${REPORTS_DIR}/agent-reports"
mkdir -p "$REPORT_DIR"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
REPORT_FILE="$REPORT_DIR/${SESSION_NAME}-${TIMESTAMP}.txt"

if transport_has_session "$SESSION_NAME" 2>/dev/null; then
    transport_capture "$SESSION_NAME" 2000 > "$REPORT_FILE" 2>/dev/null
    echo "  captured output: $REPORT_FILE"
else
    echo "  session already gone, skipping capture"
fi

# -------------------------------------------------------------------
# 2. find unprocessed events from this agent
# -------------------------------------------------------------------

TRIGGERED_EVENT=""
TRIGGERED_EVENT_NAME=""

# derive session prefix: strip project name and YYYYMMDD-HHMM date suffix
SESSION_PREFIX=$(echo "$SESSION_NAME" | sed "s/^${PROJECT_NAME}-//" | sed 's/-[0-9]\{8\}-[0-9]\{4\}$//')

echo "  session prefix: $SESSION_PREFIX"

# universal event parser: handles any format agents write
# key-value, AGENT EVENT: header, JSON, aliases
extract_event_field() {
    local file="$1"
    local field="$2"
    local value=""

    # try 1: key-value "field: value" (case insensitive)
    value=$(grep -im1 "^${field}:" "$file" 2>/dev/null | head -1 | sed "s/^[[:alpha:]]*:[[:space:]]*//" | sed 's/[[:space:]]*(.*//' || true)

    # try 2: "agent:" alias for "source:"
    if [[ -z "$value" && "$field" == "source" ]]; then
        value=$(grep -im1 "^agent:" "$file" 2>/dev/null | head -1 | sed 's/^[Aa]gent:[[:space:]]*//' | sed 's/[[:space:]]*(.*//' || true)
    fi

    # try 3: AGENT EVENT: format
    if [[ -z "$value" && "$field" == "event" ]]; then
        value=$(grep -im1 "AGENT EVENT:" "$file" 2>/dev/null | head -1 | sed 's/.*AGENT EVENT:[[:space:]]*//' | sed 's/[[:space:]]*=*$//' || true)
    fi

    # try 4: JSON "field": "value"
    if [[ -z "$value" ]]; then
        value=$(grep "\"${field}\"" "$file" 2>/dev/null | head -1 | sed "s/.*\"${field}\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/" || true)
    fi

    echo "$value"
}

# scan ALL files in events dir
for event_file in "$EVENTS_DIR"/*; do
    [[ -f "$event_file" ]] || continue
    [[ -d "$event_file" ]] && continue

    local_source=$(extract_event_field "$event_file" "source")
    local_processed=$(extract_event_field "$event_file" "processed")

    # fallback: match session prefix in filename
    if [[ -z "$local_source" ]]; then
        basename_file=$(basename "$event_file")
        if echo "$basename_file" | grep -qi "$SESSION_PREFIX" 2>/dev/null; then
            local_source="$SESSION_PREFIX"
            echo "  (source from filename: $basename_file)"
        fi
    fi

    if [[ "$local_processed" != "true" && -n "$local_source" ]]; then
        if [[ "$local_source" == "$SESSION_PREFIX" ]] || echo "$local_source" | grep -qi "$SESSION_PREFIX" 2>/dev/null; then
            TRIGGERED_EVENT_NAME=$(extract_event_field "$event_file" "event")
            if [[ -n "$TRIGGERED_EVENT_NAME" ]]; then
                TRIGGERED_EVENT="$event_file"
                echo "  found event: $TRIGGERED_EVENT_NAME (from $local_source) [$(basename "$event_file")]"
                break
            fi
        fi
    fi
done

# -------------------------------------------------------------------
# 3. kill agent session + monitor session
# -------------------------------------------------------------------

MONITOR_SESSION="monitor-${SESSION_NAME}"
if transport_session_exists "$MONITOR_SESSION" 2>/dev/null; then
    transport_kill_session "$MONITOR_SESSION"
    echo "  removed monitor: $MONITOR_SESSION"
fi

if transport_session_exists "$SESSION_NAME" 2>/dev/null; then
    transport_kill_session "$SESSION_NAME"
    echo "  removed agent: $SESSION_NAME"
fi

# kill subagent sessions
for sub_session in $(transport_list_sessions 2>/dev/null | grep "^${SESSION_NAME}-sub-" || true); do
    transport_kill_session "$sub_session"
    echo "  killed subagent: $sub_session"
done

# -------------------------------------------------------------------
# 4. mark event as processed
# -------------------------------------------------------------------

if [[ -n "$TRIGGERED_EVENT" ]]; then
    mark-processed "$TRIGGERED_EVENT" 2>/dev/null || true
    echo "  event marked processed: $TRIGGERED_EVENT_NAME"
fi

# -------------------------------------------------------------------
# 5. archive THIS agent's events to prevent stale pickup
# -------------------------------------------------------------------
# Scope to this completion's run + source only. A global sweep would archive
# parallel siblings' (and other concurrent runs') not-yet-processed completion
# events, stranding them (finding #6: archive-global-race). SESSION_PREFIX is
# this agent's owner key (the scoped matcher also accepts the superstring forms
# events are emitted under); the run id comes from the inherited env.
archive-run-events "${MENTIKO_RUN_ID:-${RUN_ID:-}}" "$SESSION_PREFIX" "${TRIGGERED_EVENT:-}"

# -------------------------------------------------------------------
# 6. find next agent to launch
# -------------------------------------------------------------------

if [[ -n "$TRIGGERED_EVENT_NAME" ]]; then
    echo ""
    echo "  checking for agents triggered by: $TRIGGERED_EVENT_NAME"

    # normalize event name: agents get creative on revision rounds
    # "RESEARCH COMPLETE - ROUND 2" -> "research-complete"
    # "proposal-drafted (revision)" -> "proposal-drafted"
    # only strip round/revision SUFFIXES (at end), not anywhere
    NORMALIZED_EVENT=$(echo "$TRIGGERED_EVENT_NAME" \
        | tr '[:upper:]' '[:lower:]' \
        | sed 's/[[:space:]]*-*[[:space:]]*round[[:space:]]*[0-9]*$//' \
        | sed 's/[[:space:]]*-*[[:space:]]*revision[[:space:]]*[0-9]*$//' \
        | sed 's/[[:space:]]*([^)]*)$//' \
        | sed 's/[[:space:]]\{1,\}/-/g' \
        | sed 's/^-\{1,\}//;s/-\{1,\}$//' \
        | sed 's/-\{1,\}/-/g')

    echo "  normalized event: $NORMALIZED_EVENT"

    # last resort: look up what the completing agent's spec SAYS it emits
    SPEC_EVENT=""
    for s in "$SPECS_DIR"/**/*.agent.md "$SPECS_DIR"/*.agent.md; do
        [[ -f "$s" ]] || continue
        local_prefix=$(grep -m1 "^session-prefix:" "$s" 2>/dev/null | sed 's/^session-prefix:[[:space:]]*//' | xargs || true)
        if [[ "$local_prefix" == "$SESSION_PREFIX" ]]; then
            SPEC_EVENT=$(grep '[[:space:]]event:' "$s" 2>/dev/null | grep -v '^[[:space:]]*-[[:space:]]*event:' | grep -v '^event:' | head -1 | sed 's/.*event:[[:space:]]*//' | xargs || true)
            if [[ -n "$SPEC_EVENT" ]]; then
                echo "  spec-defined event: $SPEC_EVENT"
            fi
            break
        fi
    done

    # two-pass: exact+normalized first, spec-defined only as last resort
    # spec-defined is dangerous because it ignores what agent ACTUALLY wrote
    NEXT_SPEC=""

    # pass 1: exact and normalized match
    while IFS= read -r spec_file; do
        [[ -f "$spec_file" ]] || continue
        if grep -qi "\- event:.*${TRIGGERED_EVENT_NAME}" "$spec_file" 2>/dev/null \
           || grep -qi "\- event:.*${NORMALIZED_EVENT}" "$spec_file" 2>/dev/null; then
            NEXT_SPEC="$spec_file"
            NEXT_AGENT=$(grep -m1 "^name:" "$spec_file" | sed 's/^name:[[:space:]]*//')
            echo "  found next agent: $NEXT_AGENT (match: exact/normalized)"
            echo "  spec: $spec_file"
            break
        fi
    done < <(find "$SPECS_DIR" -name "*.agent.md" -type f 2>/dev/null)

    # pass 2: spec-defined fallback (only if pass 1 found nothing)
    if [[ -z "$NEXT_SPEC" && -n "$SPEC_EVENT" ]]; then
        echo "  pass 1 failed. trying spec-defined event: $SPEC_EVENT"
        while IFS= read -r spec_file; do
            [[ -f "$spec_file" ]] || continue
            if grep -qi "\- event:.*${SPEC_EVENT}" "$spec_file" 2>/dev/null; then
                NEXT_SPEC="$spec_file"
                NEXT_AGENT=$(grep -m1 "^name:" "$spec_file" | sed 's/^name:[[:space:]]*//')
                echo "  found next agent: $NEXT_AGENT (match: spec-defined fallback)"
                echo "  spec: $spec_file"
                break
            fi
        done < <(find "$SPECS_DIR" -name "*.agent.md" -type f 2>/dev/null)
    fi

    # -------------------------------------------------------------------
    # 7. auto-launch next agent
    # -------------------------------------------------------------------

    if [[ -n "$NEXT_SPEC" ]]; then
        echo ""
        echo "  auto-launching next agent..."
        "$SCRIPT_DIR/launch-agent.sh" "$NEXT_SPEC" --monitor
    else
        echo "  no agent found with trigger for: $TRIGGERED_EVENT_NAME"
        echo "  chain complete."
    fi
else
    echo "  no event found. chain stops here."
fi

echo ""
echo "  complete-agent done."
