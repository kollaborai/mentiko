#!/bin/bash
# test-monitor-completion.sh - monitor completion/event detection regressions

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

TEST_TMP_DIR="$(mktemp -d)"
trap 'rm -r "$TEST_TMP_DIR"' EXIT

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
    },
    {
      "id": "task-pipeline-investigator",
      "name": "Task Pipeline Investigator",
      "triggers": ["chain-started"],
      "emits": "pipeline-artifacts-collected"
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

cat > "$EVENTS_DIR/vt-task-pipeline-investigator-pipeline-artifacts-collected.event" <<'EOF'
{
  "event": "pipeline-artifacts-collected",
  "source": "vt-task-pipeline-investigator",
  "timestamp": "2026-05-18T22:12:40.000Z",
  "processed": false
}
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
  if ! grep -qF -- "$needle" <<<"$haystack"; then
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

assert_not_contains() {
  local haystack="$1"
  local needle="$2"
  local message="$3"
  if grep -qF -- "$needle" <<<"$haystack"; then
    echo "FAIL: $message"
    echo "should not contain: $needle"
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

json_event_file="$(monitor_completion_event_file \
  "mentiko-vt-task-pipeline-investigator-run-1779142350356" \
  "$CHAIN_FILE" \
  "$EVENTS_DIR" \
  "task-pipeline-investigator")"

assert_eq "$EVENTS_DIR/vt-task-pipeline-investigator-pipeline-artifacts-collected.event" \
  "$json_event_file" \
  "detects JSON completion event files emitted by agents"

first_nudge="$(monitor_stale_nudge_message 1)"
assert_not_eq "proceed" "$first_nudge" "first stale nudge is not bare proceed"
assert_contains "$first_nudge" "current assigned task" "first stale nudge keeps agent in scope"

bare_advisor_nudge="$(monitor_sanitize_nudge "proceed" 1)"
assert_not_eq "proceed" "$bare_advisor_nudge" "advisor output is not allowed to stay bare proceed"
assert_contains "$bare_advisor_nudge" "current assigned task" "advisor bare proceed fallback keeps agent in scope"

repeated_bare_nudge="$(monitor_sanitize_nudge $'ok\nok' 1)"
assert_not_eq $'ok\nok' "$repeated_bare_nudge" "advisor repeated bare acknowledgements are replaced"
assert_contains "$repeated_bare_nudge" "current assigned task" "repeated bare acknowledgement fallback keeps agent in scope"

if monitor_should_ask_advisor 1 3; then
  echo "FAIL: advisor should not run on first stale check"
  exit 1
else
  echo "PASS: advisor waits past first stale check"
fi

if monitor_should_ask_advisor 2 3; then
  echo "FAIL: advisor should not run on second stale check"
  exit 1
else
  echo "PASS: advisor waits past second stale check"
fi

if monitor_should_ask_advisor 3 3; then
  echo "PASS: advisor runs on third stale check"
else
  echo "FAIL: advisor should run on third stale check"
  exit 1
fi

fake_advisor_bin="$TEST_TMP_DIR/fake-advisor-bin"
fake_advisor_marker="$TEST_TMP_DIR/fake-advisor-called"
mkdir -p "$fake_advisor_bin"
cat > "$fake_advisor_bin/claude" <<'EOF'
#!/bin/bash
printf called > "$MENTIKO_FAKE_ADVISOR_MARKER"
echo "advisor should not run by default"
EOF
chmod 700 "$fake_advisor_bin/claude"
transport_capture() {
  echo "agent terminal output"
}
advisor_default_nudge="$(
  PATH="$fake_advisor_bin:$PATH" \
  MENTIKO_FAKE_ADVISOR_MARKER="$fake_advisor_marker" \
  MENTIKO_MONITOR_CLI="" \
  monitor_stale_nudge_message 1 "fake-session" "fake context" 1
)"
assert_contains "$advisor_default_nudge" "current assigned task" "advisor falls back when no explicit monitor CLI is configured"
if [[ -f "$fake_advisor_marker" ]]; then
  echo "FAIL: advisor should not call claude by default"
  exit 1
fi
echo "PASS: advisor does not call claude by default"

advisor_profiles_dir="$TEST_TMP_DIR/advisor-profiles"
advisor_call_marker="$TEST_TMP_DIR/profile-advisor-called"
mkdir -p "$advisor_profiles_dir"
cat > "$advisor_profiles_dir/advisor-glm.json" <<'EOF'
{
  "id": "advisor-glm",
  "name": "Advisor GLM",
  "isDefault": false,
  "isAdvisorDefault": true,
  "cli": "fake-advisor",
  "pipe_flag": "--pipe",
  "model": "glm-advisor"
}
EOF
cat > "$fake_advisor_bin/fake-advisor" <<'EOF'
#!/bin/bash
{
  printf 'args:%s\n' "$*"
  printf 'stdin:'
  cat
} > "$MENTIKO_PROFILE_ADVISOR_MARKER"
echo "profile advisor response"
EOF
chmod 700 "$fake_advisor_bin/fake-advisor"
profile_advisor_nudge="$(
  PATH="$fake_advisor_bin:$PATH" \
  AGENT_PROFILES_DIR="$advisor_profiles_dir" \
  MENTIKO_MONITOR_PROFILE_ID="advisor-glm" \
  MENTIKO_PROFILE_ADVISOR_MARKER="$advisor_call_marker" \
  monitor_stale_nudge_message 2 "fake-session" "fake context" 1
)"
assert_eq "profile advisor response" "$profile_advisor_nudge" "advisor can use explicit advisor profile"
assert_contains "$(cat "$advisor_call_marker")" "--model glm-advisor" "advisor profile passes configured model"
assert_contains "$(cat "$advisor_call_marker")" "AGENT SESSION CAPTURE" "advisor profile receives captured session prompt"

assert_eq "function" \
  "$(type -t strip-terminal-control 2>/dev/null || true)" \
  "portable terminal sanitizer is available"

sanitized_marker_count="$(printf 'noise\n\033[32mAGENT_COMPLETE\033[0m\r\n' \
  | strip-terminal-control \
  | grep -Ec '^[[:space:]]*AGENT_COMPLETE[[:space:]]*$' || true)"

assert_eq "1" \
  "$sanitized_marker_count" \
  "strips ANSI/control codes so AGENT_COMPLETE matches on its own line"

chain_runner_source="$(sed -n '1590,1650p' "$PROJECT_ROOT/lib/chain-runner.sh")"
assert_not_contains "$chain_runner_source" \
  'transport_send_keys "$monitor_session" "bash' \
  "chain monitor starts script directly instead of typing command into shell"

agent_functions_source="$(sed -n '108,132p' "$PROJECT_ROOT/lib/agent-functions.sh")"
assert_not_contains "$agent_functions_source" \
  'send-message "$monitor_session"' \
  "spec monitor starts script directly instead of typing command into shell"

chain_monitor_source="$(sed -n '220,620p' "$PROJECT_ROOT/lib/agent-functions.sh")"
assert_contains "$chain_monitor_source" \
  'launch-chain-runner-complete()' \
  "chain monitor uses a dedicated completion launcher"

assert_contains "$chain_monitor_source" \
  'transport_new_session "$completion_session" env' \
  "chain completion handler starts in a separate pty session"

chain_monitor_body="$(sed -n '430,620p' "$PROJECT_ROOT/lib/agent-functions.sh")"
assert_not_contains "$chain_monitor_body" \
  'nohup bash "$script_dir/chain-runner-complete.sh" "$session_name" "$chain_file"' \
  "chain monitor does not launch completion as a monitor-child nohup job"

launch_agent_source="$(sed -n '110,135p' "$PROJECT_ROOT/lib/launch-agent.sh")"
assert_not_contains "$launch_agent_source" \
  'send-message "$MONITOR_SESSION"' \
  "launch-agent monitor starts script directly instead of typing command into shell"

assert_contains "$launch_agent_source" \
  'MENTIKO_MONITOR_PROFILE_ID' \
  "launch-agent monitor carries advisor profile selection"

spec_monitor_source="$(sed -n '116,132p' "$PROJECT_ROOT/lib/agent-functions.sh")"
assert_contains "$spec_monitor_source" \
  'MENTIKO_MONITOR_PROFILE_ID' \
  "spec monitor carries advisor profile selection"

chain_complete_cleanup_source="$(sed -n '410,425p' "$PROJECT_ROOT/lib/chain-runner-complete.sh")"
assert_contains "$chain_complete_cleanup_source" \
  'transport_session_exists "$MONITOR_SESSION"' \
  "chain completion removes exited monitor sessions"

legacy_complete_cleanup_source="$(sed -n '130,142p' "$PROJECT_ROOT/lib/complete-agent.sh")"
assert_contains "$legacy_complete_cleanup_source" \
  'transport_session_exists "$MONITOR_SESSION"' \
  "legacy completion removes exited monitor sessions"
