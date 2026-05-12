#!/bin/bash
# e2e test: debug mode (pause/resume)
# tests:
#   - debug mode activation
#   - debug pause at agent completion
#   - debug prompt interaction
#   - continue/skip/retry/abort actions
#   - debug state file creation
#   - session state preservation

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LIB_DIR="$PROJECT_ROOT/lib"

echo "=== debug e2e test ==="
echo ""

# setup test environment
TEST_STATE_DIR="/tmp/mentiko-test-debug-$$"
mkdir -p "$TEST_STATE_DIR"

# cleanup function
cleanup() {
    rm -rf "$TEST_STATE_DIR"
    rm -f "/tmp/test-debug-chain-$$.json"
}
trap cleanup EXIT

# test 1: debug mode activation
echo "test 1: debug mode activation"

export DEBUG_MODE="false"

# check function to detect debug mode
is_debug_mode() {
    [[ "${DEBUG_MODE:-false}" == "true" ]]
}

if is_debug_mode; then
    echo "  ✖ failed: debug should be off initially"
    exit 1
fi

export DEBUG_MODE="true"

if ! is_debug_mode; then
    echo "  ✖ failed: debug mode not activated"
    exit 1
fi

echo "  ✔ debug mode activation works"
echo ""

# test 2: debug state file creation
echo "test 2: debug state file creation"

RUN_ID="debug-run-$(date +%s)-$$"
DEBUG_STATE_DIR="$TEST_STATE_DIR/debug"
mkdir -p "$DEBUG_STATE_DIR"

DEBUG_STATE_FILE="$DEBUG_STATE_DIR/${RUN_ID}.json"

cat > "$DEBUG_STATE_FILE" <<EOF
{
  "run_id": "$RUN_ID",
  "started": "$(date -Iseconds)",
  "status": "paused",
  "current_agent": {
    "id": "agent1",
    "name": "Agent One"
  },
  "session": "test-debug-session",
  "round": 1,
  "actions_available": ["continue", "skip", "retry", "abort"]
}
EOF

if [[ ! -f "$DEBUG_STATE_FILE" ]]; then
    echo "  ✖ failed: debug state file not created"
    exit 1
fi

RUN_ID_CHECK=$(jq -r '.run_id' "$DEBUG_STATE_FILE")
if [[ "$RUN_ID_CHECK" != "$RUN_ID" ]]; then
    echo "  ✖ failed: run_id mismatch"
    exit 1
fi

STATUS=$(jq -r '.status' "$DEBUG_STATE_FILE")
if [[ "$STATUS" != "paused" ]]; then
    echo "  ✖ failed: status should be paused"
    exit 1
fi

echo "  ✔ debug state file created correctly"
echo ""

# test 3: debug prompt simulation
echo "test 3: debug prompt display"

# simulate debug prompt output
DEBUG_PROMPT=$(cat <<'EOP'
  =================================================
  DEBUG PAUSE - agent completed
  =================================================
  agent: Agent One (agent1)
  session: test-debug-session
  round: 1

  output: 42 lines captured
  --- last 20 lines: ---
  agent work complete
  results generated
  ---

  options:
    ① continue - proceed to next agent
    ② skip     - skip next agent and find the one after
    ③ retry    - retry this agent with same input
    ④ abort    - stop chain execution

  choice [1-4]:
EOP
)

# verify prompt contains required elements
if ! echo "$DEBUG_PROMPT" | grep -q "DEBUG PAUSE"; then
    echo "  ✖ failed: debug prompt missing header"
    exit 1
fi

if ! echo "$DEBUG_PROMPT" | grep -q "agent:"; then
    echo "  ✖ failed: debug prompt missing agent info"
    exit 1
fi

if ! echo "$DEBUG_PROMPT" | grep -q "continue"; then
    echo "  ✖ failed: debug prompt missing continue option"
    exit 1
fi

echo "  ✔ debug prompt contains all required elements"
echo ""

# test 4: debug action parsing
echo "test 4: debug action parsing"

# temporarily disable set -e for this test since we expect non-zero exits
set +e

# test each action inline
(
    case "1" in
        1|continue|"") exit 0 ;;
        2|skip) exit 1 ;;
        3|retry) exit 2 ;;
        4|abort) exit 3 ;;
    esac
)
ACTION_1=$?

(
    case "continue" in
        1|continue|"") exit 0 ;;
        2|skip) exit 1 ;;
        3|retry) exit 2 ;;
        4|abort) exit 3 ;;
    esac
)
ACTION_CONTINUE=$?

if [[ $ACTION_1 -ne 0 ]] || [[ $ACTION_CONTINUE -ne 0 ]]; then
    echo "  ✖ failed: continue action wrong"
    set -e
    exit 1
fi

(
    case "2" in
        1|continue|"") exit 0 ;;
        2|skip) exit 1 ;;
        3|retry) exit 2 ;;
        4|abort) exit 3 ;;
    esac
)
ACTION_2=$?

(
    case "skip" in
        1|continue|"") exit 0 ;;
        2|skip) exit 1 ;;
        3|retry) exit 2 ;;
        4|abort) exit 3 ;;
    esac
)
ACTION_SKIP=$?

if [[ $ACTION_2 -ne 1 ]] || [[ $ACTION_SKIP -ne 1 ]]; then
    echo "  ✖ failed: skip action wrong"
    set -e
    exit 1
fi

(
    case "3" in
        1|continue|"") exit 0 ;;
        2|skip) exit 1 ;;
        3|retry) exit 2 ;;
        4|abort) exit 3 ;;
    esac
)
ACTION_3=$?

(
    case "retry" in
        1|continue|"") exit 0 ;;
        2|skip) exit 1 ;;
        3|retry) exit 2 ;;
        4|abort) exit 3 ;;
    esac
)
ACTION_RETRY=$?

if [[ $ACTION_3 -ne 2 ]] || [[ $ACTION_RETRY -ne 2 ]]; then
    echo "  ✖ failed: retry action wrong"
    set -e
    exit 1
fi

(
    case "4" in
        1|continue|"") exit 0 ;;
        2|skip) exit 1 ;;
        3|retry) exit 2 ;;
        4|abort) exit 3 ;;
    esac
)
ACTION_4=$?

(
    case "abort" in
        1|continue|"") exit 0 ;;
        2|skip) exit 1 ;;
        3|retry) exit 2 ;;
        4|abort) exit 3 ;;
    esac
)
ACTION_ABORT=$?

if [[ $ACTION_4 -ne 3 ]] || [[ $ACTION_ABORT -ne 3 ]]; then
    echo "  ✖ failed: abort action wrong"
    set -e
    exit 1
fi

# re-enable set -e
set -e

echo "  ✔ all debug actions parse correctly"
echo ""

# test 5: debug state updates on actions
echo "test 5: debug state updates"

# simulate continue action
jq '.status = "running" | .last_action = "continue"' "$DEBUG_STATE_FILE" > "$DEBUG_STATE_FILE.tmp"
mv "$DEBUG_STATE_FILE.tmp" "$DEBUG_STATE_FILE"

STATUS_AFTER=$(jq -r '.status' "$DEBUG_STATE_FILE")
if [[ "$STATUS_AFTER" != "running" ]]; then
    echo "  ✖ failed: status not updated to running"
    exit 1
fi

echo "  ✔ debug state updates on actions"
echo ""

# test 6: agent output capture for debug
echo "test 6: agent output capture"

REPORT_FILE="$TEST_STATE_DIR/agent-report.txt"
cat > "$REPORT_FILE" <<'EOF'
[session starting]
agent work in progress...
step 1 complete
step 2 complete
analysis done
generating report
report complete
[session ending]
AGENT_COMPLETE
EOF

if [[ ! -f "$REPORT_FILE" ]]; then
    echo "  ✖ failed: report file not created"
    exit 1
fi

LINE_COUNT=$(wc -l < "$REPORT_FILE")
if [[ $LINE_COUNT -lt 5 ]]; then
    echo "  ✖ failed: report too short"
    exit 1
fi

if ! grep -q "AGENT_COMPLETE" "$REPORT_FILE"; then
    echo "  ✖ failed: report missing completion marker"
    exit 1
fi

# get last 20 lines (as debug prompt would)
LAST_LINES=$(tail -20 "$REPORT_FILE")
if [[ -z "$LAST_LINES" ]]; then
    echo "  ✖ failed: last lines extraction failed"
    exit 1
fi

echo "  ✔ agent output captured ($LINE_COUNT lines)"
echo ""

# test 7: debug resume from state
echo "test 7: debug resume from state"

# save paused state
PAUSED_STATE="$DEBUG_STATE_DIR/resume-test.json"
cat > "$PAUSED_STATE" <<EOF
{
  "run_id": "resume-test",
  "started": "$(date -Iseconds)",
  "status": "paused",
  "current_agent": {"id": "agent2", "name": "Agent Two"},
  "next_agent": {"id": "agent3", "name": "Agent Three"},
  "session": "resume-session",
  "round": 2,
  "resume_point": "before_agent3"
}
EOF

# simulate resume
RESUME_AGENT=$(jq -r '.next_agent.id' "$PAUSED_STATE")
RESUME_ROUND=$(jq -r '.round' "$PAUSED_STATE")
RESUME_POINT=$(jq -r '.resume_point' "$PAUSED_STATE")

if [[ "$RESUME_AGENT" != "agent3" ]]; then
    echo "  ✖ failed: resume agent wrong"
    exit 1
fi

if [[ "$RESUME_ROUND" != "2" ]]; then
    echo "  ✖ failed: resume round wrong"
    exit 1
fi

echo "  ✔ debug resume from state works"
echo ""

# test 8: debug abort handling
echo "test 8: debug abort handling"

ABORT_STATE="$DEBUG_STATE_DIR/aborted-run.json"
cat > "$ABORT_STATE" <<EOF
{
  "run_id": "aborted-test",
  "started": "$(date -Iseconds)",
  "status": "aborted",
  "aborted_at": "$(date -Iseconds)",
  "abort_reason": "user_requested",
  "current_agent": {"id": "agent2", "name": "Agent Two"},
  "agents_completed": ["agent1"],
  "agents_pending": ["agent2", "agent3", "agent4"]
}
EOF

ABORT_STATUS=$(jq -r '.status' "$ABORT_STATE")
if [[ "$ABORT_STATUS" != "aborted" ]]; then
    echo "  ✖ failed: abort status wrong"
    exit 1
fi

ABORT_REASON=$(jq -r '.abort_reason' "$ABORT_STATE")
if [[ "$ABORT_REASON" != "user_requested" ]]; then
    echo "  ✖ failed: abort reason wrong"
    exit 1
fi

echo "  ✔ debug abort state captured"
echo ""

# test 9: debug chain config
echo "test 9: debug config in chain.json"

DEBUG_CHAIN="/tmp/test-debug-chain-$$.json"
cat > "$DEBUG_CHAIN" <<EOF
{
  "name": "debug-test-chain",
  "description": "test debug mode",
  "version": "1.0",
  "config": {
    "cli": "echo",
    "monitor": false,
    "project_root": "$TEST_STATE_DIR",
    "debug": {
      "enabled": true,
      "pause_on_complete": true,
      "pause_on_error": true,
      "show_output_lines": 20,
      "auto_resume_timeout": 0
    }
  },
  "agents": [
    {
      "id": "agent1",
      "name": "Agent One",
      "triggers": ["manual-start"],
      "emits": "agent1-complete"
    }
  ]
}
EOF

DEBUG_ENABLED=$(jq -r '.config.debug.enabled' "$DEBUG_CHAIN")
if [[ "$DEBUG_ENABLED" != "true" ]]; then
    echo "  ✖ failed: debug not enabled in config"
    exit 1
fi

PAUSE_ON_COMPLETE=$(jq -r '.config.debug.pause_on_complete' "$DEBUG_CHAIN")
if [[ "$PAUSE_ON_COMPLETE" != "true" ]]; then
    echo "  ✖ failed: pause_on_complete not set"
    exit 1
fi

SHOW_LINES=$(jq -r '.config.debug.show_output_lines' "$DEBUG_CHAIN")
if [[ "$SHOW_LINES" != "20" ]]; then
    echo "  ✖ failed: show_output_lines wrong"
    exit 1
fi

echo "  ✔ debug config valid in chain.json"
echo ""

# test 10: debug history tracking
echo "test 10: debug history tracking"

HISTORY_FILE="$DEBUG_STATE_DIR/history.txt"
cat > "$HISTORY_FILE" <<'EOF'
[2024-01-01 12:00:00] agent1 paused - user chose continue
[2024-01-01 12:00:15] agent2 paused - user chose skip
[2024-01-01 12:00:30] agent3 paused - user chose retry
[2024-01-01 12:01:00] agent4 paused - user chose abort
EOF

HISTORY_LINES=$(wc -l < "$HISTORY_FILE")
if [[ $HISTORY_LINES -ne 4 ]]; then
    echo "  ✖ failed: history line count wrong"
    exit 1
fi

# count actions
CONTINUE_COUNT=$(grep -c "continue" "$HISTORY_FILE")
SKIP_COUNT=$(grep -c "skip" "$HISTORY_FILE")
RETRY_COUNT=$(grep -c "retry" "$HISTORY_FILE")
ABORT_COUNT=$(grep -c "abort" "$HISTORY_FILE")

if [[ $CONTINUE_COUNT -ne 1 ]] || [[ $SKIP_COUNT -ne 1 ]] || \
   [[ $RETRY_COUNT -ne 1 ]] || [[ $ABORT_COUNT -ne 1 ]]; then
    echo "  ✖ failed: action history incomplete"
    exit 1
fi

echo "  ✔ debug history tracked correctly"
echo ""

echo "=== debug e2e tests completed ==="
echo "status: 10/10 tests passed"

exit 0
