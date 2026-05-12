#!/bin/bash
# test-profile-resolver.sh - integration tests for profile resolver
#
# tests:
#   1) chain-level profile resolution
#   2) agent-level profile override
#   3) inline field takes priority over profile
#   4) missing profile fallback
#   5) cli_args array handling

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

export AGENT_CHAIN_ROOT="$PROJECT_ROOT"
export NAMESPACE_ID="default"

mkdir -p "$TEST_TENANT_DIR/execution"
mkdir -p "$TEST_TENANT_DIR/model"
mkdir -p "$TEST_CHAIN_DIR"

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

# -------------------------------------------------------------------
# profile file helpers
# -------------------------------------------------------------------

create_execution_profile() {
    local name="$1" cli="$2" cli_args="$3" monitor="$4" max_rounds="$5"
    cat > "$TEST_TENANT_DIR/execution/${name}.json" <<PROFEOF
{
  "id": "${name}-01",
  "name": "$name",
  "type": "execution",
  "description": "test execution profile",
  "created_at": "2026-02-25T00:00:00Z",
  "updated_at": "2026-02-25T00:00:00Z",
  "data": {
    "cli": "$cli",
    "cli_args": $cli_args,
    "monitor": $monitor,
    "max_rounds": $max_rounds,
    "on_complete": "stop"
  }
}
PROFEOF
}

create_model_profile() {
    local name="$1" cli="$2" cli_args="$3"
    cat > "$TEST_TENANT_DIR/model/${name}.json" <<PROFEOF
{
  "id": "${name}-01",
  "name": "$name",
  "type": "model",
  "description": "test model profile",
  "created_at": "2026-02-25T00:00:00Z",
  "updated_at": "2026-02-25T00:00:00Z",
  "data": {
    "cli": "$cli",
    "cli_args": $cli_args
  }
}
PROFEOF
}

create_test_chain() {
    local name="$1" profiles="$2" agent_profiles="$3" inline_cli="$4"
    cat > "$TEST_CHAIN_DIR/${name}.json" <<CHAINEOF
{
  "name": "$name",
  "description": "test chain for profile resolver",
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
      "profiles": $agent_profiles,
      "cli": $inline_cli
    }
  ]
}
CHAINEOF
}

# -------------------------------------------------------------------
# resolver functions (simplified from chain-runner.sh)
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
                cli) jq -r '.data.cli // empty' "$profile_file" 2>/dev/null ;;
                cli_args) jq -r '.data.cli_args // [] | join(" ")' "$profile_file" 2>/dev/null ;;
                monitor) jq -r '.data.monitor // empty' "$profile_file" 2>/dev/null ;;
                max_rounds) jq -r '.data.max_rounds // empty' "$profile_file" 2>/dev/null ;;
                on_complete) jq -r '.data.on_complete // empty' "$profile_file" 2>/dev/null ;;
            esac
            return
        fi
    fi

    local model_profile=$(echo "$agent_profiles" | jq -r '.model // empty' 2>/dev/null)
    if [[ -n "$model_profile" && "$model_profile" != "null" ]]; then
        local profile_file="${TEST_TENANT_DIR}/model/${model_profile}.json"
        if [[ -f "$profile_file" ]]; then
            case "$field" in
                cli) jq -r '.data.cli // empty' "$profile_file" 2>/dev/null ;;
                cli_args) jq -r '.data.cli_args // [] | join(" ")' "$profile_file" 2>/dev/null ;;
            esac
            return
        fi
    fi
    echo ""
}

resolve_config_vars() {
    local CHAIN_FILE="$1" profiles_json="$2"
    local cli="cc" monitor="true" max_rounds="5"

    local exec_profile=$(echo "$profiles_json" | jq -r '.execution // empty' 2>/dev/null)
    if [[ -n "$exec_profile" && "$exec_profile" != "null" ]]; then
        local profile_file="${TEST_TENANT_DIR}/execution/${exec_profile}.json"
        if [[ -f "$profile_file" ]]; then
            local val
            val=$(jq -r '.data.cli // empty' "$profile_file" 2>/dev/null || echo "$cli")
            [[ -n "$val" ]] && cli="$val"
            val=$(jq -r '.data.monitor // empty' "$profile_file" 2>/dev/null || echo "$monitor")
            [[ -n "$val" ]] && monitor="$val"
            val=$(jq -r '.data.max_rounds // empty' "$profile_file" 2>/dev/null || echo "$max_rounds")
            [[ -n "$val" ]] && max_rounds="$val"
        fi
    fi

    local model_profile=$(echo "$profiles_json" | jq -r '.model // empty' 2>/dev/null)
    if [[ -n "$model_profile" && "$model_profile" != "null" ]]; then
        local profile_file="${TEST_TENANT_DIR}/model/${model_profile}.json"
        if [[ -f "$profile_file" ]]; then
            local val
            val=$(jq -r '.data.cli // empty' "$profile_file" 2>/dev/null || echo "$cli")
            [[ -n "$val" ]] && cli="$val"
        fi
    fi

    echo "CLI=$cli"
    echo "MONITOR=$monitor"
    echo "MAX_ROUNDS=$max_rounds"
}

# -------------------------------------------------------------------
# tests
# -------------------------------------------------------------------

test_chain_level_execution_profile() {
    echo "=== test 1: chain-level execution profile resolution ==="
    create_execution_profile "fast-dev" "glm" '["--model", "sonnet"]' false 2
    create_test_chain "chain1" '{"execution": "fast-dev"}' '{}' null

    local profiles_json=$(jq -r '.profiles // {}' "$TEST_CHAIN_DIR/chain1.json")
    local result=$(resolve_config_vars "$TEST_CHAIN_DIR/chain1.json" "$profiles_json")

    assert_contains "$result" "CLI=glm" "cli resolved from execution profile"
    assert_contains "$result" "MAX_ROUNDS=2" "max_rounds resolved from execution profile"
}

test_chain_level_model_profile() {
    echo "=== test 2: chain-level model profile resolution ==="
    create_model_profile "opus4" "claude" '["--model", "opus4"]'
    create_test_chain "chain2" '{"model": "opus4"}' '{}' null

    local profiles_json=$(jq -r '.profiles // {}' "$TEST_CHAIN_DIR/chain2.json")
    local result=$(resolve_config_vars "$TEST_CHAIN_DIR/chain2.json" "$profiles_json")

    assert_contains "$result" "CLI=claude" "cli resolved from model profile"
}

test_agent_level_profile_override() {
    echo "=== test 3: agent-level profile override ==="
    create_execution_profile "agent-fast" "aider" '["--model", "gpt4"]' true 3
    create_test_chain "chain3" '{}' '{"execution": "agent-fast"}' null

    local result=$(resolve_agent_profiles "agent1" "cli" "$TEST_CHAIN_DIR/chain3.json")
    assert_eq "aider" "$result" "agent cli resolved from agent execution profile"
}

test_inline_priority_over_profile() {
    echo "=== test 4: inline field takes priority over profile ==="
    create_execution_profile "should-be-ignored" "glm" '["--fast"]' true 3
    create_test_chain "chain4" '{}' '{"execution": "should-be-ignored"}' '"cc"'

    local profile_cli=$(resolve_agent_profiles "agent1" "cli" "$TEST_CHAIN_DIR/chain4.json")
    local inline_cli=$(jq -r '.agents[0].cli' "$TEST_CHAIN_DIR/chain4.json")
    local final_cli="${inline_cli:-$profile_cli}"

    assert_eq "glm" "$profile_cli" "profile provides glm"
    assert_eq "cc" "$inline_cli" "inline provides cc"
    assert_eq "cc" "$final_cli" "inline takes priority over profile"
}

test_missing_profile_safe() {
    echo "=== test 5: missing profile file doesn't break chain ==="
    create_test_chain "chain5" '{"execution": "does-not-exist"}' '{}' null

    local profiles_json=$(jq -r '.profiles // {}' "$TEST_CHAIN_DIR/chain5.json")
    local result=$(resolve_config_vars "$TEST_CHAIN_DIR/chain5.json" "$profiles_json")

    assert_contains "$result" "CLI=cc" "falls back to default cli when profile missing"
}

test_cli_args_joined() {
    echo "=== test 6: cli_args array joins correctly ==="
    create_execution_profile "with-args" "glm" '["--model", "opus4", "--timeout", "60"]' true 3
    create_test_chain "chain6" '{}' '{"execution": "with-args"}' null

    local result=$(resolve_agent_profiles "agent1" "cli_args" "$TEST_CHAIN_DIR/chain6.json")

    assert_contains "$result" "--model" "cli_args contains --model"
    assert_contains "$result" "opus4" "cli_args contains opus4"
    assert_contains "$result" "--timeout" "cli_args contains --timeout"
    assert_contains "$result" "60" "cli_args contains 60"
}

test_empty_profile_no_override() {
    echo "=== test 7: empty profile values don't override existing ==="
    cat > "$TEST_TENANT_DIR/execution/partial-profile.json" <<'EOF'
{
  "id": "partial-profile-01",
  "name": "partial-profile",
  "type": "execution",
  "description": "test execution profile",
  "created_at": "2026-02-25T00:00:00Z",
  "updated_at": "2026-02-25T00:00:00Z",
  "data": {
    "cli": "glm",
    "cli_args": []
  }
}
EOF
    create_test_chain "chain7" '{"execution": "partial-profile"}' '{}' null

    local profiles_json=$(jq -r '.profiles // {}' "$TEST_CHAIN_DIR/chain7.json")
    local result=$(resolve_config_vars "$TEST_CHAIN_DIR/chain7.json" "$profiles_json")

    assert_contains "$result" "CLI=glm" "cli updated from profile"
    assert_contains "$result" "MAX_ROUNDS=5" "max_rounds keeps chain default (not in profile)"
}

test_chain_and_agent_profile_priority() {
    echo "=== test 8: chain and agent profiles (agent wins) ==="
    create_execution_profile "chain-profile" "cc" '["--default"]' true 3
    create_execution_profile "agent-profile" "aider" '["--fast"]' true 3
    create_test_chain "chain8" '{"execution": "chain-profile"}' '{"execution": "agent-profile"}' null

    local chain_profiles=$(jq -r '.profiles // {}' "$TEST_CHAIN_DIR/chain8.json")
    local chain_result=$(resolve_config_vars "$TEST_CHAIN_DIR/chain8.json" "$chain_profiles")
    local agent_cli=$(resolve_agent_profiles "agent1" "cli" "$TEST_CHAIN_DIR/chain8.json")

    assert_contains "$chain_result" "CLI=cc" "chain-level cli resolved"
    assert_eq "aider" "$agent_cli" "agent-level cli overrides chain-level"
}

# -------------------------------------------------------------------
# run all tests
# -------------------------------------------------------------------

main() {
    echo ""
    echo "profile resolver integration tests"
    echo "=================================="
    echo "  test dir: $TEST_TMP_DIR"
    echo ""

    test_chain_level_execution_profile
    test_chain_level_model_profile
    test_agent_level_profile_override
    test_inline_priority_over_profile
    test_missing_profile_safe
    test_cli_args_joined
    test_empty_profile_no_override
    test_chain_and_agent_profile_priority

    echo ""
    echo "=================================="
    echo "results:"
    echo "  passed: $TESTS_PASSED"
    echo "  failed: $TESTS_FAILED"
    echo "  total:  $TESTS_RUN"
    echo ""

    [[ $TESTS_FAILED -gt 0 ]] && exit 1
    exit 0
}

main
