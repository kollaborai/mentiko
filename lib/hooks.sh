#!/bin/bash
# hooks.sh - shared hook runner for watchdog events
#
# drop executable .sh scripts in watchdog-hooks/
# they receive: $1=event_type $2=run_id $3=details_json
#
# event types:
#   run-stalled    - watchdog detected stalled run
#   run-completed  - chain finished successfully
#   run-error      - chain hit an error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh" 2>/dev/null || true

# WATCHDOG_HOOKS_DIR from config.sh (project-level)
_HOOKS_DIR="${WATCHDOG_HOOKS_DIR}"

mkdir -p "$_HOOKS_DIR"

# run all hooks for a given event type
# usage: run_hooks <event_type> <run_id> <details_json>
run_hooks() {
    local event_type="$1"
    local run_id="$2"
    local details="$3"

    for hook in "$_HOOKS_DIR"/*.sh; do
        [[ -x "$hook" ]] || continue
        (bash "$hook" "$event_type" "$run_id" "$details" 2>/dev/null) &
    done
}
