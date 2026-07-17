#!/bin/bash
# test-monitor-completion.sh - monitor completion/event detection regressions

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
export MENTIKO_CODE_ROOT="$PROJECT_ROOT"

TEST_TMP_DIR="$(mktemp -d)"
trap 'rm -r "$TEST_TMP_DIR"' EXIT

EVENTS_DIR="$TEST_TMP_DIR/events"
CHAIN_FILE="$TEST_TMP_DIR/chain.json"
export AGENTS_DIR="$TEST_TMP_DIR/agents"
export CONFIG_PROFILES_DIR="$TEST_TMP_DIR/config-profiles"
mkdir -p "$EVENTS_DIR" "$AGENTS_DIR" "$CONFIG_PROFILES_DIR"

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
run_id: run-uam
timestamp: 2026-05-04T02:45:44Z
processed: false
data: done
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

PREFIX_CHAIN_A_FIRST="$TEST_TMP_DIR/prefix-chain-a-first.json"
PREFIX_CHAIN_ALPHA_FIRST="$TEST_TMP_DIR/prefix-chain-alpha-first.json"
AMBIGUOUS_CHAIN="$TEST_TMP_DIR/ambiguous-chain.json"
printf '%s\n' \
  '{"agents":[{"id":"a"},{"id":"alpha"}]}' \
  > "$PREFIX_CHAIN_A_FIRST"
printf '%s\n' \
  '{"agents":[{"id":"alpha"},{"id":"a"}]}' \
  > "$PREFIX_CHAIN_ALPHA_FIRST"
printf '%s\n' \
  '{"agents":[{"id":"a"},{"id":"project-a"}]}' \
  > "$AMBIGUOUS_CHAIN"

assert_eq "alpha" \
  "$(MENTIKO_AGENT_ID= monitor_agent_id_for_session 'project-alpha-run-1' "$PREFIX_CHAIN_A_FIRST")" \
  "prefix-sharing agent ids resolve by delimiter token when shorter id is first"
assert_eq "alpha" \
  "$(MENTIKO_AGENT_ID= monitor_agent_id_for_session 'project-alpha-run-1' "$PREFIX_CHAIN_ALPHA_FIRST")" \
  "prefix-sharing agent ids resolve by delimiter token when longer id is first"
if MENTIKO_AGENT_ID= monitor_agent_id_for_session \
  'project-a-run-1' "$AMBIGUOUS_CHAIN" >/dev/null 2>&1; then
  echo "FAIL: ambiguous session identity should fail closed"
  exit 1
else
  echo "PASS: ambiguous session identity fails closed"
fi
if MENTIKO_AGENT_ID= RUN_ID=run-ambiguous monitor_completion_event_file \
  'project-a-run-1' "$AMBIGUOUS_CHAIN" "$EVENTS_DIR" >/dev/null 2>&1; then
  echo "FAIL: completion lookup should propagate ambiguous session identity"
  exit 1
else
  echo "PASS: completion lookup propagates ambiguous session identity"
fi

event_file="$(RUN_ID=run-uam monitor_completion_event_file \
  "mentiko-uam-middleware-architect-run-1777862548347" \
  "$CHAIN_FILE" \
  "$EVENTS_DIR")"

assert_eq "$EVENTS_DIR/uam-middleware-architect-architecture-designed.event" \
  "$event_file" \
  "detects completion event for current agent even if terminal marker scrolled away"

missing_event_file="$(RUN_ID=run-uam monitor_completion_event_file \
  "mentiko-uam-rbac-guest-enforcer-run-1777862548347" \
  "$CHAIN_FILE" \
  "$EVENTS_DIR")"

assert_eq "" "$missing_event_file" "does not match another agent's event"

json_event_file="$(RUN_ID=run-vt monitor_completion_event_file \
  "mentiko-vt-task-pipeline-investigator-run-1779142350356" \
  "$CHAIN_FILE" \
  "$EVENTS_DIR" \
  "task-pipeline-investigator")"

assert_eq "" "$json_event_file" \
  "rejects obsolete JSON completion files"

RUN_EVENTS_DIR="$TEST_TMP_DIR/run-events"
RUN_CHAIN_DIR="$TEST_TMP_DIR/run-chain"
RUN_CHAIN_FILE="$RUN_CHAIN_DIR/chain.json"
mkdir -p "$RUN_EVENTS_DIR" "$RUN_CHAIN_DIR/artifacts"
cat > "$RUN_CHAIN_FILE" <<'JSON'
{
  "agents": [
    {
      "id": "task-generator",
      "name": "Task Generator",
      "triggers": ["manual-start"],
      "emits": "task-generation-complete"
    }
  ]
}
JSON

cat > "$RUN_EVENTS_DIR/task-generation-task-generator-task-generation-complete.event" <<'EOF'
event: task-generation-complete
source: task-generation-task-generator
timestamp: 2026-05-26T16:22:46Z
processed: false
data: stale
EOF
touch -t 202605261622 "$RUN_EVENTS_DIR/task-generation-task-generator-task-generation-complete.event"
touch -t 202605261641 "$RUN_CHAIN_DIR/artifacts/task-generator-started-at.txt"

stale_run_event_file="$(RUN_ID=run-current monitor_completion_event_file \
  "mentiko-task-generation-task-generator-run-1779838906226" \
  "$RUN_CHAIN_FILE" \
  "$RUN_EVENTS_DIR" \
  "task-generator")"

assert_eq "" "$stale_run_event_file" "ignores legacy global event files when current run id exists"

cat > "$RUN_EVENTS_DIR/run-other-task-generation-task-generator-task-generation-complete.event" <<'EOF'
event: task-generation-complete
source: task-generation-task-generator
run_id: run-other
timestamp: 2026-05-26T16:42:46Z
processed: false
data: other run
EOF

mismatched_run_event_file="$(RUN_ID=run-current monitor_completion_event_file \
  "mentiko-task-generation-task-generator-run-1779838906226" \
  "$RUN_CHAIN_FILE" \
  "$RUN_EVENTS_DIR" \
  "task-generator")"

assert_eq "" "$mismatched_run_event_file" "ignores mismatched run-scoped completion events"

cat > "$RUN_EVENTS_DIR/run-current-task-generation-task-generator-task-generation-complete.event" <<'EOF'
event: task-generation-complete
source: task-generation-task-generator
run_id: run-current
timestamp: 2026-05-26T16:42:46Z
processed: false
data: current run
EOF

current_run_event_file="$(RUN_ID=run-current monitor_completion_event_file \
  "mentiko-task-generation-task-generator-run-1779838906226" \
  "$RUN_CHAIN_FILE" \
  "$RUN_EVENTS_DIR" \
  "task-generator")"

assert_eq "$RUN_EVENTS_DIR/run-current-task-generation-task-generator-task-generation-complete.event" \
  "$current_run_event_file" \
  "detects run-scoped completion event for current run"

# A typed lifecycle operational failure is different from a legitimate no-match.
# Exercise the three shell integration points with an injected lookup failure so
# none can classify it as "no event yet" or a dead agent without a handoff.
extract_agent_function() {
  sed -n "/^$1() {/,/^}/p" "$PROJECT_ROOT/lib/agent-functions.sh"
}
eval "$(extract_agent_function 'agent-completion-latched')"
eval "$(extract_agent_function 'monitor-agent-died')"
eval "$(extract_agent_function 'monitor-with-ai')"
eval "$(extract_agent_function 'monitor-chain-agent')"

agent-complete-marker-seen() { return 1; }
agent-complete-marker-durable() { return 1; }
_monitor_resolve_agent_id() { printf '%s\n' "middleware-architect"; }
transport_has_session() { return 0; }
transport_capture() { printf '%s\n' "stable output"; }
_monitor_agent_process_gone() { [[ "${INJECT_PROCESS_GONE:-0}" == "1" ]]; }
sleep() { :; }

lifecycle_failure_marker="$TEST_TMP_DIR/lifecycle-failure-misclassified"
monitor_completion_event_file() {
  echo "error: injected typed lifecycle failure" >&2
  return 1
}
_monitor_emit_diagnostic_event() {
  : > "$lifecycle_failure_marker"
}

set +e
latch_failure_output="$(
  MENTIKO_RUN_ID="run-uam" EVENTS_DIR="$EVENTS_DIR" \
    agent-completion-latched \
      "mentiko-uam-middleware-architect-run-1777862548347" \
      "$TEST_TMP_DIR/lifecycle-failure-latch" \
      "$CHAIN_FILE" \
      "$EVENTS_DIR" \
      "middleware-architect" 2>&1
)"
latch_failure_rc=$?
set -e
assert_eq "2" "$latch_failure_rc" "completion latch propagates typed lifecycle operational failure"
assert_contains "$latch_failure_output" \
  "injected typed lifecycle failure" \
  "completion latch preserves typed lifecycle error evidence"

set +e
dead_agent_failure_output="$(
  MENTIKO_RUN_ID="run-uam" EVENTS_DIR="$EVENTS_DIR" \
    monitor-agent-died \
      "mentiko-uam-middleware-architect-run-1777862548347" \
      "$CHAIN_FILE" 2>&1
)"
dead_agent_failure_rc=$?
set -e
assert_eq "2" "$dead_agent_failure_rc" "dead-agent classifier propagates typed lifecycle operational failure"
assert_contains "$dead_agent_failure_output" \
  "cannot classify exited agent" \
  "dead-agent classifier records why classification stopped"
if [[ -f "$lifecycle_failure_marker" ]]; then
  echo "FAIL: lifecycle lookup failure must not emit a false dead-agent diagnostic"
  exit 1
fi
echo "PASS: lifecycle lookup failure does not emit a false dead-agent diagnostic"

monitor_test_home="$TEST_TMP_DIR/monitor-home"
mkdir -p "$monitor_test_home"
set +e
dead_monitor_failure_output="$(
  HOME="$monitor_test_home" \
  CHAIN_FILE="$CHAIN_FILE" \
  EVENTS_DIR="$EVENTS_DIR" \
  MENTIKO_RUN_ID="run-uam" \
  INJECT_PROCESS_GONE="1" \
    monitor-with-ai \
      "mentiko-uam-middleware-architect-run-1777862548347" \
      0 2>&1
)"
dead_monitor_failure_rc=$?
set -e
assert_eq "2" "$dead_monitor_failure_rc" "legacy monitor stops when dead-agent lifecycle lookup fails"
assert_not_contains "$dead_monitor_failure_output" \
  "process gone with NO completion event" \
  "legacy monitor does not translate lifecycle failure into missing handoff"

set +e
chain_monitor_failure_output="$(
  HOME="$monitor_test_home" \
  WORKSPACE_TYPE="ssh" \
  EVENTS_DIR="$EVENTS_DIR" \
  MENTIKO_RUN_ID="run-uam" \
  MENTIKO_AGENT_ID="middleware-architect" \
    monitor-chain-agent \
      "mentiko-uam-middleware-architect-run-1777862548347" \
      0 \
      "" \
      "$CHAIN_FILE" \
      2 2>&1
)"
chain_monitor_failure_rc=$?
set -e
assert_eq "2" "$chain_monitor_failure_rc" "chain monitor stops when event observation lifecycle lookup fails"
assert_contains "$chain_monitor_failure_output" \
  "completion-event observation failed" \
  "chain monitor records why event observation stopped"
assert_not_contains "$chain_monitor_failure_output" \
  "completion event observed" \
  "chain monitor does not translate lifecycle failure into observed or absent event state"

unset -f monitor_completion_event_file
set +e
missing_lookup_output="$(
  MENTIKO_RUN_ID="run-uam" EVENTS_DIR="$EVENTS_DIR" \
    agent-completion-latched \
      "mentiko-uam-middleware-architect-run-1777862548347" \
      "$TEST_TMP_DIR/missing-lookup-latch" \
      "$CHAIN_FILE" \
      "$EVENTS_DIR" \
      "middleware-architect" 2>&1
)"
missing_lookup_rc=$?
set -e
assert_eq "2" "$missing_lookup_rc" "completion latch fails closed when typed lookup is unavailable"
assert_contains "$missing_lookup_output" \
  "typed completion-event lookup is unavailable" \
  "missing typed lookup is recorded as an operational failure"

unset -f sleep

emit_event_tmp="$TEST_TMP_DIR/emit-events"
mkdir -p "$emit_event_tmp"
(
  EVENTS_DIR="$emit_event_tmp" \
  MENTIKO_RUN_ID="run-emit-test" RUN_ID="run-emit-test" \
    bash "$PROJECT_ROOT/bin/mentiko" emit "artifact-ready" "artifact-agent" "ok"
)
emitted_event_file="$(find "$emit_event_tmp" -type f -name '*.event' | head -1)"
assert_contains "$(basename "$emitted_event_file")" "run-emit-test" "typed emit prefixes run id in filename"
assert_contains "$(cat "$emitted_event_file")" "run_id: run-emit-test" "typed emit writes run id payload"

first_nudge="$(monitor_stale_nudge_message 1)"
assert_not_eq "proceed" "$first_nudge" "first stale nudge is not bare proceed"
assert_contains "$first_nudge" "current assigned task" "first stale nudge keeps agent in scope"

bare_advisor_nudge="$(monitor_sanitize_nudge "proceed" 1)"
assert_not_eq "proceed" "$bare_advisor_nudge" "advisor output is not allowed to stay bare proceed"
assert_contains "$bare_advisor_nudge" "current assigned task" "advisor bare proceed fallback keeps agent in scope"

repeated_bare_nudge="$(monitor_sanitize_nudge $'ok\nok' 1)"
assert_not_eq $'ok\nok' "$repeated_bare_nudge" "advisor repeated bare acknowledgements are replaced"
assert_contains "$repeated_bare_nudge" "current assigned task" "repeated bare acknowledgement fallback keeps agent in scope"

advisor_error_nudge="$(monitor_sanitize_nudge $'Error: LLM provider not available due to configuration error:\nProfile missing required api_key or api_token field. Provider: anthropic\nUse /profile to fix the configuration.' 3)"
assert_not_contains "$advisor_error_nudge" "LLM provider" "advisor provider errors are not sent as nudges"
assert_contains "$advisor_error_nudge" "assigned task" "advisor provider errors fall back to safe task-scoped nudge"

event_specific_nudge="$(CHAIN_FILE="$CHAIN_FILE" monitor_stale_nudge_message \
  3 \
  "mentiko-uam-rbac-guest-enforcer-run-1777862548347" \
  "" \
  5)"
assert_contains "$event_specific_nudge" \
  "mentiko emit guest-enforcement-implemented" \
  "stale fallback nudge includes exact expected event"
assert_contains "$event_specific_nudge" \
  "rbac-guest-enforcer" \
  "stale fallback nudge includes exact current agent id"

monitor_lookup_block="$(cat "$PROJECT_ROOT/lib/monitor-completion.sh")"
assert_not_contains "$monitor_lookup_block" \
  '--recover-consumed' \
  "monitor scans stay active-event-only and cannot replay consumed triggers"

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
  monitor_stale_nudge_message 1 "fake-session" "fake context" 1
)"
assert_contains "$advisor_default_nudge" "current assigned task" "advisor falls back when no explicit monitor CLI is configured"
if [[ -f "$fake_advisor_marker" ]]; then
  echo "FAIL: advisor should not call claude by default"
  exit 1
fi
echo "PASS: advisor does not call claude by default"

monitor_advisor_source="$(sed -n '113,180p' "$PROJECT_ROOT/lib/monitor-completion.sh")"
assert_not_contains "$monitor_advisor_source" \
  'advisor_cli' \
  "advisor monitor does not use unprofiled cli fallback"
assert_not_contains "$monitor_advisor_source" \
  '-p "$prompt"' \
  "advisor monitor does not assume a cli-specific pipe flag"

advisor_profiles_dir="$TEST_TMP_DIR/advisor-profiles"
advisor_call_marker="$TEST_TMP_DIR/profile-advisor-called"
mkdir -p "$advisor_profiles_dir"
cat > "$advisor_profiles_dir/advisor-profile.json" <<'EOF'
{
  "id": "advisor-profile",
  "name": "Advisor Profile",
  "isDefault": false,
  "isAdvisorDefault": true,
  "cli": "fake-advisor",
  "pipe_flag": "--pipe",
  "model": "advisor-model"
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
  MENTIKO_MONITOR_PROFILE_ID="advisor-profile" \
  MENTIKO_PROFILE_ADVISOR_MARKER="$advisor_call_marker" \
  monitor_stale_nudge_message 2 "fake-session" "fake context" 1
)"
assert_eq "profile advisor response" "$profile_advisor_nudge" "advisor can use explicit advisor profile"
assert_contains "$(cat "$advisor_call_marker")" "--model advisor-model" "advisor profile passes configured model"
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

decorated_marker_count="$(printf 'noise\n\342\217\272 AGENT_COMPLETE\n' \
  | strip-terminal-control \
  | sed -E 's/^[[:space:]]*[^[:alnum:]_[:space:]]+[[:space:]]*/ /' \
  | grep -Ec '^[[:space:]]*AGENT_COMPLETE[[:space:]]*$' || true)"

assert_eq "1" \
  "$decorated_marker_count" \
  "normalizes cli status glyphs before matching AGENT_COMPLETE"

chain_runner_source="$(sed -n '1590,1650p' "$PROJECT_ROOT/lib/chain-runner.sh")"
assert_not_contains "$chain_runner_source" \
  'transport_send_keys "$monitor_session" "bash' \
  "chain monitor starts script directly instead of typing command into shell"

# function-anchored (not line numbers) so these survive edits to agent-functions.sh.
spec_monitor_launcher_source="$(sed -n '/^new-agent-from-spec() {/,/^agent-complete-marker-seen() {/p' "$PROJECT_ROOT/lib/agent-functions.sh")"
assert_not_contains "$spec_monitor_launcher_source" \
  'send-message "$monitor_session"' \
  "spec monitor starts script directly instead of typing command into shell"

chain_monitor_source="$(sed -n '/^launch-chain-runner-complete() {/,/^monitor-with-ai() {/p' "$PROJECT_ROOT/lib/agent-functions.sh")"
assert_contains "$chain_monitor_source" \
  'launch-chain-runner-complete()' \
  "chain monitor uses a dedicated completion launcher"

assert_contains "$chain_monitor_source" \
  'runner-v2-completion-launch.js' \
  "chain completion delegates pty creation to the typed launcher"
assert_contains "$chain_monitor_source" \
  'node "$completion_launcher" "$session_name" "$chain_file"' \
  "shell monitor invokes the typed launcher with non-secret argv"
assert_not_contains "$chain_monitor_source" \
  'bash -lc' \
  "chain completion does not add a shell process around the typed entrypoint"
assert_not_contains "$chain_monitor_source" \
  'MENTIKO_AI_GATEWAY_LOCAL_TOKEN=' \
  "chain completion never places the gateway token in pty argv"

assert_contains "$chain_monitor_source" \
  'runner-v2 completion failed closed; no shell completion fallback exists' \
  "typed completion rejects shell fallback when completion pty spawn fails"
assert_not_contains "$chain_monitor_source" \
  'chain-runner-complete.sh' \
  "completion launcher has no shell completion handler reference"
assert_not_contains "$chain_monitor_source" \
  'complete-agent.sh' \
  "completion monitors have no legacy no-chain handler reference"
assert_contains "$chain_monitor_source" \
  'runner-v2 completion unsupported: no chain.json' \
  "no-chain completion fails closed with an explicit diagnostic"

# the monitor loops delegate to typed completion and must not nohup a shell
# completion script themselves.
chain_monitor_body="$(sed -n '/^monitor-with-ai() {/,$p' "$PROJECT_ROOT/lib/agent-functions.sh")"
assert_not_contains "$chain_monitor_body" \
  'nohup bash "$script_dir/chain-runner-complete.sh" "$session_name" "$chain_file"' \
  "chain monitor does not launch retired shell completion as a child job"

chain_completion_gate_source="$(sed -n '/^monitor-chain-agent() {/,$p' "$PROJECT_ROOT/lib/agent-functions.sh")"
assert_contains "$chain_completion_gate_source" \
  "completion event observed" \
  "chain monitor observes event files without treating them as completion"

assert_contains "$chain_completion_gate_source" \
  "waiting for AGENT_COMPLETE" \
  "chain monitor waits for terminal completion marker after event files"

assert_contains "$chain_completion_gate_source" \
  "completion event already exists; nudging for AGENT_COMPLETE" \
  "chain monitor does not let post-event spinner repainting reset the marker nudge forever"

assert_not_contains "$chain_completion_gate_source" \
  "completion event detected" \
  "chain monitor no longer completes on event files alone"

assert_not_contains "$chain_completion_gate_source" \
  "max stale count (\$max_stale_count) reached. forcing completion" \
  "chain monitor no longer force-completes live stale agents without AGENT_COMPLETE"

launch_agent_source="$(sed -n '110,135p' "$PROJECT_ROOT/lib/launch-agent.sh")"
assert_not_contains "$launch_agent_source" \
  'send-message "$MONITOR_SESSION"' \
  "launch-agent monitor starts script directly instead of typing command into shell"

assert_contains "$launch_agent_source" \
  'MENTIKO_MONITOR_PROFILE_ID' \
  "launch-agent monitor carries advisor profile selection"

assert_contains "$spec_monitor_launcher_source" \
  'MENTIKO_MONITOR_PROFILE_ID' \
  "spec monitor carries advisor profile selection"
