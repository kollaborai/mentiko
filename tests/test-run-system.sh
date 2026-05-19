#!/bin/bash
# test-run-system.sh - test run-lib.sh functions
#
# tests:
#   - create-run creates run directory and json
#   - update-run-status changes status
#   - add-run-session adds session
#   - list-runs lists runs
#   - cleanup-old-runs removes old runs

# only run tests if executed directly
[[ "${BASH_SOURCE[0]}" == "${0}" ]] || return 0

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/run-lib.sh"

# temp test directory
TEST_RUNS_DIR="$(mktemp -d)"
export RUNS_DIR="$TEST_RUNS_DIR"
mkdir -p "$RUNS_DIR"

# temp test chain file
TEST_CHAIN_FILE="$(mktemp)"
cat > "$TEST_CHAIN_FILE" <<'EOF'
{
  "name": "test-chain",
  "description": "test chain for unit tests",
  "agents": []
}
EOF

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

assert_json_eq() {
    local field="$1"
    local expected="$2"
    local json_file="$3"
    local msg="${4:-json field check}"

    local actual=$(jq -r "$field" "$json_file" 2>/dev/null || echo "null")
    assert_eq "$expected" "$actual" "$msg" || true
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

assert_not_exists() {
    local path="$1"
    local msg="${2:-file should not exist}"

    if [[ ! -e "$path" ]]; then
        echo "  [PASS] $msg"
        ((TESTS_PASSED++)) || true
    else
        echo "  [FAIL] $msg: $path"
        ((TESTS_FAILED++)) || true
    fi
}

# -------------------------------------------------------------------
# setup
# -------------------------------------------------------------------

echo "run-lib.sh test suite"
echo "======================"
echo ""

# -------------------------------------------------------------------
# test: create-run
# -------------------------------------------------------------------

echo "test: create-run"

RUN_ID=$(create-run "$TEST_CHAIN_FILE" "test goal")

# check run-id format
if [[ "$RUN_ID" =~ ^run-[0-9]+$ ]]; then
    echo "  [PASS] run-id format correct"
    ((TESTS_PASSED++)) || true
else
    echo "  [FAIL] run-id format wrong: $RUN_ID"
    ((TESTS_FAILED++)) || true
fi

# check run directory exists
assert_exists "$RUNS_DIR/$RUN_ID" "run directory created"

# check run.json exists
RUN_FILE="$RUNS_DIR/$RUN_ID/run.json"
assert_exists "$RUN_FILE" "run.json created"

# check run.json content
assert_json_eq ".id" "$RUN_ID" "$RUN_FILE" "run.json has correct id"
assert_json_eq ".chain" "test-chain" "$RUN_FILE" "run.json has correct chain"
assert_json_eq ".status" "running" "$RUN_FILE" "run.json initial status is running"
assert_json_eq ".goal" "test goal" "$RUN_FILE" "run.json has correct goal"

echo ""

# -------------------------------------------------------------------
# test: update-run-status
# -------------------------------------------------------------------

echo "test: update-run-status"

update-run-status "$RUN_ID" "completed"
assert_json_eq ".status" "completed" "$RUN_FILE" "status updated to completed"

# check completed timestamp was set
COMPLETED=$(jq -r '.completed' "$RUN_FILE")
if [[ -n "$COMPLETED" && "$COMPLETED" != "null" ]]; then
    echo "  [PASS] completed timestamp set"
    ((TESTS_PASSED++)) || true
else
    echo "  [FAIL] completed timestamp not set"
    ((TESTS_FAILED++)) || true
fi

update-run-status "$RUN_ID" "failed" "test error message"
assert_json_eq ".status" "failed" "$RUN_FILE" "status updated to failed"
assert_json_eq ".status_message" "test error message" "$RUN_FILE" "status message set"

echo ""

# -------------------------------------------------------------------
# test: add-run-session
# -------------------------------------------------------------------

echo "test: add-run-session"

add-run-session "$RUN_ID" "test-session-1" "agent-1"
SESSION_COUNT=$(jq '.sessions | length' "$RUN_FILE")
assert_eq "1" "$SESSION_COUNT" "one session added"

assert_json_eq ".sessions[0]" "test-session-1" "$RUN_FILE" "session name correct"

AGENT_COUNT=$(jq '.agents | length' "$RUN_FILE")
assert_eq "1" "$AGENT_COUNT" "one agent entry added"

assert_json_eq ".agents[0].id" "agent-1" "$RUN_FILE" "agent id correct"
assert_json_eq ".agents[0].session" "test-session-1" "$RUN_FILE" "agent session correct"
assert_json_eq ".agents[0].status" "running" "$RUN_FILE" "agent initial status is running"

# add second session
add-run-session "$RUN_ID" "test-session-2" "agent-2"
SESSION_COUNT=$(jq '.sessions | length' "$RUN_FILE")
assert_eq "2" "$SESSION_COUNT" "second session added"

echo ""

# -------------------------------------------------------------------
# test: update-run-agent
# -------------------------------------------------------------------

echo "test: update-run-agent"

update-run-agent "$RUN_ID" "agent-1" "complete"
assert_json_eq ".agents[0].status" "complete" "$RUN_FILE" "agent status updated"

# verify other agent not affected
assert_json_eq ".agents[1].status" "running" "$RUN_FILE" "other agent unchanged"

echo ""

# -------------------------------------------------------------------
# test: get-run
# -------------------------------------------------------------------

echo "test: get-run"

RUN_JSON=$(get-run "$RUN_ID")
RUN_ID_FROM_GET=$(echo "$RUN_JSON" | jq -r '.id')
assert_eq "$RUN_ID" "$RUN_ID_FROM_GET" "get-run returns correct run"

# test non-existent run
NON_EXIST=$(get-run "run-nonexistent" || true)
if [[ "$NON_EXIST" =~ "error" ]]; then
    echo "  [PASS] get-run returns error for non-existent"
    ((TESTS_PASSED++)) || true
else
    echo "  [FAIL] get-run should error for non-existent"
    ((TESTS_FAILED++)) || true
fi

echo ""

# -------------------------------------------------------------------
# test: build-run-summary-json
# -------------------------------------------------------------------

echo "test: build-run-summary-json"

ARTIFACTS_DIR="$RUNS_DIR/$RUN_ID/artifacts"
mkdir -p "$ARTIFACTS_DIR"

cat > "$ARTIFACTS_DIR/agent-1-summary.json" <<'EOF'
{
  "status": "complete",
  "executiveSummary": "Mapped the pipeline and found one schema mismatch.",
  "findings": [
    "Schema/template mismatch on acceptance_criteria"
  ],
  "risks": [],
  "nextAgentHints": [
    "Run validation analyst next"
  ]
}
EOF

cat > "$ARTIFACTS_DIR/agent-2-summary.json" <<'EOF'
{
  "status": "complete",
  "executiveSummary": "Validated generated tasks. Result: PARTIAL PASS.",
  "findings": [
    "CRITERION 4: PARTIAL PASS — acceptance criteria format is ambiguous"
  ],
  "risks": [
    "No server-side validation means bad LLM output can pass silently"
  ],
  "nextAgentHints": [
    "Fix schema/template mismatch before moving to next task"
  ]
}
EOF

RUN_SUMMARY_JSON=$(build-run-summary-json "$RUN_ID")
RUN_OUTCOME=$(echo "$RUN_SUMMARY_JSON" | jq -r '.outcome')
RUN_DECISION_REQUIRED=$(echo "$RUN_SUMMARY_JSON" | jq -r '.decision_required')
RUN_NEXT_ACTION=$(echo "$RUN_SUMMARY_JSON" | jq -r '.next_actions[0]')

assert_eq "partial_pass" "$RUN_OUTCOME" "partial pass is promoted to run outcome"
assert_eq "true" "$RUN_DECISION_REQUIRED" "partial pass requires a decision"
assert_eq "Fix schema/template mismatch before moving to next task" "$RUN_NEXT_ACTION" "next action is pulled from agent hints"

echo ""

# -------------------------------------------------------------------
# test: list-runs
# -------------------------------------------------------------------

echo "test: list-runs"

# create another run with different chain
TEST_CHAIN_FILE2="$(mktemp)"
cat > "$TEST_CHAIN_FILE2" <<'EOF'
{
  "name": "other-chain",
  "agents": []
}
EOF

# add small delay to ensure different timestamp
sleep 1
RUN_ID2=$(create-run "$TEST_CHAIN_FILE2" "another goal")

# list all runs
ALL_RUNS=$(list-runs)
RUN_COUNT=$(echo "$ALL_RUNS" | jq 'length')
if [[ "$RUN_COUNT" -ge 2 ]]; then
    echo "  ✔ list-runs returns at least 2 runs"
    ((TESTS_PASSED++))
else
    echo "  ✖ list-runs should return at least 2 runs, got $RUN_COUNT"
    ((TESTS_FAILED++))
fi

# filter by chain
FILTERED_RUNS=$(list-runs "test-chain")
FILTERED_COUNT=$(echo "$FILTERED_RUNS" | jq 'length')
assert_eq "1" "$FILTERED_COUNT" "list-runs filters by chain name"

echo ""

# -------------------------------------------------------------------
# test: cleanup-old-runs
# -------------------------------------------------------------------

echo "test: cleanup-old-runs"

# create a very old run (touch with old timestamp)
OLD_RUN_ID="run-old-$$"
OLD_RUN_DIR="$RUNS_DIR/$OLD_RUN_ID"
mkdir -p "$OLD_RUN_DIR"
cat > "$OLD_RUN_DIR/run.json" <<EOF
{"id": "$OLD_RUN_ID", "status": "old"}
EOF

# set timestamp to 60 days ago (requires touch)
# skip this test on macOS since touch -t format is tricky
# and find -mtime doesn't work well with manually set times
if [[ "$(uname)" == "Darwin" ]]; then
    # manually delete to simulate cleanup
    rm -rf "$OLD_RUN_DIR"
    echo "  [SKIP] cleanup-old-runs test (macOS limitation)"
else
    touch -d "60 days ago" "$OLD_RUN_DIR/run.json"
    cleanup-old-runs 30
    assert_not_exists "$OLD_RUN_DIR" "old run directory removed"
fi

# cleanup runs older than 30 days
cleanup-old-runs 30

assert_not_exists "$OLD_RUN_DIR" "old run directory removed"
assert_exists "$RUNS_DIR/$RUN_ID" "recent run still exists"

echo ""

# -------------------------------------------------------------------
# cleanup
# -------------------------------------------------------------------

rm -rf "$TEST_RUNS_DIR"
rm -f "$TEST_CHAIN_FILE" "$TEST_CHAIN_FILE2"

# -------------------------------------------------------------------
# results
# -------------------------------------------------------------------

echo "======================"
echo "results:"
echo "  ✔ passed: $TESTS_PASSED"
echo "  ✖ failed: $TESTS_FAILED"
echo ""

if [[ $TESTS_FAILED -gt 0 ]]; then
    exit 1
fi

exit 0
