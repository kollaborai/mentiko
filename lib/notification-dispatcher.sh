#!/bin/bash
# notification-dispatcher.sh - Dispatch notifications based on user preferences
#
# reads user notification preferences and dispatches events to enabled channels
# (in-app, push, email, slack, webhook, pagerduty, linear, github).
#
# usage:
#   source notification-dispatcher.sh
#   dispatch-notification <event-type> <chain-id> <run-id> [agent-id] [message]
#
# events: chain-completed, chain-stopped, chain-failed, agent-completed,
#         agent-failed, chain-stalled, approval-requested, budget-threshold

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh" 2>/dev/null || true

# default dispatch endpoint (override via env)
DISPATCH_ENDPOINT="${MENTIKO_DISPATCH_ENDPOINT:-${MENTIKO_WEB_URL:-http://localhost:${WEB_PORT:-${PORT:-3000}}}/api/notifications/dispatch}"
DISPATCH_SECRET="${MENTIKO_DISPATCH_SECRET:-${BETTER_AUTH_SECRET:-}}"

# -------------------------------------------------------------------
# dispatch-notification: send event to dispatch API
# -------------------------------------------------------------------
dispatch-notification() {
    local event_type="$1"
    local chain_id="${2:-}"
    local run_id="${3:-}"
    local agent_id="${4:-}"
    local message="${5:-}"

    # check if dispatch is enabled
    [[ "${MENTIKO_NOTIFICATIONS_ENABLED:-true}" != "true" ]] && return 0

    # build payload
    local payload
    payload=$(jq -nc \
        --arg event "$event_type" \
        --arg chain "$chain_id" \
        --arg run "$run_id" \
        --arg agent "$agent_id" \
        --arg msg "$message" \
        --arg ns "${NAMESPACE_ID:-default}" \
        '{event:$event, chainId:$chain, runId:$run, agentId:$agent, message:$msg, namespaceId:$ns}')

    # send to dispatch API
    local response
    local http_code

    if [[ -n "$DISPATCH_SECRET" ]]; then
        response=$(curl -s -w "\n%{http_code}" -X POST "$DISPATCH_ENDPOINT" \
            -H "Authorization: Bearer $DISPATCH_SECRET" \
            -H "Content-Type: application/json" \
            -d "$payload" 2>/dev/null)
    else
        # fallback: localhost without auth
        response=$(curl -s -w "\n%{http_code}" -X POST "$DISPATCH_ENDPOINT" \
            -H "Content-Type: application/json" \
            -d "$payload" 2>/dev/null)
    fi

    # split response body and http code
    http_code=$(echo "$response" | tail -n1)
    local body
    body=$(echo "$response" | head -n-1)

    if [[ "$http_code" =~ ^2 ]]; then
        echo "  notification: $event_type dispatched to $(echo "$body" | jq -r '.dispatched | length') channels"
    else
        echo "  notification: failed to dispatch $event_type (HTTP $http_code)"
    fi

    return 0
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
    local message="${3:-Chain stopped due to an error}"
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
    local message="${4:-Agent stopped due to an error}"
    dispatch-notification "agent-failed" "$chain_id" "$run_id" "$agent_id" "$message"
}

# -------------------------------------------------------------------
# dispatch-chain-stalled: watchdog detected stall
# -------------------------------------------------------------------
dispatch-chain-stalled() {
    local chain_id="$1"
    local run_id="$2"
    dispatch-notification "chain-stalled" "$chain_id" "$run_id" "" "Chain appears to be stalled (watchdog)"
}

export -f dispatch-notification 2>/dev/null || true
export -f dispatch-chain-completed 2>/dev/null || true
export -f dispatch-chain-failed 2>/dev/null || true
export -f dispatch-chain-stopped 2>/dev/null || true
export -f dispatch-agent-completed 2>/dev/null || true
export -f dispatch-agent-failed 2>/dev/null || true
export -f dispatch-chain-stalled 2>/dev/null || true

echo "  mentiko: notification-dispatcher loaded"
