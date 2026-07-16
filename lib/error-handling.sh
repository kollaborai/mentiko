#!/bin/bash
# error-handling.sh - invocation-only boundary for typed error lifecycle.
#
# TypeScript owns report parsing, chain retry/error policy, state reads and
# mutations, delay scheduling, handler dispatch, and notification payloads.
# The shell functions below preserve the legacy source API and forward only
# primitive values to the compiled runner-error-handling bundle.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

_error_handling_cli() {
    local cli="${MENTIKO_CODE_ROOT:?MENTIKO_CODE_ROOT must be configured}/lib/runner-error-handling.js"
    if [[ ! -f "$cli" ]]; then
        echo "  mentiko: typed runner error-handling bundle missing: $cli" >&2
        return 1
    fi
    node "$cli" "$@"
}

detect-agent-error() {
    _error_handling_cli detect --report-file "$1"
}

get-agent-retry-count() {
    _error_handling_cli retry-count \
        --state-dir "${STATE_DIR:?STATE_DIR must be configured}" \
        --run-id "${RUN_ID:?RUN_ID is required for runner agent state}" \
        --session-prefix "$1"
}

increment-retry-count() {
    _error_handling_cli increment-retry \
        --state-dir "${STATE_DIR:?STATE_DIR must be configured}" \
        --run-id "${RUN_ID:?RUN_ID is required for runner agent state}" \
        --session-prefix "$1"
}

calculate-retry-delay() {
    local args=(delay --attempt "$1")
    [[ -n "${2:-}" ]] && args+=(--backoff "$2")
    [[ -n "${3:-}" ]] && args+=(--initial-delay "$3")
    [[ -n "${4:-}" ]] && args+=(--max-delay "$4")
    [[ -n "${5:-}" ]] && args+=(--multiplier "$5")
    _error_handling_cli "${args[@]}"
}

handle-agent-error() {
    local args=(
        handle
        --state-dir "${STATE_DIR:?STATE_DIR must be configured}"
        --run-id "${RUN_ID:?RUN_ID is required for runner agent state}"
        --agent-id "$1"
        --error-type "$2"
        --report-file "$3"
        --chain-file "$4"
    )
    [[ -n "${AGENTS_DIR:-}" ]] && args+=(--agents-dir "$AGENTS_DIR")
    _error_handling_cli "${args[@]}"
}

export -f detect-agent-error get-agent-retry-count increment-retry-count calculate-retry-delay handle-agent-error
