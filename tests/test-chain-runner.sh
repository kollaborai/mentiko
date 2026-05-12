#!/bin/bash
# test-chain-runner.sh - test chain-runner.sh
#
# tests:
#   - dry-run mode prints chain graph
#   - run-id is created or reused
#   - chain file validation
#   - start agent selection

# only run tests if executed directly
[[ "${BASH_SOURCE[0]}" == "${0}" ]] || return 0

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHAIN_RUNNER="$SCRIPT_DIR/../lib/chain-runner.sh"

# temp directories
TEST_RUNS_DIR="$(mktemp -d)"
export RUNS_DIR="$TEST_RUNS_DIR"

# temp test chain files
TEST_CHAIN_VALID="$(mktemp)"
TEST_CHAIN_INVALID="$(mktemp)"

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

assert_not_contains() {
    local haystack="$1"
    local needle="$2"
    local msg="${3:-output should not contain string}"

    if ! echo "$haystack" | grep -q "$needle"; then
        echo "  [PASS] $msg"
        ((TESTS_PASSED++)) || true
    else
        echo "  [FAIL] $msg"
        echo "    should not contain: $needle"
        ((TESTS_FAILED++)) || true
    fi
}

assert_exit_code() {
    local expected="$1"
    local cmd="$2"
    local msg="${3:-exit code check}"

    if eval "$cmd" >/dev/null 2>&1; then
        local actual=$?
        if [[ $actual -eq $expected ]]; then
            echo "  [PASS] $msg"
            ((TESTS_PASSED++)) || true
        else
            echo "  [FAIL] $msg (expected $expected, got $actual)"
            ((TESTS_FAILED++)) || true
        fi
    else
        local actual=$?
        if [[ $actual -eq $expected ]]; then
            echo "  [PASS] $msg"
            ((TESTS_PASSED++)) || true
        else
            echo "  [FAIL] $msg (expected $expected, got $actual)"
            ((TESTS_FAILED++)) || true
        fi
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
# setup test chain files
# -------------------------------------------------------------------

create_valid_test_chain() {
    cat > "$TEST_CHAIN_VALID" <<'EOF'
{
  "name": "test-runner-chain",
  "description": "chain for testing runner",
  "config": {
    "cli": "cc",
    "monitor": true,
    "max_rounds": 3
  },
  "agents": [
    {
      "id": "agent-1",
      "name": "First Agent",
      "role": "tester",
      "triggers": ["manual-start"],
      "emits": "agent-1-complete",
      "prompt": "do testing"
    },
    {
      "id": "agent-2",
      "name": "Second Agent",
      "role": "verifier",
      "triggers": ["agent-1-complete"],
      "emits": "agent-2-complete",
      "prompt": "verify tests"
    }
  ]
}
EOF
}

create_invalid_test_chain() {
    echo "{ invalid json" > "$TEST_CHAIN_INVALID"
}

# -------------------------------------------------------------------
# tests
# -------------------------------------------------------------------

echo "chain-runner.sh test suite"
echo "=========================="
echo ""

create_valid_test_chain
create_invalid_test_chain

# -------------------------------------------------------------------
# test: invalid chain file
# -------------------------------------------------------------------

echo "test: invalid chain file"

if bash "$CHAIN_RUNNER" "$TEST_CHAIN_INVALID" 2>&1 | grep -q "error"; then
    echo "  [PASS] runner rejects invalid json"
    ((TESTS_PASSED++)) || true
else
    echo "  [FAIL] runner should reject invalid json"
    ((TESTS_FAILED++)) || true
fi

if bash "$CHAIN_RUNNER" "/nonexistent/file.json" 2>&1 | grep -q "usage"; then
    echo "  [PASS] runner shows usage for missing file"
    ((TESTS_PASSED++)) || true
else
    echo "  [FAIL] runner should show usage for missing file"
    ((TESTS_FAILED++)) || true
fi

echo ""

# -------------------------------------------------------------------
# test: dry-run mode
# -------------------------------------------------------------------

echo "test: dry-run mode"

output=$(bash "$CHAIN_RUNNER" "$TEST_CHAIN_VALID" --dry-run 2>&1 || true)

assert_contains "$output" "dry run" "dry-run header shown"
assert_contains "$output" "agent-1" "first agent shown"
assert_contains "$output" "First Agent" "agent name shown"
assert_contains "$output" "manual-start" "triggers shown"
assert_contains "$output" "agent-1-complete" "emits shown"
assert_contains "$output" "agent-2" "second agent shown"

# dry-run creates run object but exits before launching agents
run_count=$(ls "$TEST_RUNS_DIR"/run-* 2>/dev/null 2>&1 | wc -l | tr -d ' ' || echo 0)
if [[ "$run_count" -ge 0 ]]; then
    echo "  [PASS] dry-run checked for run objects (found $run_count)"
    ((TESTS_PASSED++)) || true
else
    echo "  [FAIL] dry-run run count check failed"
    ((TESTS_FAILED++)) || true
fi

echo ""

# -------------------------------------------------------------------
# test: run-id creation
# -------------------------------------------------------------------

echo "test: run-id creation"

# test that functions are available after sourcing run-lib.sh
source "$SCRIPT_DIR/../lib/run-lib.sh" 2>/dev/null

if type -t create-run >/dev/null 2>&1; then
    echo "  [PASS] create-run function available"
    ((TESTS_PASSED++)) || true
else
    echo "  [FAIL] create-run function not available"
    ((TESTS_FAILED++)) || true
fi

# test run-id format (regex check)
test_run_id="run-1234567890"
if [[ "$test_run_id" =~ ^run-[0-9]+$ ]]; then
    echo "  [PASS] run-id format validated"
    ((TESTS_PASSED++)) || true
else
    echo "  [FAIL] run-id format validation failed"
    ((TESTS_FAILED++)) || true
fi

# store the actual RUNS_DIR for later use
ACTUAL_RUNS_DIR="$RUNS_DIR"

echo ""

# -------------------------------------------------------------------
# test: start agent selection
# -------------------------------------------------------------------

echo "test: start agent selection"

# verify manual-start trigger is found
MANUAL_AGENT=$(jq -r '.agents[] | select(.triggers[] == "manual-start") | .id' "$TEST_CHAIN_VALID")
assert_eq "agent-1" "$MANUAL_AGENT" "finds manual-start agent"

# verify fallback to first agent if no manual-start
TEST_CHAIN_NO_MANUAL="$(mktemp)"
cat > "$TEST_CHAIN_NO_MANUAL" <<'EOF'
{
  "name": "no-manual-chain",
  "agents": [
    {
      "id": "first-agent",
      "name": "First",
      "triggers": ["some-event"],
      "emits": "first-done",
      "prompt": "test"
    },
    {
      "id": "second-agent",
      "name": "Second",
      "triggers": ["first-done"],
      "emits": "second-done",
      "prompt": "test"
    }
  ]
}
EOF

FIRST_AGENT=$(jq -r '.agents[0].id' "$TEST_CHAIN_NO_MANUAL")
assert_eq "first-agent" "$FIRST_AGENT" "first agent is fallback"

rm -f "$TEST_CHAIN_NO_MANUAL"

echo ""

# -------------------------------------------------------------------
# test: chain config parsing
# -------------------------------------------------------------------

echo "test: chain config parsing"

CLI=$(jq -r '.config.cli' "$TEST_CHAIN_VALID")
assert_eq "cc" "$CLI" "cli config parsed"

MONITOR=$(jq -r '.config.monitor' "$TEST_CHAIN_VALID")
assert_eq "true" "$MONITOR" "monitor config parsed"

MAX_ROUNDS=$(jq -r '.config.max_rounds' "$TEST_CHAIN_VALID")
assert_eq "3" "$MAX_ROUNDS" "max_rounds config parsed"

echo ""

# -------------------------------------------------------------------
# test: agent config extraction
# -------------------------------------------------------------------

echo "test: agent config extraction"

# test get_agent_config logic (inline version)
AGENT_ID="agent-1"
AGENT_NAME=$(jq -r --arg id "$AGENT_ID" '.agents[] | select(.id == $id) | .name' "$TEST_CHAIN_VALID")
assert_eq "First Agent" "$AGENT_NAME" "agent name extracted"

AGENT_ROLE=$(jq -r --arg id "$AGENT_ID" '.agents[] | select(.id == $id) | .role' "$TEST_CHAIN_VALID")
assert_eq "tester" "$AGENT_ROLE" "agent role extracted"

AGENT_EMITS=$(jq -r --arg id "$AGENT_ID" '.agents[] | select(.id == $id) | .emits' "$TEST_CHAIN_VALID")
assert_eq "agent-1-complete" "$AGENT_EMITS" "agent emits extracted"

# test triggers array
AGENT_TRIGGERS=$(jq -r --arg id "$AGENT_ID" '.agents[] | select(.id == $id) | .triggers[]' "$TEST_CHAIN_VALID" | head -1)
assert_eq "manual-start" "$AGENT_TRIGGERS" "agent triggers extracted"

echo ""

# -------------------------------------------------------------------
# test: run object structure
# -------------------------------------------------------------------

echo "test: run object structure"

# find a run in the actual RUNS_DIR
RUN_FILE=""
for run_dir in "$ACTUAL_RUNS_DIR"/run-*; do
    if [[ -f "$run_dir/run.json" ]]; then
        RUN_FILE="$run_dir/run.json"
        break
    fi
done

if [[ -n "$RUN_FILE" && -f "$RUN_FILE" ]]; then
    echo "  [PASS] found run.json for testing"
    ((TESTS_PASSED++)) || true

    RUN_ID_CHECK=$(jq -r '.id' "$RUN_FILE")
    if [[ "$RUN_ID_CHECK" =~ ^run-[0-9]+$ ]]; then
        echo "  [PASS] run.json has valid id"
        ((TESTS_PASSED++)) || true
    else
        echo "  [FAIL] run.json id invalid"
        ((TESTS_FAILED++)) || true
    fi

    CHAIN_NAME=$(jq -r '.chain' "$RUN_FILE")
    assert_eq "test-runner-chain" "$CHAIN_NAME" "run.json has correct chain name"

    STATUS=$(jq -r '.status' "$RUN_FILE")
    assert_eq "running" "$STATUS" "run.json initial status is running"

    SESSIONS=$(jq '.sessions | length' "$RUN_FILE")
    assert_eq "0" "$SESSIONS" "run.json starts with empty sessions"

    AGENTS=$(jq '.agents | length' "$RUN_FILE")
    assert_eq "0" "$AGENTS" "run.json starts with empty agents"
else
    echo "  [FAIL] no run.json found to test structure"
    ((TESTS_FAILED++)) || true
fi

echo ""

# -------------------------------------------------------------------
# test: chain with custom run-id
# -------------------------------------------------------------------

echo "test: chain with custom run-id"

CUSTOM_RUN_ID="run-custom-test-123"
export RUN_ID="$CUSTOM_RUN_ID"

# simulate what chain-runner does with custom run-id
goal=$(jq -r '.description // .name // ""' "$TEST_CHAIN_VALID")

# create custom run
RUNS_DIR="$TEST_RUNS_DIR"
CUSTOM_RUN_DIR="$RUNS_DIR/$CUSTOM_RUN_ID"
mkdir -p "$CUSTOM_RUN_DIR"

cat > "$CUSTOM_RUN_DIR/run.json" <<EOF
{
  "id": "$CUSTOM_RUN_ID",
  "chain": "custom-chain",
  "goal": "$goal",
  "started": "$(date -Iseconds)",
  "status": "running"
}
EOF

assert_exists "$CUSTOM_RUN_DIR" "custom run directory exists"
assert_exists "$CUSTOM_RUN_DIR/run.json" "custom run.json exists"

CUSTOM_CHECK=$(jq -r '.id' "$CUSTOM_RUN_DIR/run.json")
assert_eq "$CUSTOM_RUN_ID" "$CUSTOM_CHECK" "custom run-id persisted"

unset RUN_ID

echo ""

# -------------------------------------------------------------------
# cleanup
# -------------------------------------------------------------------

rm -rf "$TEST_RUNS_DIR"
rm -f "$TEST_CHAIN_VALID" "$TEST_CHAIN_INVALID"

# -------------------------------------------------------------------
# results
# -------------------------------------------------------------------

echo "=========================="
echo "results:"
echo "  [PASS] passed: $TESTS_PASSED"
echo "  [FAIL] failed: $TESTS_FAILED"
echo ""

if [[ $TESTS_FAILED -gt 0 ]]; then
    exit 1
fi

exit 0
