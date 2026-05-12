#!/bin/bash
# e2e test: run object creation and retrieval
# tests:
#   - create-run generates valid run.json
#   - update-run-status changes status
#   - add-run-session adds sessions
#   - update-run-agent updates agent status
#   - get-run retrieves run
#   - list-runs lists all runs

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LIB_DIR="$PROJECT_ROOT/lib"

# source run-lib
source "$LIB_DIR/run-lib.sh"

# setup test fixtures
TEST_RUNS_DIR="/tmp/mentiko-test-runs-$$"
export RUNS_DIR="$TEST_RUNS_DIR"
mkdir -p "$TEST_RUNS_DIR"

# create test chain file
TEST_CHAIN="/tmp/test-chain-$$.json"
cat > "$TEST_CHAIN" <<'EOF'
{
  "name": "test-chain",
  "description": "test chain for run object",
  "version": "1.0.0",
  "config": {
    "cli": "cc",
    "monitor": false
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

echo "=== run object e2e test ==="
echo ""

# test 1: create-run
echo "test 1: create-run"
RUN_ID=$(create-run "$TEST_CHAIN" "test goal for run object")
echo "  created run: $RUN_ID"

if [[ ! "$RUN_ID" =~ ^run-[0-9]+$ ]]; then
    echo "  ✖ failed: invalid run-id format"
    exit 1
fi

RUN_FILE="$TEST_RUNS_DIR/$RUN_ID/run.json"
if [[ ! -f "$RUN_FILE" ]]; then
    echo "  ✖ failed: run.json not created"
    exit 1
fi

# verify run.json structure
CHAIN_NAME=$(jq -r '.chain' "$RUN_FILE")
if [[ "$CHAIN_NAME" != "test-chain" ]]; then
    echo "  ✖ failed: chain name mismatch"
    exit 1
fi

STATUS=$(jq -r '.status' "$RUN_FILE")
if [[ "$STATUS" != "running" ]]; then
    echo "  ✖ failed: initial status not 'running'"
    exit 1
fi

GOAL=$(jq -r '.goal' "$RUN_FILE")
if [[ "$GOAL" != "test goal for run object" ]]; then
    echo "  ✖ failed: goal not saved"
    exit 1
fi

echo "  ✔ create-run passed"
echo ""

# test 2: update-run-status
echo "test 2: update-run-status"
update-run-status "$RUN_ID" "completed"

UPDATED_STATUS=$(jq -r '.status' "$RUN_FILE")
if [[ "$UPDATED_STATUS" != "completed" ]]; then
    echo "  ✖ failed: status not updated"
    exit 1
fi

# check completed timestamp was added
COMPLETED=$(jq -r '.completed' "$RUN_FILE")
if [[ "$COMPLETED" == "null" ]]; then
    echo "  ✖ failed: completed timestamp not added"
    exit 1
fi

echo "  ✔ update-run-status passed"
echo ""

# test 3: add-run-session
echo "test 3: add-run-session"
add-run-session "$RUN_ID" "test-session-123" "agent1"

SESSION_COUNT=$(jq '.sessions | length' "$RUN_FILE")
if [[ "$SESSION_COUNT" -ne 1 ]]; then
    echo "  ✖ failed: session not added"
    exit 1
fi

SESSION_NAME=$(jq -r '.sessions[0]' "$RUN_FILE")
if [[ "$SESSION_NAME" != "test-session-123" ]]; then
    echo "  ✖ failed: session name mismatch"
    exit 1
fi

AGENT_ENTRY=$(jq '.agents[0]' "$RUN_FILE")
AGENT_ID=$(echo "$AGENT_ENTRY" | jq -r '.id')
if [[ "$AGENT_ID" != "agent1" ]]; then
    echo "  ✖ failed: agent id mismatch"
    exit 1
fi

echo "  ✔ add-run-session passed"
echo ""

# test 4: update-run-agent
echo "test 4: update-run-agent"
update-run-agent "$RUN_ID" "agent1" "completed"

AGENT_STATUS=$(jq -r '.agents[0].status' "$RUN_FILE")
if [[ "$AGENT_STATUS" != "completed" ]]; then
    echo "  ✖ failed: agent status not updated"
    exit 1
fi

echo "  ✔ update-run-agent passed"
echo ""

# test 5: get-run
echo "test 5: get-run"
RETRIEVED=$(get-run "$RUN_ID")

RETRIEVED_CHAIN=$(echo "$RETRIEVED" | jq -r '.chain')
if [[ "$RETRIEVED_CHAIN" != "test-chain" ]]; then
    echo "  ✖ failed: retrieved run mismatch"
    exit 1
fi

echo "  ✔ get-run passed"
echo ""

# test 6: list-runs
echo "test 6: list-runs"

# create another run for list testing (ensure unique timestamp)
sleep 1
RUN_ID_2=$(create-run "$TEST_CHAIN" "second test goal")
update-run-status "$RUN_ID_2" "running"

ALL_RUNS=$(list-runs)
RUN_COUNT=$(echo "$ALL_RUNS" | jq 'length')
if [[ "$RUN_COUNT" -lt 2 ]]; then
    echo "  ✖ failed: list-runs returned less than 2 runs (got $RUN_COUNT)"
    exit 1
fi

echo "  ✔ list-runs passed (found $RUN_COUNT runs)"
echo ""

# test 7: list-runs with chain filter
echo "test 7: list-runs with chain filter"
FILTERED=$(list-runs "test-chain")
FILTERED_COUNT=$(echo "$FILTERED" | jq 'length')
if [[ "$FILTERED_COUNT" -lt 2 ]]; then
    echo "  ✖ failed: filter returned wrong count"
    exit 1
fi

# filter by non-existent chain should return empty
EMPTY_FILTER=$(list-runs "non-existent-chain")
EMPTY_COUNT=$(echo "$EMPTY_FILTER" | jq 'length')
if [[ "$EMPTY_COUNT" -ne 0 ]]; then
    echo "  ✖ failed: non-existent chain filter should return empty"
    exit 1
fi

echo "  ✔ list-runs filter passed"
echo ""

# test 8: get-run on non-existent run
echo "test 8: get-run error handling"
BAD_RESULT=$(get-run "non-existent-run" || true)
ERROR=$(echo "$BAD_RESULT" | jq -r '.error // empty')
if [[ "$ERROR" != "run not found" ]]; then
    echo "  ✖ failed: should return error for bad run id"
    exit 1
fi

echo "  ✔ get-run error handling passed"
echo ""

# cleanup
rm -rf "$TEST_RUNS_DIR"
rm -f "$TEST_CHAIN"

echo "=== all run object tests passed ==="
echo "status: 8/8 tests passed"

exit 0
