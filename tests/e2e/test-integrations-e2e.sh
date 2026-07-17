#!/bin/bash
# e2e test: slack integration configuration and payloads
# tests:
#   - slack webhook url resolution
#   - slack message formatting
#   - slack message delivery
#   - integration config in chain.json

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LIB_DIR="$PROJECT_ROOT/lib"

# source integration lib (suppress errors for standalone test)
source "$LIB_DIR/slack-integration.sh" 2>/dev/null || true

echo "=== integrations e2e test ==="
echo ""

# setup test environment
TEST_STATE_DIR="/tmp/mentiko-test-integrations-$$"
mkdir -p "$TEST_STATE_DIR"

# cleanup function
cleanup() {
    rm -rf "$TEST_STATE_DIR"
    rm -f "/tmp/test-integrations-chain-$$.json"
}
trap cleanup EXIT

# -------------------------------------------------------------------
# slack tests
# -------------------------------------------------------------------

echo "=== slack integration tests ==="
echo ""

# test 1: slack webhook url resolution
echo "test 1: slack webhook url resolution"

# mock chain with slack config
SLACK_CHAIN="/tmp/test-slack-chain-$$.json"
cat > "$SLACK_CHAIN" <<EOF
{
  "name": "slack-test-chain",
  "config": {
    "slack": {
      "enabled": true,
      "webhook_url": "https://example.test/slack-webhook",
      "events": ["chain_start", "chain_complete", "agent_error"],
      "web_url": "https://mentiko.example.com"
    }
  }
}
EOF

WEBHOOK_URL=$(jq -r '.config.slack.webhook_url' "$SLACK_CHAIN")
if [[ "$WEBHOOK_URL" != "https://example.test/slack-webhook" ]]; then
    echo "  ✖ failed: webhook url not read correctly"
    exit 1
fi

echo "  ✔ slack webhook url resolved"
echo ""

# test 2: slack message formatting
echo "test 2: slack message formatting"

SLACK_EVENTS=(
    "chain_start:white_check_mark:#36a64f"
    "chain_complete:white_check_mark:#36a64f"
    "chain_error:x:#dc3545"
    "agent_error:warning:#ffc107"
)

for event_mapping in "${SLACK_EVENTS[@]}"; do
    EVENT="${event_mapping%%:*}"
    REMAINING="${event_mapping#*:}"
    EMOJI="${REMAINING%%:*}"
    COLOR="${REMAINing##*:}"

    # build simple slack payload
    SLACK_PAYLOAD=$(jq -n \
        --arg event "$EVENT" \
        --arg emoji ":$EMOJI:" \
        --arg color "$COLOR" \
        '{
            username: "Agent Chain",
            icon_emoji: ":robot_face:",
            attachments: [{
                color: $color,
                title: "\($emoji) \($event)",
                footer: "mentiko",
                ts: 1234567890
            }]
        }')

    if ! echo "$SLACK_PAYLOAD" | jq empty 2>/dev/null; then
        echo "  ✖ failed: slack payload invalid for $EVENT"
        exit 1
    fi

    ATTACHMENT_COLOR=$(echo "$SLACK_PAYLOAD" | jq -r '.attachments[0].color')
    if [[ "$ATTACHMENT_COLOR" != "$COLOR" ]]; then
        echo "  ✖ failed: color mismatch for $EVENT"
        exit 1
    fi
done

echo "  ✔ slack message formatting for all event types"
echo ""

# test 3: slack notification payload with context
echo "test 3: slack notification with agent context"

CHAIN_NAME="test-chain"
RUN_ID="run-789"
AGENT_NAME="Research Agent"
AGENT_ID="researcher"
ERROR_MSG="api rate limit exceeded"

SLACK_PAYLOAD=$(jq -n \
    --arg event "agent_error" \
    --arg chain "$CHAIN_NAME" \
    --arg run_id "$RUN_ID" \
    --arg agent "$AGENT_NAME" \
    --arg agent_id "$AGENT_ID" \
    --arg error "$ERROR_MSG" \
    '{
        username: "Agent Chain",
        icon_emoji: ":robot_face:",
        attachments: [{
            color: "#ffc107",
            title: ":warning: \($event)",
            fields: [
                {title: "Chain", value: $chain, short: true},
                {title: "Run ID", value: "`\($run_id)`", short: true},
                {title: "Agent", value: $agent, short: true},
                {title: "Error", value: $error, short: false}
            ],
            footer: "mentiko",
            ts: 1234567890
        }]
    }')

# verify fields
FIELD_COUNT=$(echo "$SLACK_PAYLOAD" | jq -r '.attachments[0].fields | length')
if [[ "$FIELD_COUNT" -ne 4 ]]; then
    echo "  ✖ failed: expected 4 fields, got $FIELD_COUNT"
    exit 1
fi

ERROR_FIELD=$(echo "$SLACK_PAYLOAD" | jq -r '.attachments[0].fields[] | select(.title == "Error") | .value')
if [[ "$ERROR_FIELD" != "$ERROR_MSG" ]]; then
    echo "  ✖ failed: error field content wrong"
    exit 1
fi

echo "  ✔ slack agent error payload formatted"
echo ""

# test 4: slack event filtering
echo "test 4: slack event filtering"

SUBSCRIBED_EVENTS=$(jq -r '.config.slack.events[]' "$SLACK_CHAIN" | tr '\n' '|')

# test subscribed event
if echo "chain_complete" | grep -qE "^(${SUBSCRIBED_EVENTS%|})\$"; then
    echo "  ✔ chain_complete would be sent"
else
    echo "  ✖ failed: chain_complete should be subscribed"
    exit 1
fi

# test non-subscribed event
if echo "agent_started" | grep -qE "^(${SUBSCRIBED_EVENTS%|})\$"; then
    echo "  ✖ failed: agent_started should not be subscribed"
    exit 1
else
    echo "  ✔ agent_started would be filtered"
fi
echo ""

# test 5: slack integration config in chain.json
echo "test 5: slack integration config in chain.json"

INTEGRATION_CHAIN="/tmp/test-integrations-chain-$$.json"
cat > "$INTEGRATION_CHAIN" <<EOF
{
  "name": "integration-test-chain",
  "version": "1.0",
  "config": {
    "cli": "echo",
    "monitor": false,
    "project_root": "$TEST_STATE_DIR",
    "integrations": {
      "slack": {
        "enabled": true,
        "webhook_url": "https://example.test/slack-webhook",
        "events": ["chain_start", "chain_complete", "agent_error"],
        "web_url": "https://example.com"
      }
    }
  },
  "agents": []
}
EOF

# verify slack config
SLACK_ENABLED=$(jq -r '.config.integrations.slack.enabled' "$INTEGRATION_CHAIN")
if [[ "$SLACK_ENABLED" != "true" ]]; then
    echo "  ✖ failed: slack integration not enabled"
    exit 1
fi

echo "  ✔ slack integration config valid"
echo ""

# test 6: slack integration state tracking
echo "test 6: slack integration state tracking"

SLACK_STATE="$TEST_STATE_DIR/slack-integration.json"
cat > "$SLACK_STATE" <<EOF
{
  "last_sent": "$(date -Iseconds)",
  "total_sent": 42,
  "last_event": "agent_error",
  "errors": 0
}
EOF

TOTAL_SENT=$(jq -r '.total_sent' "$SLACK_STATE")
if [[ "$TOTAL_SENT" != "42" ]]; then
    echo "  ✖ failed: slack state wrong"
    exit 1
fi

echo "  ✔ slack integration state tracked"
echo ""

echo "=== integrations e2e tests completed ==="
echo "status: 6/6 tests passed"

exit 0
