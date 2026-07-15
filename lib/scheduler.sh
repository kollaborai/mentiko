#!/bin/bash
# Thin shell boundary for typed embedded-chain schedule contracts.
# The TypeScript background worker owns the scheduler loop; this compatibility
# surface only performs an actual chain-runner invocation when explicitly asked.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh" 2>/dev/null || true

_schedule_contract_cli() {
    local code_root="${MENTIKO_CODE_ROOT:?MENTIKO_CODE_ROOT must be configured}"
    local cli="$code_root/lib/runner-schedule-contract.js"
    [[ -f "$cli" ]] || { echo "typed schedule contract runtime is unavailable: $cli" >&2; return 1; }
    node "$cli" "$@"
}

_schedule_args() {
    printf '%s\n' --chain-dir "${CHAIN_DIR:?CHAIN_DIR must be configured}" --schedules-dir "${SCHEDULES_DIR:?SCHEDULES_DIR must be configured}"
}

_schedule_contract_cli state-init --schedules-dir "${SCHEDULES_DIR:?SCHEDULES_DIR must be configured}"

get_schedule() { _schedule_contract_cli field --chain-path "$1" --chain-dir "${CHAIN_DIR:?CHAIN_DIR must be configured}" --field cron; }
get_timezone() { _schedule_contract_cli field --chain-path "$1" --chain-dir "${CHAIN_DIR:?CHAIN_DIR must be configured}" --field timezone; }
get_schedule_id() { _schedule_contract_cli field --chain-path "$1" --chain-dir "${CHAIN_DIR:?CHAIN_DIR must be configured}" --field id; }

validate_cron() {
    local output
    if output="$(_schedule_contract_cli validate-cron --cron "$1")"; then printf '%s\n' "$output"; return 0; fi
    printf '%s\n' "$output"
    return 1
}

calculate_next_run() { _schedule_contract_cli next --cron "$1" --after "${2:-$(date +%s)}"; }
get_schedule_state() { _schedule_contract_cli state-get --schedules-dir "${SCHEDULES_DIR:?SCHEDULES_DIR must be configured}" --schedule-id "$1"; }
update_schedule_state() { _schedule_contract_cli state-set --schedules-dir "${SCHEDULES_DIR:?SCHEDULES_DIR must be configured}" --schedule-id "$1" --timestamp "${2:-$(date +%s)}"; }

is_enabled() {
    [[ "$(_schedule_contract_cli enabled --chain-path "$1" --chain-dir "${CHAIN_DIR:?CHAIN_DIR must be configured}" --schedules-dir "${SCHEDULES_DIR:?SCHEDULES_DIR must be configured}")" == "true" ]]
}

is_running() {
    [[ "$(_schedule_contract_cli running --schedules-dir "${SCHEDULES_DIR:?SCHEDULES_DIR must be configured}" --schedule-id "$1")" == "true" ]] && echo "true" || echo "false"
}

should_run_chain() {
    [[ "$(_schedule_contract_cli due --chain-path "$1" --chain-dir "${CHAIN_DIR:?CHAIN_DIR must be configured}" --schedules-dir "${SCHEDULES_DIR:?SCHEDULES_DIR must be configured}")" == "true" ]] && echo "true" || echo "false"
}

mark_run_start() { _schedule_contract_cli mark-start --chain-path "$1" --chain-dir "${CHAIN_DIR:?CHAIN_DIR must be configured}" --schedules-dir "${SCHEDULES_DIR:?SCHEDULES_DIR must be configured}" --pid "$$"; }
mark_run_end() { _schedule_contract_cli mark-end --chain-path "$1" --chain-dir "${CHAIN_DIR:?CHAIN_DIR must be configured}" --schedules-dir "${SCHEDULES_DIR:?SCHEDULES_DIR must be configured}" --status "${2:-success}"; }
mark_run() { mark_run_end "$@"; }

cmd_enable() { _schedule_contract_cli set-enabled --chain-path "$1" --chain-dir "${CHAIN_DIR:?CHAIN_DIR must be configured}" --schedules-dir "${SCHEDULES_DIR:?SCHEDULES_DIR must be configured}" --enabled true; echo "schedule enabled"; }
cmd_disable() { _schedule_contract_cli set-enabled --chain-path "$1" --chain-dir "${CHAIN_DIR:?CHAIN_DIR must be configured}" --schedules-dir "${SCHEDULES_DIR:?SCHEDULES_DIR must be configured}" --enabled false; echo "schedule disabled"; }
cmd_list() { _schedule_contract_cli list --chain-dir "${CHAIN_DIR:?CHAIN_DIR must be configured}" --schedules-dir "${SCHEDULES_DIR:?SCHEDULES_DIR must be configured}"; }

cmd_next() {
    local schedule next
    [[ -f "$1" ]] || { echo "error: chain file not found: $1"; return 1; }
    schedule="$(get_schedule "$1")"
    [[ -n "$schedule" ]] || { echo "no schedule configured"; return 0; }
    next="$(calculate_next_run "$schedule")"
    [[ "$next" -gt 0 ]] && echo "next run: $(date -r "$next" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -d "@$next" '+%Y-%m-%d %H:%M:%S')" || echo "could not calculate next run (install python-croniter)"
}

cmd_check() {
    local chain_file="$1" schedule name
    [[ -f "$chain_file" ]] || { echo "error: chain file not found: $chain_file"; return 1; }
    schedule="$(get_schedule "$chain_file")"
    [[ -n "$schedule" ]] || { echo "no schedule configured"; return 0; }
    [[ "$(should_run_chain "$chain_file")" == "true" ]] || return 0
    name="$(_schedule_contract_cli field --chain-path "$chain_file" --chain-dir "${CHAIN_DIR:?CHAIN_DIR must be configured}" --field name)"
    echo "running scheduled chain: $name ($schedule)"
    mark_run_start "$chain_file"
    if "$SCRIPT_DIR/chain-runner.sh" "$chain_file"; then mark_run_end "$chain_file" success; else mark_run_end "$chain_file" failed; return 1; fi
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    command="${1:-}"; shift || true
    case "$command" in
        check) [[ -n "${1:-}" ]] || { echo "usage: scheduler.sh check <chain.json>"; exit 1; }; cmd_check "$@" ;;
        list) cmd_list ;;
        next) [[ -n "${1:-}" ]] || { echo "usage: scheduler.sh next <chain.json>"; exit 1; }; cmd_next "$@" ;;
        enable) [[ -n "${1:-}" ]] || { echo "usage: scheduler.sh enable <chain.json>"; exit 1; }; cmd_enable "$@" ;;
        disable) [[ -n "${1:-}" ]] || { echo "usage: scheduler.sh disable <chain.json>"; exit 1; }; cmd_disable "$@" ;;
        daemon) echo "scheduler daemon is owned by the typed background worker" >&2; exit 1 ;;
        *) echo "usage: scheduler.sh <check|list|next|enable|disable>"; exit 1 ;;
    esac
fi
