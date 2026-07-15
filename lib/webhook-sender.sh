#!/bin/bash
# webhook-sender.sh - Webhook notification system with retry logic
#
# usage:
#   source webhook-sender.sh
#   send-webhook <event-type> <chain-file> <payload-data>
#   get-webhook-status <chain-file>
#
# supported events:
#   agent_started, agent_complete, agent_error
#   chain_started, chain_complete, chain_error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

source "$SCRIPT_DIR/integration-contract-client.sh"

# -------------------------------------------------------------------
# send-webhook: build semantic inputs then invoke the typed delivery owner
# -------------------------------------------------------------------
send-webhook() {
    local event_type="$1"
    local chain_file="$2"
    shift 2

    if [[ ! -f "$chain_file" ]]; then
        echo "  error: chain file not found: $chain_file"
        return 1
    fi

    local timestamp=$(date -Iseconds)
    local event_id="webhook-${event_type}-$(date +%s)-$$"
    local plan_args=(--chain-path "$chain_file" --event-type "$event_type" --event-id "$event_id" --timestamp "$timestamp")
    for item in "$@"; do plan_args+=(--payload-data "$item"); done
    local delivery_args=()
    while IFS= read -r plan; do [[ -n "$plan" ]] && delivery_args+=(--plan "$plan"); done < <(integration_webhook_plans "${plan_args[@]}") || return 1
    [[ ${#delivery_args[@]} -eq 0 ]] && return 0
    integration_webhook_deliver "${delivery_args[@]}"
}

# -------------------------------------------------------------------
# get-webhook-status: get recent webhook delivery status
# -------------------------------------------------------------------
get-webhook-status() {
    local chain_file="${1:-}"
    local args=()
    [[ -n "$chain_file" && -f "$chain_file" ]] && args+=(--chain-path "$chain_file")
    if [[ ${#args[@]} -gt 0 ]]; then
        integration_delivery_status "${args[@]}"
    else
        integration_delivery_status
    fi
}

# -------------------------------------------------------------------
# cleanup-webhook-state: remove old webhook state files
# -------------------------------------------------------------------
cleanup-webhook-state() {
    local days="${1:-7}"

    integration_delivery_cleanup --days "$days" || return 1
    echo "  cleaned webhook state older than ${days} days"
}

# -------------------------------------------------------------------
# fire-chain-webhooks: fire webhooks stored in metadata.webhooks array
# new format: [{id,name,url,events[],headers,secret,enabled}]
# called at chain started/completed/failed lifecycle points
# -------------------------------------------------------------------
fire-chain-webhooks() {
    local event_type="$1"   # started | completed | failed
    local chain_file="$2"
    local chain_id="${3:-}"
    local run_id="${4:-}"

    [[ ! -f "$chain_file" ]] && return 0

    local timestamp
    timestamp=$(date -Iseconds)
    local delivery_args=()
    while IFS= read -r plan; do [[ -n "$plan" ]] && delivery_args+=(--plan "$plan"); done < <(integration_metadata_webhook_plans --chain-path "$chain_file" --event-type "$event_type" --chain-id "$chain_id" --run-id "$run_id" --timestamp "$timestamp") || return 1
    [[ ${#delivery_args[@]} -eq 0 ]] && return 0
    integration_metadata_webhook_deliver "${delivery_args[@]}"
}

# exports
export -f send-webhook
export -f get-webhook-status
export -f cleanup-webhook-state
export -f fire-chain-webhooks

echo "  mentiko: webhook functions loaded"
