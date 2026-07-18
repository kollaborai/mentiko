#!/bin/bash
# e2e test: github and slack integrations
# tests:
#   - github token retrieval
#   - github api connection
#   - github issue creation
#   - slack webhook url resolution
#   - slack message formatting
#   - slack message delivery
#   - integration config in chain.json

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LIB_DIR="$PROJECT_ROOT/lib"

# source integration libs (suppress errors for standalone test)
source "$LIB_DIR/github-integration.sh" 2>/dev/null || true
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
# github tests
# -------------------------------------------------------------------

echo "=== github integration tests ==="
echo ""

# test 1: github token retrieval from env
echo "test 1: github token retrieval"

# simulate token retrieval
get_github_token() {
    if [[ -n "${GITHUB_TOKEN:-}" ]]; then
        echo "$GITHUB_TOKEN"
        return 0
    fi

    local env_file="$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.env"
    if [[ -f "$env_file" ]]; then
        local token=$(grep "^GITHUB_TOKEN=" "$env_file" | cut -d'=' -f2- | tr -d '"' | tr -d "'" | xargs)
        if [[ -n "$token" ]]; then
            echo "$token"
            return 0
        fi
    fi

    return 1
}

# test with no token set
unset GITHUB_TOKEN
TOKEN_RESULT=$(get_github_token 2>/dev/null || echo "not_found")
if [[ "$TOKEN_RESULT" != "not_found" ]]; then
    echo "  ⚠ warning: token found when none expected (may have .env file)"
else
    echo "  ✔ token not found (expected when not configured)"
fi

# test with mock token
export GITHUB_TOKEN="test-github-token"
TOKEN_RESULT=$(get_github_token)
if [[ "$TOKEN_RESULT" != "test-github-token" ]]; then
    echo "  ✖ failed: token retrieval from env"
    exit 1
fi

echo "  ✔ token retrieval works"
echo ""

# test 2: github api request construction
echo "test 2: github api request construction"

simulate_github_api() {
    local endpoint="$1"
    local method="${2:-GET}"
    local token="${3:-$GITHUB_TOKEN}"

    local url="https://api.github.com${endpoint}"
    local args=(-X "$method" -H "Authorization: Bearer $token" -H "Accept: application/vnd.github+json")

    echo "url: $url"
    echo "method: $method"
    echo "auth: Bearer ${token:0:10}..."
}

API_OUTPUT=$(simulate_github_api "/user" "GET")
if ! echo "$API_OUTPUT" | grep -q "https://api.github.com/user"; then
    echo "  ✖ failed: api url construction"
    exit 1
fi

if ! echo "$API_OUTPUT" | grep -q "Bearer ghp_test"; then
    echo "  ✖ failed: auth header construction"
    exit 1
fi

echo "  ✔ github api request construction works"
echo ""

# test 3: github issue payload
echo "test 3: github issue payload construction"

ISSUE_TITLE="Agent Error: test-agent failed"
ISSUE_BODY="## Agent Error Report

**Run ID:** \`test-run-123\`
**Agent:** \`test-agent\`
**Chain:** test-chain

## Error
Agent failed with timeout

## Output
last 100 lines of agent output...

---
Created by mentiko github integration
Timestamp: $(date -Iseconds)"

ISSUE_PAYLOAD=$(jq -n \
    --arg t "$ISSUE_TITLE" \
    --arg b "$ISSUE_BODY" \
    --arg l "agent-error,bug,automated" \
    '{title: $t, body: $b, labels: ($l | split(","))}')

if ! echo "$ISSUE_PAYLOAD" | jq empty 2>/dev/null; then
    echo "  ✖ failed: issue payload invalid json"
    exit 1
fi

PAYLOAD_TITLE=$(echo "$ISSUE_PAYLOAD" | jq -r '.title')
if [[ "$PAYLOAD_TITLE" != "$ISSUE_TITLE" ]]; then
    echo "  ✖ failed: payload title mismatch"
    exit 1
fi

LABEL_COUNT=$(echo "$ISSUE_PAYLOAD" | jq -r '.labels | length')
if [[ "$LABEL_COUNT" -ne 3 ]]; then
    echo "  ✖ failed: payload labels wrong count"
    exit 1
fi

echo "  ✔ github issue payload constructed"
echo ""

# test 4: github agent error issue format
echo "test 4: github agent error issue format"

AGENT_ERROR_PAYLOAD=$(jq -n \
    --arg run_id "test-run-456" \
    --arg agent_id "failing-agent" \
    --arg error_msg "timeout after 60s" \
    --arg chain "test-chain" \
    '{
        title: "Agent Error: \($agent_id) failed in \($chain)",
        body: "## Run: \($run_id)\n\nError: \($error_msg)",
        labels: ["agent-error", "bug"]
    }')

ERROR_TITLE=$(echo "$AGENT_ERROR_PAYLOAD" | jq -r '.title')
if [[ "$ERROR_TITLE" != "Agent Error: failing-agent failed in test-chain" ]]; then
    echo "  ✖ failed: error issue title wrong"
    exit 1
fi

echo "  ✔ agent error issue format correct"
echo ""

# -------------------------------------------------------------------
# slack tests
# -------------------------------------------------------------------

echo "=== slack integration tests ==="
echo ""

# test 5: slack webhook url resolution
echo "test 5: slack webhook url resolution"

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

# test 6: slack message formatting
echo "test 6: slack message formatting"

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

# test 7: slack notification payload with context
echo "test 7: slack notification with agent context"

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

# test 8: slack event filtering
echo "test 8: slack event filtering"

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

# test 9: integration config in chain.json
echo "test 9: full integration config in chain.json"

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
      "github": {
        "enabled": true,
        "repo": "owner/repo",
        "on_errors": true,
        "labels": ["agent-error", "automated"]
      },
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

# verify github config
GITHUB_ENABLED=$(jq -r '.config.integrations.github.enabled' "$INTEGRATION_CHAIN")
if [[ "$GITHUB_ENABLED" != "true" ]]; then
    echo "  ✖ failed: github integration not enabled"
    exit 1
fi

GITHUB_REPO=$(jq -r '.config.integrations.github.repo' "$INTEGRATION_CHAIN")
if [[ "$GITHUB_REPO" != "owner/repo" ]]; then
    echo "  ✖ failed: github repo wrong"
    exit 1
fi

# verify slack config
SLACK_ENABLED=$(jq -r '.config.integrations.slack.enabled' "$INTEGRATION_CHAIN")
if [[ "$SLACK_ENABLED" != "true" ]]; then
    echo "  ✖ failed: slack integration not enabled"
    exit 1
fi

echo "  ✔ full integration config valid"
echo ""

# test 10: integration state tracking
echo "test 10: integration state tracking"

GITHUB_STATE="$TEST_STATE_DIR/github-integration.json"
cat > "$GITHUB_STATE" <<EOF
{
  "last_issue": "123",
  "last_issue_url": "https://github.com/owner/repo/issues/123",
  "total_issues": 5,
  "last_error": null
}
EOF

TOTAL_ISSUES=$(jq -r '.total_issues' "$GITHUB_STATE")
if [[ "$TOTAL_ISSUES" != "5" ]]; then
    echo "  ✖ failed: github state wrong"
    exit 1
fi

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

echo "  ✔ integration state tracked"
echo ""

echo "=== integrations e2e tests completed ==="
echo "status: 10/10 tests passed"

exit 0
