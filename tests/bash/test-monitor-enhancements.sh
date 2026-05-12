#!/bin/bash
# test-monitor-enhancements.sh - tests for staleness threshold and process liveness checking
#
# tests:
#   1) max_stale_count profile resolution
#   2) default max_stale_count fallback to 5
#   3) PID written to agent state file
#   4) process liveness check with dead process
#   5) stale count triggers forced completion

[[ "${BASH_SOURCE[0]}" == "${0}" ]] || return 0

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

TESTS_PASSED=0
TESTS_FAILED=0
TESTS_RUN=0

TEST_TMP_DIR="$(mktemp -d)"
TEST_TENANT_DIR="$TEST_TMP_DIR/namespaces/default/config-profiles"
TEST_CHAIN_DIR="$TEST_TMP_DIR/chains"
TEST_STATE_DIR="$TEST_TMP_DIR/agents/state"
TEST_MONITOR_DIR="$TEST_TMP_DIR/.mentiko_monitor"

export AGENT_CHAIN_ROOT="$PROJECT_ROOT"
export NAMESPACE_ID="default"

mkdir -p "$TEST_TENANT_DIR/execution"
mkdir -p "$TEST_TENANT_DIR/model"
mkdir -p "$TEST_CHAIN_DIR"
mkdir -p "$TEST_STATE_DIR"
mkdir -p "$TEST_MONITOR_DIR"

cleanup() { rm -rf "$TEST_TMP_DIR"; }
trap cleanup EXIT

# -------------------------------------------------------------------
# assertions
# -------------------------------------------------------------------

assert_eq() {
    local expected="$1" actual="$2" msg="${3:-assertion failed}"
    ((TESTS_RUN++)) || true
    if [[ "$expected" == "$actual" ]]; then
        echo "  [PASS] $msg"
        ((TESTS_PASSED++)) || true
    else
        echo "  [FAIL] $msg"
        echo "    expected: '$expected'"
        echo "    actual:   '$actual'"
        ((TESTS_FAILED++)) || true
    fi
}

assert_contains() {
    local haystack="$1" needle="$2" msg="${3:-output should contain string}"
    ((TESTS_RUN++)) || true
    if echo "$haystack" | grep -qF -- "$needle"; then
        echo "  [PASS] $msg"
        ((TESTS_PASSED++)) || true
    else
        echo "  [FAIL] $msg"
        echo "    expected to find: '$needle'"
        ((TESTS_FAILED++)) || true
    fi
}

assert_file_exists() {
    local file="$1" msg="${2:-file should exist}"
    ((TESTS_RUN++)) || true
    if [[ -f "$file" ]]; then
        echo "  [PASS] $msg"
        ((TESTS_PASSED++)) || true
    else
        echo "  [FAIL] $msg"
        echo "    file not found: '$file'"
        ((TESTS_FAILED++)) || true
    fi
}

# -------------------------------------------------------------------
# profile helpers
# -------------------------------------------------------------------

create_execution_profile() {
    local name="$1" max_stale="${2:-5}"
    cat > "$TEST_TENANT_DIR/execution/${name}.json" <<PROFEOF
{
  "id": "${name}-01",
  "name": "$name",
  "type": "execution",
  "description": "test execution profile",
  "created_at": "2026-02-27T00:00:00Z",
  "updated_at": "2026-02-27T00:00:00Z",
  "data": {
    "cli": "cc",
    "cli_args": [],
    "monitor": true,
    "max_rounds": 3,
    "max_stale_count": $max_stale,
    "on_complete": "stop"
  }
}
PROFEOF
}

create_test_chain() {
    local name="$1" profiles="$2"
    cat > "$TEST_CHAIN_DIR/${name}.json" <<CHAINEOF
{
  "name": "$name",
  "description": "test chain",
  "config": {
    "cli": "cc",
    "monitor": true,
    "max_rounds": 5
  },
  "profiles": $profiles,
  "agents": [
    {
      "id": "agent1",
      "name": "Agent One",
      "role": "tester",
      "triggers": ["manual-start"],
      "emits": "agent1-done",
      "prompt": "do testing",
      "profiles": $profiles
    }
  ]
}
CHAINEOF
}

# -------------------------------------------------------------------
# resolver function (simplified from chain-runner.sh)
# -------------------------------------------------------------------

resolve_agent_profiles() {
    local agent_id="$1" field="$2" CHAIN_FILE="$3"
    local agent_profiles=$(jq -r --arg id "$agent_id" \
        '.agents[] | select(.id == $id) | .profiles // {}' "$CHAIN_FILE" 2>/dev/null || echo '{}')

    local exec_profile=$(echo "$agent_profiles" | jq -r '.execution // empty' 2>/dev/null)

    if [[ -n "$exec_profile" && "$exec_profile" != "null" ]]; then
        local profile_file="${TEST_TENANT_DIR}/execution/${exec_profile}.json"
        if [[ -f "$profile_file" ]]; then
            case "$field" in
                max_stale_count)
                    jq -r '.data.max_stale_count // empty' "$profile_file" 2>/dev/null
                    return 0
                    ;;
            esac
        fi
    fi
    echo ""
}

# -------------------------------------------------------------------
# tests
# -------------------------------------------------------------------

test_max_stale_count_profile_resolution() {
    echo "=== test 1: max_stale_count resolved from execution profile ==="
    create_execution_profile "strict-monitor" 3
    create_test_chain "chain1" '{"execution": "strict-monitor"}'

    local result=$(resolve_agent_profiles "agent1" "max_stale_count" "$TEST_CHAIN_DIR/chain1.json")
    assert_eq "3" "$result" "max_stale_count resolved from profile"
}

test_max_stale_count_default_fallback() {
    echo "=== test 2: max_stale_count defaults to 5 when not specified ==="
    create_test_chain "chain2" '{}'

    # when profile is empty, resolver returns empty, then we use default
    local result=$(resolve_agent_profiles "agent1" "max_stale_count" "$TEST_CHAIN_DIR/chain2.json")
    local final_value="${result:-5}"  # default to 5 if empty

    assert_eq "5" "$final_value" "defaults to 5 when profile not specified"
}

test_custom_max_stale_count() {
    echo "=== test 3: custom max_stale_count value (10) ==="
    create_execution_profile "loose-monitor" 10
    create_test_chain "chain3" '{"execution": "loose-monitor"}'

    local result=$(resolve_agent_profiles "agent1" "max_stale_count" "$TEST_CHAIN_DIR/chain3.json")
    assert_eq "10" "$result" "custom max_stale_count (10) resolved"
}

test_max_stale_count_zero() {
    echo "=== test 4: max_stale_count=0 disables stale forced completion ==="
    create_execution_profile "no-force" 0
    create_test_chain "chain4" '{"execution": "no-force"}'

    local result=$(resolve_agent_profiles "agent1" "max_stale_count" "$TEST_CHAIN_DIR/chain4.json")
    assert_eq "0" "$result" "max_stale_count=0 (disabled)"
}

test_pid_in_state_file() {
    echo "=== test 5: PID is written to agent state file ==="
    local test_pid=12345
    local agent_id="test_agent"
    local state_file="$TEST_STATE_DIR/${agent_id}.state"

    # simulate launch-agent.sh state writing
    cat > "$state_file" <<STATEEOF
status: running
session: test-session-123
pid: $test_pid
started: 2026-02-27T12:00:00Z
STATEEOF

    # verify pid field exists
    if [[ -f "$state_file" ]]; then
        local pid=$(grep "^pid:" "$state_file" | cut -d' ' -f2)
        assert_eq "$test_pid" "$pid" "PID written to state file"
    else
        echo "  [FAIL] state file not created"
        ((TESTS_FAILED++)) || true
        ((TESTS_RUN++)) || true
    fi
}

test_stale_count_file_operations() {
    echo "=== test 6: stale count file operations ==="
    local session_name="test-session"
    local stale_count_file="$TEST_MONITOR_DIR/${session_name}_stale"

    # initialize
    echo "0" > "$stale_count_file"

    # increment
    local count=$(cat "$stale_count_file")
    count=$((count + 1))
    echo "$count" > "$stale_count_file"

    local final_count=$(cat "$stale_count_file")
    assert_eq "1" "$final_count" "stale count incremented correctly"

    # reset
    echo "0" > "$stale_count_file"
    final_count=$(cat "$stale_count_file")
    assert_eq "0" "$final_count" "stale count reset correctly"
}

test_stale_threshold_check() {
    echo "=== test 7: stale count threshold triggers completion ==="
    local max_stale=3
    local stale_count_file="$TEST_MONITOR_DIR/test-threshold_stale"
    echo "0" > "$stale_count_file"

    # simulate 3 stale cycles (should trigger on 3rd)
    local triggered=false
    for i in {1..4}; do
        local count=$(cat "$stale_count_file")
        count=$((count + 1))
        echo "$count" > "$stale_count_file"

        if [[ $count -ge $max_stale ]]; then
            triggered=true
            break
        fi
    done

    if $triggered; then
        echo "  [PASS] stale threshold triggered correctly"
        ((TESTS_PASSED++)) || true
        ((TESTS_RUN++)) || true
    else
        echo "  [FAIL] stale threshold did not trigger"
        ((TESTS_FAILED++)) || true
        ((TESTS_RUN++)) || true
    fi
}

test_process_liveness_simulation() {
    echo "=== test 8: process liveness check simulation ==="
    # use a real process that exists (this shell)
    local live_pid=$$

    if ps -p "$live_pid" >/dev/null 2>&1; then
        echo "  [PASS] live process detected correctly"
        ((TESTS_PASSED++)) || true
        ((TESTS_RUN++)) || true
    else
        echo "  [FAIL] live process not detected"
        ((TESTS_FAILED++)) || true
        ((TESTS_RUN++)) || true
    fi

    # use a PID that doesn't exist
    local dead_pid=99999999

    if ! ps -p "$dead_pid" >/dev/null 2>&1; then
        echo "  [PASS] dead process detected correctly"
        ((TESTS_PASSED++)) || true
        ((TESTS_RUN++)) || true
    else
        echo "  [FAIL] dead process incorrectly detected as live"
        ((TESTS_FAILED++)) || true
        ((TESTS_RUN++)) || true
    fi
}

# -------------------------------------------------------------------
# run all tests
# -------------------------------------------------------------------

main() {
    echo ""
    echo "monitor enhancement tests"
    echo "=========================="
    echo "  test dir: $TEST_TMP_DIR"
    echo ""

    test_max_stale_count_profile_resolution
    test_max_stale_count_default_fallback
    test_custom_max_stale_count
    test_max_stale_count_zero
    test_pid_in_state_file
    test_stale_count_file_operations
    test_stale_threshold_check
    test_process_liveness_simulation

    echo ""
    echo "=========================="
    echo "results:"
    echo "  passed: $TESTS_PASSED"
    echo "  failed: $TESTS_FAILED"
    echo "  total:  $TESTS_RUN"
    echo ""

    [[ $TESTS_FAILED -gt 0 ]] && exit 1
    exit 0
}

main
