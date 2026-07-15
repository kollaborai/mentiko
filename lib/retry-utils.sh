#!/bin/bash
# retry-utils.sh - shell invocation boundary for the typed retry/circuit owner.
#
# Shell retains only argument forwarding. Backoff policy and all circuit JSON
# parsing, validation, locking, and atomic mutation live in runner-retry-circuit.js.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh" 2>/dev/null || true

_retry_circuit_cli() {
    node "$SCRIPT_DIR/runner-retry-circuit.js" "$@"
}

calculate_backoff() {
    local attempt="$1" strategy="$2" base_delay="$3" max_delay="${4:-}"
    local args=(backoff --attempt "$attempt" --strategy "$strategy" --base-ms "$base_delay")
    [[ -n "$max_delay" ]] && args+=(--max-ms "$max_delay")
    _retry_circuit_cli "${args[@]}"
}

should_retry() {
    _retry_circuit_cli should-retry --attempt "$1" --max-retries "$2"
}

circuit_state_file() {
    _retry_circuit_cli state-file --state-dir "$STATE_DIR" --chain-id "$1" --agent-name "$2"
}

is_circuit_open() {
    _retry_circuit_cli is-open --state-dir "$STATE_DIR" --chain-id "$1" --agent-name "$2"
}

record_failure() {
    local args=(record-failure --state-dir "$STATE_DIR" --chain-id "$1" --agent-name "$2")
    [[ -n "${3:-}" ]] && args+=(--threshold "$3")
    [[ -n "${4:-}" ]] && args+=(--timeout "$4")
    _retry_circuit_cli "${args[@]}"
}

record_success() {
    _retry_circuit_cli reset --state-dir "$STATE_DIR" --chain-id "$1" --agent-name "$2" >/dev/null
}

get_circuit_state() {
    _retry_circuit_cli state --state-dir "$STATE_DIR" --chain-id "$1" --agent-name "$2"
}

show_usage() {
    echo "usage: retry-types.sh <command> [args]"
    echo ""
    echo "commands:"
    echo "  backoff <attempt> <strategy> <base-ms> [max-ms]  calculate backoff delay"
    echo "  circuit-check <chain-id> <agent>              check if circuit open"
    echo "  circuit-state <chain-id> <agent>              show circuit state"
    echo "  circuit-reset <chain-id> <agent>              reset circuit to closed"
    echo "  help                                          show this help"
}

cmd_backoff() {
    [[ $# -lt 3 ]] && { echo "error: missing args"; exit 1; }
    local args=(format-backoff --attempt "$1" --strategy "$2" --base-ms "$3")
    [[ -n "${4:-}" ]] && args+=(--max-ms "$4")
    _retry_circuit_cli "${args[@]}"
}

cmd_circuit_check() {
    [[ $# -lt 2 ]] && { echo "error: missing args"; exit 1; }
    is_circuit_open "$1" "$2"
}

cmd_circuit_state() {
    [[ $# -lt 2 ]] && { echo "error: missing args"; exit 1; }
    _retry_circuit_cli format-state --state-dir "$STATE_DIR" --chain-id "$1" --agent-name "$2"
}

cmd_circuit_reset() {
    [[ $# -lt 2 ]] && { echo "error: missing args"; exit 1; }
    _retry_circuit_cli reset --state-dir "$STATE_DIR" --chain-id "$1" --agent-name "$2"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    COMMAND="${1:-}"
    shift || true
    case "$COMMAND" in
        backoff) cmd_backoff "$@" ;;
        circuit-check) cmd_circuit_check "$@" ;;
        circuit-state) cmd_circuit_state "$@" ;;
        circuit-reset) cmd_circuit_reset "$@" ;;
        help|"") show_usage ;;
        *) echo "error: unknown command '$COMMAND'"; show_usage; exit 1 ;;
    esac
fi
