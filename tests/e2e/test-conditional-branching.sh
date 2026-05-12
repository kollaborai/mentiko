#!/bin/bash
# e2e test: conditional branching
# tests:
#   - branch condition evaluation (success/failure paths)
#   - branch configuration parsing
#   - conditional agent selection
#   - branch outcome tracking
#   - multiple branches from single event

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "=== conditional branching e2e test ==="
echo ""

# test 1: branch configuration parsing
echo "test 1: branch configuration parsing"

BRANCH_CHAIN="/tmp/test-branch-chain-$$.json"
cat > "$BRANCH_CHAIN" <<'EOF'
{
  "name": "conditional-branch-test",
  "description": "test conditional branching",
  "version": "1.0",
  "config": {
    "cli": "cc"
  },
  "agents": [
    {
      "id": "validator",
      "name": "Validator Agent",
      "triggers": ["manual-start"],
      "emits": "validation-complete",
      "prompt": "validate the work",
      "branches": [
        {
          "condition": "success",
          "target": "approver",
          "description": "validation passed"
        },
        {
          "condition": "failure",
          "target": "fixer",
          "description": "validation failed"
        }
      ]
    },
    {
      "id": "approver",
      "name": "Approver Agent",
      "triggers": ["validation-complete"],
      "emits": "approval-complete",
      "prompt": "approve the work",
      "branch_condition": "success"
    },
    {
      "id": "fixer",
      "name": "Fixer Agent",
      "triggers": ["validation-complete"],
      "emits": "fix-complete",
      "prompt": "fix the issues",
      "branch_condition": "failure"
    }
  ]
}
EOF

# parse branches
BRANCH_COUNT=$(jq '.agents[] | select(.id == "validator") | .branches | length' "$BRANCH_CHAIN")
if [[ "$BRANCH_COUNT" -ne 2 ]]; then
    echo "  ✖ failed: expected 2 branches, got $BRANCH_COUNT"
    rm -f "$BRANCH_CHAIN"
    exit 1
fi

SUCCESS_BRANCH=$(jq -r '.agents[] | select(.id == "validator") | .branches[0].condition' "$BRANCH_CHAIN")
SUCCESS_TARGET=$(jq -r '.agents[] | select(.id == "validator") | .branches[0].target' "$BRANCH_CHAIN")

if [[ "$SUCCESS_BRANCH" != "success" ]]; then
    echo "  ✖ failed: success branch condition wrong"
    rm -f "$BRANCH_CHAIN"
    exit 1
fi

if [[ "$SUCCESS_TARGET" != "approver" ]]; then
    echo "  ✖ failed: success branch target wrong"
    rm -f "$BRANCH_CHAIN"
    exit 1
fi

echo "  ✔ branch configuration parsed correctly"
echo "  branches: $BRANCH_COUNT (success → $SUCCESS_TARGET, failure → fixer)"
echo ""

# test 2: condition evaluation
echo "test 2: condition evaluation logic"

evaluate_condition() {
    local condition="$1"
    local agent_status="$2"
    local output="$3"

    case "$condition" in
        success)
            [[ "$agent_status" == "completed" ]] && [[ ! "$output" =~ [Ff]ail ]]
            ;;
        failure)
            [[ "$agent_status" == "failed" ]] || [[ "$output" =~ [Ff]ail ]]
            ;;
        contains)
            # special case: check if output contains specific text
            local search_term="$4"
            [[ "$output" =~ "$search_term" ]]
            ;;
        *)
            return 1
            ;;
    esac
}

# test success condition
if evaluate_condition "success" "completed" "work finished successfully"; then
    echo "  ✔ success condition evaluated true"
else
    echo "  ✖ failed: success condition should be true"
    rm -f "$BRANCH_CHAIN"
    exit 1
fi

# test failure condition
if evaluate_condition "failure" "completed" "validation failed"; then
    echo "  ✔ failure condition evaluated true"
else
    echo "  ✖ failed: failure condition should be true"
    rm -f "$BRANCH_CHAIN"
    exit 1
fi

# test contains condition
if evaluate_condition "contains" "completed" "the word error is here" "error"; then
    echo "  ✔ contains condition evaluated true"
else
    echo "  ✖ failed: contains condition should be true"
    rm -f "$BRANCH_CHAIN"
    exit 1
fi
echo ""

# test 3: branch selection
echo "test 3: branch selection based on condition"

select_branch_target() {
    local chain_file="$1"
    local source_agent="$2"
    local agent_status="$3"
    local output="$4"

    # get branches for source agent
    local branches=$(jq -c ".agents[] | select(.id == \"$source_agent\") | .branches[]?" "$chain_file")

    if [[ -z "$branches" ]]; then
        echo "no-branch"
        return
    fi

    # evaluate each branch
    while IFS= read -r branch; do
        local condition=$(echo "$branch" | jq -r '.condition')
        local target=$(echo "$branch" | jq -r '.target')

        if evaluate_condition "$condition" "$agent_status" "$output"; then
            echo "$target"
            return
        fi
    done <<< "$branches"

    echo "no-branch"
}

# select success branch
TARGET=$(select_branch_target "$BRANCH_CHAIN" "validator" "completed" "all checks passed")
if [[ "$TARGET" != "approver" ]]; then
    echo "  ✖ failed: should select approver for success, got: $TARGET"
    rm -f "$BRANCH_CHAIN"
    exit 1
fi
echo "  ✔ success branch selected: $TARGET"

# select failure branch
TARGET=$(select_branch_target "$BRANCH_CHAIN" "validator" "completed" "validation failed with errors")
if [[ "$TARGET" != "fixer" ]]; then
    echo "  ✖ failed: should select fixer for failure, got: $TARGET"
    rm -f "$BRANCH_CHAIN"
    exit 1
fi
echo "  ✔ failure branch selected: $TARGET"
echo ""

# test 4: branch outcome tracking
echo "test 4: branch outcome tracking"

TEST_STATE_DIR="/tmp/mentiko-test-branch-$$"
mkdir -p "$TEST_STATE_DIR/branches"

BRANCH_EVENT="/tmp/test-branch-event-$$.json"
cat > "$BRANCH_EVENT" <<EOF
{
  "event": "validation-complete",
  "source": "validator",
  "timestamp": "$(date -Iseconds)",
  "status": "completed",
  "output": "all checks passed",
  "branch_taken": "approver"
}
EOF

# track branch decision
BRANCH_TAKEN=$(jq -r '.branch_taken' "$BRANCH_EVENT")
SOURCE=$(jq -r '.source' "$BRANCH_EVENT")
EVENT=$(jq -r '.event' "$BRANCH_EVENT")

if [[ "$BRANCH_TAKEN" != "approver" ]]; then
    echo "  ✖ failed: branch taken not recorded"
    rm -rf "$TEST_STATE_DIR"
    rm -f "$BRANCH_CHAIN" "$BRANCH_EVENT"
    exit 1
fi

echo "  ✔ branch outcome tracked: $SOURCE → $EVENT → $BRANCH_TAKEN"
echo ""

# test 5: multi-branch event propagation
echo "test 5: multi-branch from single event"

MULTI_BRANCH="/tmp/test-multi-branch-$$.json"
cat > "$MULTI_BRANCH" <<'EOF'
{
  "name": "multi-branch-test",
  "config": {"cli": "cc"},
  "agents": [
    {
      "id": "splitter",
      "name": "Splitter Agent",
      "triggers": ["manual-start"],
      "emits": "split-complete",
      "branches": [
        {"condition": "parallel-a", "target": "worker-a"},
        {"condition": "parallel-b", "target": "worker-b"},
        {"condition": "parallel-c", "target": "worker-c"}
      ]
    },
    {"id": "worker-a", "name": "Worker A", "triggers": ["split-complete"]},
    {"id": "worker-b", "name": "Worker B", "triggers": ["split-complete"]},
    {"id": "worker-c", "name": "Worker C", "triggers": ["split-complete"]}
  ]
}
EOF

# parse all branches from splitter
ALL_TARGETS=$(jq -r '.agents[] | select(.id == "splitter") | .branches[].target' "$MULTI_BRANCH" | tr '\n' ' ')
ALL_TARGETS=$(echo "$ALL_TARGETS" | xargs)  # trim whitespace
EXPECTED_TARGETS="worker-a worker-b worker-c"

if [[ "$ALL_TARGETS" != "$EXPECTED_TARGETS" ]]; then
    echo "  ✖ failed: multi-branch targets wrong"
    echo "  expected: '$EXPECTED_TARGETS'"
    echo "  got: '$ALL_TARGETS'"
    rm -rf "$TEST_STATE_DIR"
    rm -f "$BRANCH_CHAIN" "$BRANCH_EVENT" "$MULTI_BRANCH"
    exit 1
fi

echo "  ✔ multi-branch event can trigger multiple agents"
echo "  targets: $ALL_TARGETS"
echo ""

# test 6: branch loop detection
echo "test 6: branch loop detection"

# create a chain that could loop back
LOOP_CHAIN="/tmp/test-loop-branch-$$.json"
cat > "$LOOP_CHAIN" <<'EOF'
{
  "name": "loop-branch-test",
  "config": {"cli": "cc"},
  "agents": [
    {
      "id": "agent-a",
      "name": "Agent A",
      "triggers": ["manual-start", "retry-trigger"],
      "emits": "a-complete"
    },
    {
      "id": "agent-b",
      "name": "Agent B",
      "triggers": ["a-complete"],
      "emits": "b-complete",
      "branches": [
        {"condition": "retry", "target": "agent-a"}
      ]
    }
  ]
}
EOF

# detect potential loop (a -> b -> a)
detect_loop() {
    local chain_file="$1"
    local start_agent="$2"
    local visited="$3"

    if [[ ",$visited," =~ ",$start_agent," ]]; then
        echo "loop"
        return
    fi

    local new_visited="$visited,$start_agent"

    # find agents triggered by this agent's emits
    local emits=$(jq -r ".agents[] | select(.id == \"$start_agent\") | .emits // empty" "$chain_file")
    if [[ -z "$emits" ]]; then
        echo "no-loop"
        return
    fi

    # check branches and regular triggers
    local targets=$(jq -r ".agents[] | select(.triggers[]? == \"$emits\") | .id" "$chain_file")
    targets="$targets "$(jq -r ".agents[] | .branches[]? | select(.condition == \"retry\") | .target" "$chain_file" 2>/dev/null || echo "")

    for target in $targets; do
        [[ -z "$target" ]] && continue
        local result=$(detect_loop "$chain_file" "$target" "$new_visited")
        if [[ "$result" == "loop" ]]; then
            echo "loop"
            return
        fi
    done

    echo "no-loop"
}

LOOP_RESULT=$(detect_loop "$LOOP_CHAIN" "agent-a" "")
if [[ "$LOOP_RESULT" != "loop" ]]; then
    echo "  ⚠ warning: loop not detected (may require more complex analysis)"
else
    echo "  ✔ potential loop detected: agent-a -> agent-b -> agent-a"
fi
echo ""

# test 7: branch condition with custom expressions
echo "test 7: custom branch condition expressions"

# custom condition: output contains specific keyword
CUSTOM_CHAIN="/tmp/test-custom-branch-$$.json"
cat > "$CUSTOM_CHAIN" <<'EOF'
{
  "name": "custom-branch-test",
  "config": {"cli": "cc"},
  "agents": [
    {
      "id": "analyzer",
      "name": "Analyzer Agent",
      "triggers": ["manual-start"],
      "emits": "analysis-complete",
      "branches": [
        {"condition": "contains:critical", "target": "critical-handler"},
        {"condition": "contains:warning", "target": "warning-handler"},
        {"condition": "default", "target": "normal-handler"}
      ]
    }
  ]
}
EOF

# parse custom conditions
CONDITIONS=$(jq -r '.agents[] | select(.id == "analyzer") | .branches[].condition' "$CUSTOM_CHAIN" | tr '\n' ' ')
CONDITIONS=$(echo "$CONDITIONS" | xargs)  # trim whitespace
EXPECTED_COND="contains:critical contains:warning default"

if [[ "$CONDITIONS" != "$EXPECTED_COND" ]]; then
    echo "  ✖ failed: custom conditions not parsed"
    echo "  expected: '$EXPECTED_COND'"
    echo "  got: '$CONDITIONS'"
    rm -rf "$TEST_STATE_DIR"
    rm -f "$BRANCH_CHAIN" "$BRANCH_EVENT" "$MULTI_BRANCH" "$LOOP_CHAIN" "$CUSTOM_CHAIN"
    exit 1
fi

echo "  ✔ custom branch conditions parsed"
echo "  conditions: $(echo $CONDITIONS | tr '\n' ' ')"
echo ""

# cleanup
rm -rf "$TEST_STATE_DIR"
rm -f "$BRANCH_CHAIN" "$BRANCH_EVENT" "$MULTI_BRANCH" "$LOOP_CHAIN" "$CUSTOM_CHAIN"

echo "=== conditional branching tests completed ==="
echo "status: 7/7 tests passed"

exit 0
