#!/bin/bash
# chain-event-watcher.sh - Event-driven cross-chain trigger daemon
#
# watches the namespace events dir for new events.
# when an event matches a chain's event_triggers config,
# launches that chain automatically (optionally with conditions).
#
# chain.json config format:
#   {
#     "config": {
#       "event_triggers": [
#         {
#           "event": "review-approved",          # event name to watch
#           "source_chain": "code-review",       # optional: only from this chain
#           "condition": "",                      # optional: bash expression on data
#           "pass_data": true                    # pass event data as CHAIN_INPUT env
#         }
#       ]
#     }
#   }
#
# usage:
#   chain-event-watcher.sh [--interval N] [--namespace NS] [--oneshot]
#   (typically run as a background daemon via pty-manager)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh"
source "$SCRIPT_DIR/run-lib.sh" 2>/dev/null || true

# log crashes (set -e exits)
trap '_sys_log "error" "chain-watcher" "CRASHED at line $LINENO (exit $?)"' ERR

POLL_INTERVAL="${CHAIN_WATCHER_INTERVAL:-10}"
NAMESPACE_ID="${NAMESPACE_ID:-default}"
ONESHOT=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --interval) POLL_INTERVAL="$2"; shift 2 ;;
        --namespace) NAMESPACE_ID="$2"; shift 2 ;;
        --oneshot) ONESHOT=true; shift ;;
        *) shift ;;
    esac
done

PROJECT_ROOT="${MENTIKO_GLOBAL_ROOT:-$HOME/.mentiko}"
# EVENTS_DIR, CHAINS_DIR, RUNTIME_DIR from config.sh
WATCHER_STATE_DIR="${RUNTIME_DIR}/chain-watcher"
WATCHER_LOG="$WATCHER_STATE_DIR/watcher.log"

mkdir -p "$WATCHER_STATE_DIR"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [chain-watcher] $*" | tee -a "$WATCHER_LOG"
}

# -------------------------------------------------------------------
# load_chain_triggers: scan all chains and collect event_triggers
# returns JSON array: [{chain_name, chain_path, event, source_chain, condition, pass_data}]
# -------------------------------------------------------------------
load_chain_triggers() {
    local triggers="[]"

    if [[ ! -d "$CHAINS_DIR" ]]; then
        echo "$triggers"
        return
    fi

    for chain_dir in "$CHAINS_DIR"/*/; do
        [[ -d "$chain_dir" ]] || continue
        local chain_file="$chain_dir/chain.json"
        [[ -f "$chain_file" ]] || continue

        local chain_name
        chain_name=$(basename "$chain_dir")

        # extract event_triggers from config
        local chain_triggers
        chain_triggers=$(jq -r --arg cname "$chain_name" --arg cpath "$chain_file" '
            .config.event_triggers // [] |
            map(. + {chain_name: $cname, chain_path: $cpath})
        ' "$chain_file" 2>/dev/null || echo "[]")

        if [[ "$chain_triggers" != "[]" && -n "$chain_triggers" ]]; then
            triggers=$(echo "$triggers $chain_triggers" | jq -s '.[0] + .[1]')
        fi
    done

    echo "$triggers"
}

# -------------------------------------------------------------------
# match_trigger: check if an event matches a trigger config
# args: event_name source_chain event_data trigger_json
# returns 0 (match) or 1 (no match)
# -------------------------------------------------------------------
match_trigger() {
    local event_name="$1"
    local event_source="$2"
    local event_data="$3"
    local trigger="$4"

    # check event name matches
    local trigger_event
    trigger_event=$(echo "$trigger" | jq -r '.event // ""')
    [[ "$trigger_event" == "$event_name" ]] || return 1

    # check source_chain filter (optional)
    local trigger_source
    trigger_source=$(echo "$trigger" | jq -r '.source_chain // ""')
    if [[ -n "$trigger_source" && "$trigger_source" != "$event_source" ]]; then
        return 1
    fi

    # check condition (optional bash expression evaluated with event_data in scope)
    local condition
    condition=$(echo "$trigger" | jq -r '.condition // ""')
    if [[ -n "$condition" ]]; then
        # export event data fields for condition evaluation
        local data="$event_data"
        # simple evaluation: condition can reference $data or check strings
        if ! eval "[[ $condition ]]" 2>/dev/null; then
            return 1
        fi
    fi

    return 0
}

# -------------------------------------------------------------------
# process_event: check an event file against all triggers, fire matches
# -------------------------------------------------------------------
process_event() {
    local event_file="$1"
    local triggers="$2"

    # parse event fields
    local event_name event_source event_data
    event_name=$(grep -im1 "^event:" "$event_file" 2>/dev/null | sed 's/^[Ee]vent:[[:space:]]*//' || echo "")
    event_source=$(grep -im1 "^source:" "$event_file" 2>/dev/null | sed 's/^[Ss]ource:[[:space:]]*//' || echo "")
    event_data=$(grep -im1 "^data:" "$event_file" 2>/dev/null | sed 's/^[Dd]ata:[[:space:]]*//' || echo "")
    local processed
    processed=$(grep -im1 "^processed:" "$event_file" 2>/dev/null | sed 's/^[Pp]rocessed:[[:space:]]*//' | tr '[:upper:]' '[:lower:]' || echo "false")

    # skip already-processed events
    [[ "$processed" == "true" ]] && return 0
    [[ -z "$event_name" ]] && return 0

    # check if we already handled this event (state file)
    local event_key
    event_key=$(basename "$event_file")
    local handled_file="$WATCHER_STATE_DIR/handled/${event_key}"
    if [[ -f "$handled_file" ]]; then
        return 0
    fi

    # check each trigger
    local trigger_count
    trigger_count=$(echo "$triggers" | jq 'length')
    local fired=false

    for ((i=0; i<trigger_count; i++)); do
        local trigger
        trigger=$(echo "$triggers" | jq ".[$i]")

        if match_trigger "$event_name" "$event_source" "$event_data" "$trigger"; then
            local chain_name chain_path
            chain_name=$(echo "$trigger" | jq -r '.chain_name')
            chain_path=$(echo "$trigger" | jq -r '.chain_path')

            if [[ ! -f "$chain_path" ]]; then
                log "warn: chain not found: $chain_path"
                continue
            fi

            local pass_data
            pass_data=$(echo "$trigger" | jq -r '.pass_data // false')

            log "trigger match: event=$event_name -> chain=$chain_name"
            _sys_log "info" "chain-watcher" "event matched: $event_name -> chain $chain_name" "source: $event_source, chain_path: $chain_path"

            # spawn the chain (detached, survives this script)
            local run_log="$WATCHER_STATE_DIR/runs/${chain_name}-$(date +%Y%m%d-%H%M%S).log"
            mkdir -p "$(dirname "$run_log")"

            local env_extra=""
            if [[ "$pass_data" == "true" && -n "$event_data" ]]; then
                env_extra="CHAIN_INPUT=$(printf '%q' "$event_data") CHAIN_TRIGGER_EVENT=$(printf '%q' "$event_name") CHAIN_TRIGGER_SOURCE=$(printf '%q' "$event_source")"
            fi

            NAMESPACE_ID="$NAMESPACE_ID" \
            CHAIN_TRIGGER_EVENT="$event_name" \
            CHAIN_TRIGGER_SOURCE="$event_source" \
            CHAIN_INPUT="${pass_data:+$event_data}" \
                nohup bash "$SCRIPT_DIR/chain-runner.sh" "$chain_path" \
                > "$run_log" 2>&1 &
            disown

            log "launched chain: $chain_name (pid: $!)"
            _sys_log "info" "chain-watcher" "chain launched: $chain_name" "event: $event_name, source: $event_source, pid: $!"
            fired=true
        fi
    done

    # record as handled to avoid double-firing
    if [[ "$fired" == "true" ]]; then
        mkdir -p "$(dirname "$handled_file")"
        echo "$(date -Iseconds)" > "$handled_file"
    fi
}

# -------------------------------------------------------------------
# clean_handled: prune handled state older than 24h
# -------------------------------------------------------------------
clean_handled() {
    local handled_dir="$WATCHER_STATE_DIR/handled"
    [[ -d "$handled_dir" ]] || return 0
    find "$handled_dir" -type f -mtime +1 -delete 2>/dev/null || true
}

# -------------------------------------------------------------------
# main loop
# -------------------------------------------------------------------
log "started (interval=${POLL_INTERVAL}s, namespace=${NAMESPACE_ID})"

iteration=0
while true; do
    iteration=$((iteration + 1))

    # reload triggers every 60 iterations (or on first run)
    if (( iteration % 6 == 1 )); then
        TRIGGERS=$(load_chain_triggers)
        trigger_count=$(echo "$TRIGGERS" | jq 'length')
        [[ $trigger_count -gt 0 ]] && log "loaded $trigger_count trigger(s)"
    fi

    # process new events
    if [[ -d "$EVENTS_DIR" ]]; then
        for event_file in "$EVENTS_DIR"/*.event; do
            [[ -f "$event_file" ]] || continue
            process_event "$event_file" "$TRIGGERS"
        done
    fi

    # periodic cleanup every ~10 minutes
    (( iteration % 60 == 0 )) && clean_handled

    if [[ "$ONESHOT" == "true" ]]; then
        break
    fi

    sleep "$POLL_INTERVAL"
done

log "stopped"
