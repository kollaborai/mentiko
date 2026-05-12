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
emit-event() {
    local event_name="$1"
    local source_agent="$2"
    local data="${3:-}"

    if [[ -z "$event_name" || -z "$source_agent" ]]; then
        echo "usage: emit-event <event-name> <source-agent> [data]"
        return 1
    fi

    local timestamp=$(date +%Y%m%d-%H%M%S)
    local event_file="$EVENTS_DIR/${timestamp}-${event_name}.event"

    cat > "$event_file" <<EOF
event: $event_name
source: $source_agent
timestamp: $(date -Iseconds)
processed: false
data: $data
EOF

    echo "  event emitted: $event_name"
    echo "  file: $event_file"
    _sys_log "info" "event-trigger" "event written: $event_name" "source: $source_agent, file: $(basename "$event_file")"
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
# archive-all-events: move all events to archive dir
# called between chain steps to prevent stale event pickup
# -------------------------------------------------------------------
archive-all-events() {
    local archive_dir="$EVENTS_DIR/archive"
    mkdir -p "$archive_dir"
    local archived=0

    for event_file in "$EVENTS_DIR"/*; do
        [[ -f "$event_file" ]] || continue
        [[ -d "$event_file" ]] && continue
        mv "$event_file" "$archive_dir/" 2>/dev/null
        archived=$((archived + 1))
    done

    if [[ $archived -gt 0 ]]; then
        echo "  archived $archived event(s) to events/archive/"
    fi
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
export -f list-events
export -f mark-processed
export -f archive-all-events
export -f clean-events

echo "  mentiko: event functions loaded"
