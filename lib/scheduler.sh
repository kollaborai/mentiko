#!/bin/bash
# scheduler.sh - Cron-based chain scheduling
#
# provides:
# - cron expression parsing
# - next run calculation
# - schedule validation
# - due check for scheduled chains
#
# usage:
#   source scheduler.sh
#   should_run_chain <chain.json>
#   validate_cron <cron-expr>
#   get_schedule_state <chain-id>
#   update_schedule_state <chain-id> [timestamp]
#
# cli usage:
#   scheduler.sh check <chain.json>     # check if scheduled, run if due
#   scheduler.sh list                   # list all scheduled chains
#   scheduler.sh next <chain.json>      # show next scheduled run
#   scheduler.sh enable <chain.json>    # enable schedule
#   scheduler.sh disable <chain.json>   # disable schedule
#   scheduler daemon                    # run as background daemon

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# handle case where script is sourced (BASH_SOURCE may be empty)
if [[ -z "${BASH_SOURCE[0]:-}" ]]; then
    SCRIPT_DIR="$(pwd)"
fi

source "$SCRIPT_DIR/config.sh" 2>/dev/null || true
source "$SCRIPT_DIR/run-lib.sh" 2>/dev/null || true

# log crashes when run as standalone script
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    trap '_sys_log "error" "scheduler" "CRASHED at line $LINENO (exit $?)"' ERR
fi

# fallback to project root if config not loaded
PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"

# namespace config
NAMESPACE_ID="${NAMESPACE_ID:-default}"

# SCHEDULES_DIR from config.sh
mkdir -p "$SCHEDULES_DIR"

# -------------------------------------------------------------------
# state file for tracking last runs
# -------------------------------------------------------------------
STATE_FILE="$SCHEDULES_DIR/state.json"
[[ ! -f "$STATE_FILE" ]] && echo "{}" > "$STATE_FILE"

# -------------------------------------------------------------------
# get_schedule: read schedule from chain.json
# supports both old flat format and new nested format
# old: config.schedule = "0 9 * * *"
# new: config.schedule = {cron: "0 9 * * *", timezone: "UTC"}
# -------------------------------------------------------------------
get_schedule() {
    local chain_file="$1"
    # try nested format first
    local cron=$(jq -r '.config.schedule.cron // empty' "$chain_file" 2>/dev/null)
    if [[ -n "$cron" ]]; then
        echo "$cron"
        return 0
    fi
    # fallback to flat format
    jq -r '.config.schedule // empty' "$chain_file" 2>/dev/null
}

get_timezone() {
    local chain_file="$1"
    # try nested format first
    local tz=$(jq -r '.config.schedule.timezone // empty' "$chain_file" 2>/dev/null)
    if [[ -n "$tz" ]]; then
        echo "$tz"
        return 0
    fi
    # fallback to config.timezone
    jq -r '.config.timezone // "UTC"' "$chain_file" 2>/dev/null
}

# -------------------------------------------------------------------
# get_schedule_id: unique id for schedule state
# -------------------------------------------------------------------
get_schedule_id() {
    local chain_file="$1"
    # use relative path for portability (namespace-aware)
    local chain_dir="${CHAIN_DIR:-${MENTIKO_ORG_ROOT:-${MENTIKO_NAMESPACE_ROOT:-$HOME/.mentiko/namespaces/${NAMESPACE_ID:-default}}}/chains}"
    local rel_path="${chain_file#$chain_dir/}"
    echo "$rel_path" | tr '/' '_'
}

# -------------------------------------------------------------------
# validate_cron: check if cron expression is valid
# -------------------------------------------------------------------
# args: <cron-expr>
# outputs: "valid" or "invalid: reason"
validate_cron() {
    local cron="$1"

    local part_count=$(echo "$cron" | wc -w | tr -d ' ')
    if [[ $part_count -ne 5 && $part_count -ne 6 ]]; then
        echo "invalid: must have 5 or 6 space-separated parts"
        return 1
    fi

    echo "valid"
    return 0
}

# -------------------------------------------------------------------
# calculate_next_run: calculate next scheduled run time
# -------------------------------------------------------------------
# args: <cron-expr> [after-timestamp]
# outputs: unix timestamp of next run
calculate_next_run() {
    local cron_expr="$1"
    local current_time="${2:-$(date +%s)}"

    # try python croniter first
    local result=$(python3 - "$cron_expr" "$current_time" <<'PY' 2>/dev/null || echo "0"
from datetime import datetime
import sys
try:
    from croniter import croniter
    cron_expr = sys.argv[1]
    current_time = int(sys.argv[2])
    base = datetime.fromtimestamp(current_time)
    iter = croniter(cron_expr, base)
    print(int(iter.get_next(datetime).timestamp()))
except ImportError:
    print('0')
PY
)

    if [[ "$result" != "0" ]]; then
        echo "$result"
        return 0
    fi

    echo "0"
    return 1
}

# -------------------------------------------------------------------
# is_running: check if previous run is still active
# -------------------------------------------------------------------
# args: <schedule-id>
# outputs: "true" if running, "false" otherwise
is_running() {
    local schedule_id="$1"
    local lock_file="$SCHEDULES_DIR/${schedule_id}.lock"

    # check if lock file exists and is recent (within last hour)
    if [[ -f "$lock_file" ]]; then
        local lock_time=$(cat "$lock_file" 2>/dev/null)
        local now=$(date +%s)
        local age=$((now - lock_time))

        # if lock is less than 2 hours old, consider it running
        if [[ $age -lt 7200 ]]; then
            # also check if process still exists
            local pid_file="$SCHEDULES_DIR/${schedule_id}.pid"
            if [[ -f "$pid_file" ]]; then
                local pid=$(cat "$pid_file" 2>/dev/null)
                if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
                    echo "true"
                    return 0
                fi
            fi
        fi
        # stale lock, remove it
        rm -f "$lock_file"
    fi

    echo "false"
    return 0
}

# -------------------------------------------------------------------
# should_run_chain: check if chain is due to run
# -------------------------------------------------------------------
# args: <chain.json>
# outputs: "true" if due, "false" otherwise
should_run_chain() {
    local chain_file="$1"

    local cron_expr="$(get_schedule "$chain_file")"
    [[ -z "$cron_expr" ]] && { echo "false"; return 0; }

    is_enabled "$chain_file" || { echo "false"; return 0; }

    local schedule_id="$(get_schedule_id "$chain_file")"

    # skip if previous run is still active
    if [[ "$(is_running "$schedule_id")" == "true" ]]; then
        echo "false"
        return 0
    fi

    local last_run=$(get_schedule_state "$schedule_id")
    local now=$(date +%s)
    local next=$(calculate_next_run "$cron_expr" "$last_run")

    if [[ $next -le $now && $next -gt $last_run ]]; then
        echo "true"
    else
        echo "false"
    fi
}

# -------------------------------------------------------------------
# is_enabled: check if schedule is enabled
# -------------------------------------------------------------------
is_enabled() {
    local chain_file="$1"
    local schedule_id="$(get_schedule_id "$chain_file")"
    local status_file="$SCHEDULES_DIR/${schedule_id}.status"

    if [[ -f "$status_file" ]]; then
        grep -q "enabled: true" "$status_file" 2>/dev/null
    else
        # enabled by default if schedule exists
        [[ -n "$(get_schedule "$chain_file")" ]]
    fi
}

# -------------------------------------------------------------------
# get_schedule_state: get last run time
# -------------------------------------------------------------------
# args: <schedule-id>
# outputs: unix timestamp
get_schedule_state() {
    local schedule_id="$1"
    jq -r --arg id "$schedule_id" '.[$id] // 0' "$STATE_FILE" 2>/dev/null || echo "0"
}

# -------------------------------------------------------------------
# update_schedule_state: update last run time
# -------------------------------------------------------------------
# args: <schedule-id> [timestamp]
update_schedule_state() {
    local schedule_id="$1"
    local timestamp="${2:-$(date +%s)}"

    jq --arg id "$schedule_id" --arg ts "$timestamp" '.[$id] = ($ts | tonumber)' "$STATE_FILE" > "$STATE_FILE.tmp"
    mv "$STATE_FILE.tmp" "$STATE_FILE"
}

# -------------------------------------------------------------------
# mark_run_start: record execution start and create lock
# -------------------------------------------------------------------
mark_run_start() {
    local chain_file="$1"
    local schedule_id="$(get_schedule_id "$chain_file")"
    local lock_file="$SCHEDULES_DIR/${schedule_id}.lock"
    local pid_file="$SCHEDULES_DIR/${schedule_id}.pid"

    # write lock file with current timestamp
    date +%s > "$lock_file"

    # write pid file
    echo $$ > "$pid_file"
}

# -------------------------------------------------------------------
# mark_run_end: record execution end and remove lock
# -------------------------------------------------------------------
mark_run_end() {
    local chain_file="$1"
    local status="${2:-success}"
    local schedule_id="$(get_schedule_id "$chain_file")"

    # update state
    update_schedule_state "$schedule_id"

    # remove lock and pid files
    local lock_file="$SCHEDULES_DIR/${schedule_id}.lock"
    local pid_file="$SCHEDULES_DIR/${schedule_id}.pid"
    rm -f "$lock_file" "$pid_file"

    # record in history
    local now=$(date -Iseconds)
    local history_file="$SCHEDULES_DIR/${schedule_id}.history"
    echo "[$now] $status" >> "$history_file"
}

# -------------------------------------------------------------------
# mark_run: record execution time (legacy, use mark_run_start/end)
# -------------------------------------------------------------------
mark_run() {
    local chain_file="$1"
    local status="${2:-success}"
    mark_run_end "$chain_file" "$status"
}

# -------------------------------------------------------------------
# cmd_check: check and run if due
# -------------------------------------------------------------------
cmd_check() {
    local chain_file="$1"

    [[ ! -f "$chain_file" ]] && {
        echo "error: chain file not found: $chain_file"
        return 1
    }

    local schedule="$(get_schedule "$chain_file")"
    [[ -z "$schedule" ]] && {
        echo "no schedule configured"
        return 0
    }

    if [[ "$(should_run_chain "$chain_file")" == "true" ]]; then
        local chain_name=$(jq -r '.name' "$chain_file")
        local schedule_id="$(get_schedule_id "$chain_file")"
        echo "running scheduled chain: $chain_name ($schedule)"
        _sys_log "info" "scheduler" "schedule fired: $chain_name" "cron: $schedule, chain: $chain_file"

        # mark start
        mark_run_start "$chain_file"

        local runner="$SCRIPT_DIR/chain-runner.sh"
        if [[ -f "$runner" ]]; then
            "$runner" "$chain_file"
            local exit_code=$?

            if [[ $exit_code -eq 0 ]]; then
                mark_run_end "$chain_file" "success"
            else
                mark_run_end "$chain_file" "failed"
            fi
        else
            echo "error: chain-runner.sh not found"
            _sys_log "error" "scheduler" "chain-runner.sh not found" "chain: $chain_file"
            mark_run_end "$chain_file" "failed"
            return 1
        fi
    fi
}

# -------------------------------------------------------------------
# cmd_list: list all scheduled chains
# -------------------------------------------------------------------
cmd_list() {
    echo "scheduled chains:"
    echo ""

    local chain_dir="${CHAIN_DIR:-${MENTIKO_ORG_ROOT:-${MENTIKO_NAMESPACE_ROOT:-$HOME/.mentiko/namespaces/${NAMESPACE_ID:-default}}}/chains}"

    find "$chain_dir" -name "chain.json" 2>/dev/null | while read -r chain_file; do
        local schedule="$(get_schedule "$chain_file")"
        [[ -z "$schedule" ]] && continue

        local chain_name=$(jq -r '.name' "$chain_file")
        local schedule_id="$(get_schedule_id "$chain_file")"
        local last_run=$(get_schedule_state "$schedule_id")

        local status="enabled"
        if ! is_enabled "$chain_file"; then
            status="disabled"
        fi

        local last_run_date="never"
        if [[ "$last_run" != "0" ]]; then
            last_run_date=$(date -r "$last_run" +%Y-%m-%d\ %H:%M:%S 2>/dev/null || date -d "@$last_run" +%Y-%m-%d\ %H:%M:%S)
        fi

        local next_run=$(calculate_next_run "$schedule")
        local next_run_date="unknown"
        if [[ "$next_run" != "0" ]]; then
            next_run_date=$(date -r "$next_run" +%Y-%m-%d\ %H:%M:%S 2>/dev/null || date -d "@$next_run" +%Y-%m-%d\ %H:%M:%S)
        fi

        printf "  %s\n" "$chain_name"
        printf "    schedule: %s\n" "$schedule"
        printf "    status:   %s\n" "$status"
        printf "    last:     %s\n" "$last_run_date"
        printf "    next:     %s\n" "$next_run_date"
        echo ""
    done
}

# -------------------------------------------------------------------
# cmd_next: show next run time
# -------------------------------------------------------------------
cmd_next() {
    local chain_file="$1"

    [[ ! -f "$chain_file" ]] && {
        echo "error: chain file not found: $chain_file"
        return 1
    }

    local schedule="$(get_schedule "$chain_file")"
    [[ -z "$schedule" ]] && {
        echo "no schedule configured"
        return 0
    }

    local now=$(date +%s)
    local next=$(calculate_next_run "$schedule" "$now")

    if [[ "$next" -gt 0 ]]; then
        local next_date=$(date -r "$next" +%Y-%m-%d\ %H:%M:%S 2>/dev/null || date -d "@$next" +%Y-%m-%d\ %H:%M:%S)
        echo "next run: $next_date"
    else
        echo "could not calculate next run (install python-croniter)"
    fi
}

# -------------------------------------------------------------------
# cmd_enable/disable: toggle schedule
# -------------------------------------------------------------------
cmd_enable() {
    local chain_file="$1"
    local schedule_id="$(get_schedule_id "$chain_file")"
    local status_file="$SCHEDULES_DIR/${schedule_id}.status"

    echo "enabled: true" > "$status_file"
    echo "schedule enabled"
}

cmd_disable() {
    local chain_file="$1"
    local schedule_id="$(get_schedule_id "$chain_file")"
    local status_file="$SCHEDULES_DIR/${schedule_id}.status"

    echo "enabled: false" > "$status_file"
    echo "schedule disabled"
}

# -------------------------------------------------------------------
# cmd_daemon: run as background daemon
# -------------------------------------------------------------------
cmd_daemon() {
    local check_interval="${1:-60}"

    echo "scheduler daemon started (interval: ${check_interval}s)"
    echo "pid: $$"

    while true; do
        local chain_dir="${CHAIN_DIR:-${MENTIKO_ORG_ROOT:-${MENTIKO_NAMESPACE_ROOT:-$HOME/.mentiko/namespaces/${NAMESPACE_ID:-default}}}/chains}"

        find "$chain_dir" -name "chain.json" 2>/dev/null | while read -r chain_file; do
            cmd_check "$chain_file" &
        done

        wait
        sleep "$check_interval"
    done
}

# -------------------------------------------------------------------
# main - only run when executed directly, not sourced
# -------------------------------------------------------------------

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then

COMMAND="${1:-}"
shift || true

case "$COMMAND" in
    check)
        [[ -z "${1:-}" ]] && { echo "usage: scheduler.sh check <chain.json>"; exit 1; }
        cmd_check "$@"
        ;;
    list)
        cmd_list
        ;;
    next)
        [[ -z "${1:-}" ]] && { echo "usage: scheduler.sh next <chain.json>"; exit 1; }
        cmd_next "$@"
        ;;
    enable)
        [[ -z "${1:-}" ]] && { echo "usage: scheduler.sh enable <chain.json>"; exit 1; }
        cmd_enable "$@"
        ;;
    disable)
        [[ -z "${1:-}" ]] && { echo "usage: scheduler.sh disable <chain.json>"; exit 1; }
        cmd_disable "$@"
        ;;
    daemon)
        cmd_daemon "$@"
        ;;
    *)
        echo "usage: scheduler.sh <command> [args]"
        echo ""
        echo "commands:"
        echo "  check <chain.json>     check and run if due"
        echo "  list                   list all scheduled chains"
        echo "  next <chain.json>      show next scheduled run"
        echo "  enable <chain.json>    enable schedule"
        echo "  disable <chain.json>   disable schedule"
        echo "  daemon [interval]      run as daemon (default: 60s)"
        exit 1
        ;;
esac

fi  # end of "run only when executed directly" check
