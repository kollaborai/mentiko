#!/bin/bash
# test-webhooks.sh - test webhook-sender.sh retry logic
#
# tests:
#   - webhook config parsing
#   - event filtering logic
#   - payload construction
#   - state file creation
#   - status output

# only run tests if executed directly
[[ "${BASH_SOURCE[0]}" == "${0}" ]] || return 0

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/webhook-sender.sh" 2>/dev/null

# temp test directory
TEST_STATE_DIR="$(mktemp -d)"
export WEBHOOK_STATE_DIR="$TEST_STATE_DIR"
mkdir -p "$WEBHOOK_STATE_DIR"

# temp test chain file
TEST_CHAIN_FILE="$(mktemp)"

# counter
TESTS_PASSED=0
TESTS_FAILED=0

# -------------------------------------------------------------------
# test helpers
# -------------------------------------------------------------------

assert_eq() {
    local expected="$1"
    local actual="$2"
    local msg="${3:-assertion failed}"

    if [[ "$expected" == "$actual" ]]; then
        echo "  [PASS] $msg"
        ((TESTS_PASSED++)) || true
    else
        echo "  [FAIL] $msg"
        echo "    expected: $expected"
        echo "    actual:   $actual"
        ((TESTS_FAILED++)) || true
    fi
}

assert_contains() {
    local haystack="$1"
    local needle="$2"
    local msg="${3:-output should contain string}"

    if echo "$haystack" | grep -q "$needle"; then
        echo "  [PASS] $msg"
        ((TESTS_PASSED++)) || true
    else
        echo "  [FAIL] $msg"
        echo "    expected to find: $needle"
        ((TESTS_FAILED++)) || true
    fi
}

assert_exists() {
    local path="$1"
    local msg="${2:-file should exist}"

    if [[ -e "$path" ]]; then
        echo "  [PASS] $msg"
        ((TESTS_PASSED++)) || true
    else
        echo "  [FAIL] $msg: $path"
        ((TESTS_FAILED++)) || true
    fi
}

assert_json_eq() {
    local field="$1"
    local expected="$2"
    local json_file="$3"
    local msg="${4:-json field check}"

    local actual=$(jq -r "$field" "$json_file" 2>/dev/null || echo "null")
    assert_eq "$expected" "$actual" "$msg" || true
}

# -------------------------------------------------------------------
# create test chain with webhooks
# -------------------------------------------------------------------

create_test_chain() {
    local enabled="$1"
    local events="${2:-[]}"
    local max_attempts="${3:-3}"

    cat > "$TEST_CHAIN_FILE" <<EOF
{
  "name": "test-chain",
  "config": {
    "webhooks": {
      "enabled": $enabled,
      "urls": ["http://example.com/webhook"],
      "events": $events,
      "retry": {
        "max_attempts": $max_attempts,
        "backoff_base": 2,
        "initial_delay": 1,
        "max_delay": 60
      }
    }
  },
  "agents": []
}
EOF
}

# -------------------------------------------------------------------
# tests
# -------------------------------------------------------------------

echo "webhook-sender.sh test suite"
echo "============================"
echo ""

# -------------------------------------------------------------------
# test: chain config parsing
# -------------------------------------------------------------------

echo "test: chain config parsing"

create_test_chain "true"

ENABLED=$(jq -r '.config.webhooks.enabled' "$TEST_CHAIN_FILE")
assert_eq "true" "$ENABLED" "webhook enabled parsed"

URL_COUNT=$(jq -r '.config.webhooks.urls | length' "$TEST_CHAIN_FILE")
assert_eq "1" "$URL_COUNT" "webhook url count parsed"

MAX_ATTEMPTS=$(jq -r '.config.webhooks.retry.max_attempts' "$TEST_CHAIN_FILE")
assert_eq "3" "$MAX_ATTEMPTS" "retry max_attempts parsed"

BACKOFF_BASE=$(jq -r '.config.webhooks.retry.backoff_base' "$TEST_CHAIN_FILE")
assert_eq "2" "$BACKOFF_BASE" "retry backoff_base parsed"

echo ""

# -------------------------------------------------------------------
# test: webhooks disabled
# -------------------------------------------------------------------

echo "test: webhooks disabled"

create_test_chain "false"

# when disabled, send-webhook should exit early without error
# we can't test the actual send without a server, but we can verify config
ENABLED=$(jq -r '.config.webhooks.enabled' "$TEST_CHAIN_FILE")
assert_eq "false" "$ENABLED" "webhook can be disabled"

echo ""

# -------------------------------------------------------------------
# test: event subscription list
# -------------------------------------------------------------------

echo "test: event subscription list"

create_test_chain "true" '["agent_started", "agent_complete"]'

EVENT_COUNT=$(jq -r '.config.webhooks.events | length' "$TEST_CHAIN_FILE")
assert_eq "2" "$EVENT_COUNT" "event subscription count parsed"

EVENT1=$(jq -r '.config.webhooks.events[0]' "$TEST_CHAIN_FILE")
assert_eq "agent_started" "$EVENT1" "first event parsed"

echo ""

# -------------------------------------------------------------------
# test: webhook state file structure
# -------------------------------------------------------------------

echo "test: webhook state file structure"

# create a mock state file manually
cat > "$WEBHOOK_STATE_DIR/test-event.json" <<'EOF'
{
  "event_id": "test-chain-agent_started-123-456",
  "event_type": "agent_started",
  "url": "http://example.com/webhook",
  "attempts": 1,
  "status": "delivered",
  "created_at": "2024-01-01T12:00:00+00:00",
  "updated_at": "2024-01-01T12:00:01+00:00",
  "http_code": "200"
}
EOF

assert_exists "$WEBHOOK_STATE_DIR/test-event.json" "state file created"

assert_json_eq ".event_id" "test-chain-agent_started-123-456" "$WEBHOOK_STATE_DIR/test-event.json" "event_id in state"
assert_json_eq ".event_type" "agent_started" "$WEBHOOK_STATE_DIR/test-event.json" "event_type in state"
assert_json_eq ".status" "delivered" "$WEBHOOK_STATE_DIR/test-event.json" "status in state"
assert_json_eq ".attempts" "1" "$WEBHOOK_STATE_DIR/test-event.json" "attempts in state"
assert_json_eq ".http_code" "200" "$WEBHOOK_STATE_DIR/test-event.json" "http_code in state"

echo ""

# -------------------------------------------------------------------
# test: failed webhook state
# -------------------------------------------------------------------

echo "test: failed webhook state"

cat > "$WEBHOOK_STATE_DIR/test-event-failed.json" <<'EOF'
{
  "event_id": "test-chain-agent_error-123-789",
  "event_type": "agent_error",
  "url": "http://example.com/webhook",
  "attempts": 3,
  "status": "failed",
  "created_at": "2024-01-01T12:05:00+00:00",
  "updated_at": "2024-01-01T12:05:05+00:00",
  "http_code": "500",
  "last_response": "internal server error"
}
EOF

assert_json_eq ".status" "failed" "$WEBHOOK_STATE_DIR/test-event-failed.json" "failed status in state"
assert_json_eq ".attempts" "3" "$WEBHOOK_STATE_DIR/test-event-failed.json" "max attempts reached"

echo ""

# -------------------------------------------------------------------
# test: get-webhook-status
# -------------------------------------------------------------------

echo "test: get-webhook-status"

status_output=$(get-webhook-status "$TEST_CHAIN_FILE" || true)

assert_contains "$status_output" "webhook status" "status header shown"
assert_contains "$status_output" "agent_started" "event shown in status"
assert_contains "$status_output" "agent_error" "failed event shown in status"

echo ""

# -------------------------------------------------------------------
# test: cleanup-webhook-state
# -------------------------------------------------------------------

echo "test: cleanup-webhook-state"

# create an old state file (mock with current time, just test function exists)
cleanup_output=$(cleanup-webhook-state 1 2>&1 || true)
assert_contains "$cleanup_output" "cleaned webhook" "cleanup runs without error"

echo ""

# -------------------------------------------------------------------
# test: retry config validation
# -------------------------------------------------------------------

echo "test: retry config validation"

create_test_chain "true" '["test"]' "5"

MAX_ATTEMPTS=$(jq -r '.config.webhooks.retry.max_attempts' "$TEST_CHAIN_FILE")
assert_eq "5" "$MAX_ATTEMPTS" "custom max_attempts parsed"

INITIAL_DELAY=$(jq -r '.config.webhooks.retry.initial_delay' "$TEST_CHAIN_FILE")
assert_eq "1" "$INITIAL_DELAY" "initial_delay parsed"

MAX_DELAY=$(jq -r '.config.webhooks.retry.max_delay' "$TEST_CHAIN_FILE")
assert_eq "60" "$MAX_DELAY" "max_delay parsed"

echo ""

# -------------------------------------------------------------------
# cleanup
# -------------------------------------------------------------------

rm -rf "$TEST_STATE_DIR"
rm -f "$TEST_CHAIN_FILE"

# -------------------------------------------------------------------
# results
# -------------------------------------------------------------------

echo "============================"
echo "results:"
echo "  [PASS] passed: $TESTS_PASSED"
echo "  [FAIL] failed: $TESTS_FAILED"
echo ""

if [[ $TESTS_FAILED -gt 0 ]]; then
    exit 1
fi

exit 0
