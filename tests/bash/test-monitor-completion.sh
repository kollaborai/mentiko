#!/bin/bash
# test-monitor-completion.sh - monitor completion/event detection regressions

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

TEST_TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_TMP_DIR"' EXIT

EVENTS_DIR="$TEST_TMP_DIR/events"
CHAIN_FILE="$TEST_TMP_DIR/chain.json"
mkdir -p "$EVENTS_DIR"

cat > "$CHAIN_FILE" <<'JSON'
{
  "agents": [
    {
      "id": "middleware-architect",
      "name": "Middleware Architect",
      "triggers": ["manual-start"],
      "emits": "architecture-designed"
    },
    {
      "id": "rbac-guest-enforcer",
      "name": "RBAC Guest Enforcer",
      "triggers": ["architecture-designed"],
      "emits": "guest-enforcement-implemented"
    }
  ]
}
JSON

cat > "$EVENTS_DIR/uam-middleware-architect-architecture-designed.event" <<'EOF'
event: architecture-designed
source: uam-middleware-architect
timestamp: 2026-05-04T02:45:44Z
processed: false
EOF

source "$PROJECT_ROOT/lib/monitor-completion.sh"

assert_eq() {
  local expected="$1"
  local actual="$2"
  local message="$3"
  if [[ "$expected" != "$actual" ]]; then
    echo "FAIL: $message"
    echo "expected: $expected"
    echo "actual:   $actual"
    exit 1
  fi
  echo "PASS: $message"
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local message="$3"
  if ! grep -qF "$needle" <<<"$haystack"; then
    echo "FAIL: $message"
    echo "expected to contain: $needle"
    echo "actual: $haystack"
    exit 1
  fi
  echo "PASS: $message"
}

assert_not_eq() {
  local forbidden="$1"
  local actual="$2"
  local message="$3"
  if [[ "$forbidden" == "$actual" ]]; then
    echo "FAIL: $message"
    echo "forbidden: $forbidden"
    exit 1
  fi
  echo "PASS: $message"
}

event_file="$(monitor_completion_event_file \
  "mentiko-uam-middleware-architect-run-1777862548347" \
  "$CHAIN_FILE" \
  "$EVENTS_DIR")"

assert_eq "$EVENTS_DIR/uam-middleware-architect-architecture-designed.event" \
  "$event_file" \
  "detects completion event for current agent even if terminal marker scrolled away"

missing_event_file="$(monitor_completion_event_file \
  "mentiko-uam-rbac-guest-enforcer-run-1777862548347" \
  "$CHAIN_FILE" \
  "$EVENTS_DIR")"

assert_eq "" "$missing_event_file" "does not match another agent's event"

first_nudge="$(monitor_stale_nudge_message 1)"
assert_not_eq "proceed" "$first_nudge" "first stale nudge is not bare proceed"
assert_contains "$first_nudge" "current assigned task" "first stale nudge keeps agent in scope"

bare_advisor_nudge="$(monitor_sanitize_nudge "proceed" 1)"
assert_not_eq "proceed" "$bare_advisor_nudge" "advisor output is not allowed to stay bare proceed"
assert_contains "$bare_advisor_nudge" "current assigned task" "advisor bare proceed fallback keeps agent in scope"

repeated_bare_nudge="$(monitor_sanitize_nudge $'ok\nok' 1)"
assert_not_eq $'ok\nok' "$repeated_bare_nudge" "advisor repeated bare acknowledgements are replaced"
assert_contains "$repeated_bare_nudge" "current assigned task" "repeated bare acknowledgement fallback keeps agent in scope"
