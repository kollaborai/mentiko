#!/bin/bash
# slack-integration.sh - Slack webhook notifications for mentiko
#
# Invocation-only boundary. The Slack data contract (chain `.config.slack`
# reads, enabled/subscription gate, and the attachment payload) is owned by the
# typed module lib/slack-notification.mjs. These functions forward an event
# name, the chain-file path, and primitive key=value data items and parse no
# JSON. There is no shell fallback.
#
# usage:
#   source slack-integration.sh
#   send-slack <event> <chain-file> [payload-data]
#
# env:
#   SLACK_WEBHOOK_URL  - slack webhook url (overrides config)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

# Resolve the typed Slack owner. node performs the fetch, so Slack no longer
# needs bash 4 associative arrays — the historical bash 3.2 declare -A crash
# (docs/PHASE6_STALL_ROOTCAUSE.md) is gone. A missing node fails the single
# notification without aborting the chain.
_slack_notification_cli() {
    local mjs="${MENTIKO_CODE_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}/lib/slack-notification.mjs"
    if ! command -v node >/dev/null 2>&1; then
        return 1
    fi
    if [[ ! -f "$mjs" ]]; then
        return 1
    fi
    node "$mjs" "$@"
}

# args: <event> <chain-file> <payload-data...> -> emits --data k=v per item
_slack_data_args() {
    local -n _out="$1"
    shift
    _out=()
    local item
    for item in "$@"; do
        _out+=(--data "$item")
    done
}

get-slack-webhook() {
    local chain_file="$1"
    _slack_notification_cli webhook --chain-file "$chain_file"
}

format-slack-message() {
    local event="$1"
    local chain_file="$2"
    shift 2
    local data_args=()
    _slack_data_args data_args "$@"
    _slack_notification_cli format --event "$event" --chain-file "$chain_file" "${data_args[@]}"
}

send-slack() {
    local event="$1"
    local chain_file="$2"
    shift 2
    if [[ ! -f "$chain_file" ]]; then
        echo "  error: chain file not found: $chain_file" >&2
        return 1
    fi
    local data_args=()
    _slack_data_args data_args "$@"
    _slack_notification_cli send --event "$event" --chain-file "$chain_file" "${data_args[@]}"
}

send-slack-chain-start() {
    local chain_file="$1"
    local goal="${2:-}"
    if [[ -n "$goal" ]]; then
        send-slack "chain_start" "$chain_file" "goal=$goal"
    else
        send-slack "chain_start" "$chain_file"
    fi
}

send-slack-chain-complete() {
    local chain_file="$1"
    local last_agent="${2:-}"
    local status="${3:-complete}"
    local items=()
    [[ -n "$last_agent" ]] && items+=("last_agent=$last_agent")
    [[ -n "$status" ]] && items+=("status=$status")
    send-slack "chain_complete" "$chain_file" "${items[@]}"
}

send-slack-agent-error() {
    local chain_file="$1"
    local agent_name="$2"
    local agent_id="$3"
    local error_msg="${4:-Agent failed}"
    send-slack "agent_error" "$chain_file" \
        "agent_name=$agent_name" \
        "agent_id=$agent_id" \
        "error=$error_msg"
}

slack-config-test() {
    local chain_file="${1:-}"
    if [[ -z "$chain_file" ]]; then
        echo "  usage: slack-config-test <chain.json>"
        return 1
    fi
    if [[ ! -f "$chain_file" ]]; then
        echo "  error: chain file not found: $chain_file"
        return 1
    fi
    echo "  testing slack config..."
    local webhook_url
    webhook_url=$(get-slack-webhook "$chain_file")
    if [[ -z "$webhook_url" ]]; then
        echo "  ✖ no webhook configured"
        echo "    set SLACK_WEBHOOK_URL env var or config.slack.webhook_url"
        return 1
    fi
    echo "  webhook: ${webhook_url:0:30}..."
    # Reuse the typed sender so the test path and the live path share one payload
    # contract; a chain_start on a minimal file proves connectivity.
    if send-slack "chain_start" "$chain_file" "goal=Slack integration test"; then
        echo "  ✔ test message sent successfully"
        return 0
    fi
    echo "  ✖ failed to send"
    return 1
}

# export functions
export -f _slack_notification_cli
export -f _slack_data_args
export -f send-slack
export -f send-slack-chain-start
export -f send-slack-chain-complete
export -f send-slack-agent-error
export -f slack-config-test
export -f get-slack-webhook
export -f format-slack-message
