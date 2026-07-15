#!/bin/bash
# Thin shell boundary for typed routing contracts. Shell may perform runtime
# clock/state calls, but it must never parse chain routing JSON itself.

_ROUTING_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$_ROUTING_LIB_DIR/agent-state-client.sh"

_routing_contract_cli() {
    local code_root="${MENTIKO_CODE_ROOT:?MENTIKO_CODE_ROOT must be configured}"
    local cli="$code_root/lib/runner-routing-contract.js"
    [[ -f "$cli" ]] || { echo "typed routing contract runtime is unavailable: $cli" >&2; return 1; }
    node "$cli" "$@"
}

retry-calculate-delay() {
    _routing_contract_cli retry-delay --attempt "$1" --strategy "${2:-exponential}" --initial-delay "${3:-5}" --max-delay "${4:-300}" --multiplier "${5:-2.0}"
}

branch-parse() {
    local result
    result="$(_routing_contract_cli branch-parse --branch-json "$1")" || return 1
    printf '%s\n' "$result"
    [[ "$result" != "unknown:" ]]
}

error-handler-resolve() {
    _routing_contract_cli error-handler --chain-path "$1" --chain-dir "${CHAIN_DIR:?CHAIN_DIR must be configured}" --agent-id "$2" --error-type "${3:-error}"
}

timeout-check-agent() {
    local agent_id="$1" chain_file="$2"
    local session_prefix started
    session_prefix="$(_routing_contract_cli timeout-session-prefix --chain-path "$chain_file" --chain-dir "${CHAIN_DIR:?CHAIN_DIR must be configured}" --agent-id "$agent_id")"
    started="$(_agent_state_cli started-at --state-dir "${STATE_DIR:?STATE_DIR must be configured}" --session-prefix "$session_prefix" --run-id "${RUN_ID:?RUN_ID is required for runner agent state}" 2>/dev/null || true)"
    [[ -n "$started" ]] || return 1
    [[ "$(_routing_contract_cli timeout-check --chain-path "$chain_file" --chain-dir "$CHAIN_DIR" --agent-id "$agent_id" --started-at "$started")" == "true" ]] || return 1
    echo "timeout"
}

export -f _routing_contract_cli retry-calculate-delay branch-parse error-handler-resolve timeout-check-agent
