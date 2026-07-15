#!/bin/bash
# notification-dispatcher.sh - invocation-only boundary for the typed dispatch contract.
#
# Dispatch payload construction, HTTP dispatch, and response parsing are owned by
# web/lib/runner-v2/notification-dispatcher.ts. This file preserves the
# source-compatible bash function interface and forwards only primitive
# arguments to the compiled bundle.
#
# usage:
#   source notification-dispatcher.sh
#   dispatch-notification <event-type> <chain-id> <run-id> [agent-id] [message]
#
# events: chain-started, chain-completed, chain-stopped, chain-failed, agent-completed,
#         agent-failed, chain-stalled, approval-requested, budget-threshold

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh"

_dispatch_cli() {
    local cli="${MENTIKO_CODE_ROOT:?MENTIKO_CODE_ROOT must be configured}/lib/runner-notification-dispatcher.js"
    node "$cli" "$@"
}

# -------------------------------------------------------------------
# dispatch-notification: send event to dispatch API
# -------------------------------------------------------------------
dispatch-notification() {
    local event_type="$1"
    local chain_id="${2:-}"
    local run_id="${3:-}"
    local agent_id="${4:-}"
    local message="${5:-}"

    _dispatch_cli dispatch \
        --event "$event_type" \
        --chain "$chain_id" \
        --run "$run_id" \
        --agent "$agent_id" \
        --message "$message"
}

# -------------------------------------------------------------------
# dispatch-chain-completed: chain finished successfully
# -------------------------------------------------------------------
dispatch-chain-completed() {
    local chain_id="$1"
    local run_id="$2"
    dispatch-notification "chain-completed" "$chain_id" "$run_id" "" ""
}

# -------------------------------------------------------------------
# dispatch-chain-failed: chain stopped with error
# -------------------------------------------------------------------
dispatch-chain-failed() {
    local chain_id="$1"
    local run_id="$2"
    local message="${3:-}"
    dispatch-notification "chain-failed" "$chain_id" "$run_id" "" "$message"
}

# -------------------------------------------------------------------
# dispatch-chain-stopped: chain manually stopped
# -------------------------------------------------------------------
dispatch-chain-stopped() {
    local chain_id="$1"
    local run_id="$2"
    dispatch-notification "chain-stopped" "$chain_id" "$run_id" "" ""
}

# -------------------------------------------------------------------
# dispatch-agent-completed: single agent finished
# -------------------------------------------------------------------
dispatch-agent-completed() {
    local chain_id="$1"
    local run_id="$2"
    local agent_id="$3"
    dispatch-notification "agent-completed" "$chain_id" "$run_id" "$agent_id" ""
}

# -------------------------------------------------------------------
# dispatch-agent-failed: agent hit error/timeout
# -------------------------------------------------------------------
dispatch-agent-failed() {
    local chain_id="$1"
    local run_id="$2"
    local agent_id="$3"
    local message="${4:-}"
    dispatch-notification "agent-failed" "$chain_id" "$run_id" "$agent_id" "$message"
}

# -------------------------------------------------------------------
# dispatch-chain-stalled: watchdog detected stall
# -------------------------------------------------------------------
dispatch-chain-stalled() {
    local chain_id="$1"
    local run_id="$2"
    dispatch-notification "chain-stalled" "$chain_id" "$run_id" "" ""
}

export -f dispatch-notification
export -f dispatch-chain-completed
export -f dispatch-chain-failed
export -f dispatch-chain-stopped
export -f dispatch-agent-completed
export -f dispatch-agent-failed
export -f dispatch-chain-stalled

echo "  mentiko: notification-dispatcher loaded"
