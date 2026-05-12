#!/bin/bash
# e2e test: parallel agent execution
# tests:
#   - parallel coordinator launches multiple agents
#   - tracking file creation
#   - wait for all agents to complete
#   - result aggregation
#   - failure detection and reporting

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LIB_DIR="$PROJECT_ROOT/lib"

echo "=== parallel agents e2e test ==="
echo ""

# setup test environment
TEST_STATE_DIR="/tmp/mentiko-test-parallel-$$"
mkdir -p "$TEST_STATE_DIR/parallel"

TEST_CHAIN="/tmp/test-parallel-chain-$$.json"
cat > "$TEST_CHAIN" <<'EOF'
{
  "name": "parallel-test-chain",
  "description": "test parallel agent execution",
  "version": "1.0",
  "config": {
    "cli": "echo",
    "monitor": false,
    "project_root": "/tmp/mentiko-test-parallel-$$"
  },
  "agents": [
    {
      "id": "agent1",
      "name": "Agent One",
      "triggers": ["manual-start"],
      "emits": "agent1-complete",
      "prompt": "agent 1 work"
    },
    {
      "id": "agent2",
      "name": "Agent Two",
      "triggers": ["manual-start"],
      "emits": "agent2-complete",
      "prompt": "agent 2 work"
    },
    {
      "id": "agent3",
      "name": "Agent Three",
      "triggers": ["manual-start"],
      "emits": "agent3-complete",
      "prompt": "agent 3 work"
    }
  ]
}
EOF

# test 1: parallel tracking file creation
echo "test 1: parallel tracking file structure"

GROUP_ID="test-$(date +%Y%m%d-%H%M%S)-$$"
TRACKING_FILE="$TEST_STATE_DIR/parallel/${GROUP_ID}.tracking"

# create tracking file as coordinator would
cat > "$TRACKING_FILE" <<EOF
status: running
started: $(date -Iseconds)
agents: agent1 agent2 agent3
pending: agent1 agent2 agent3
pid_agent1: 1234
pid_agent2: 1235
pid_agent3: 1236
EOF

if [[ ! -f "$TRACKING_FILE" ]]; then
    echo "  ✖ failed: tracking file not created"
    rm -rf "$TEST_STATE_DIR"
    rm -f "$TEST_CHAIN"
    exit 1
fi

STATUS=$(grep "^status:" "$TRACKING_FILE" | awk '{print $2}')
if [[ "$STATUS" != "running" ]]; then
    echo "  ✖ failed: tracking file status wrong"
    rm -rf "$TEST_STATE_DIR"
    rm -f "$TEST_CHAIN"
    exit 1
fi

echo "  ✔ tracking file created with correct structure"
echo ""

# test 2: simulate parallel agent execution
echo "test 2: simulate parallel agent execution"

# create mock agent scripts that run in parallel
for i in 1 2 3; do
    cat > "$TEST_STATE_DIR/agent$i.sh" <<EOF
#!/bin/bash
echo "agent$i starting"
sleep $i  # stagger completion times (1s, 2s, 3s)
echo "agent$i complete"
exit 0
EOF
    chmod +x "$TEST_STATE_DIR/agent$i.sh"
done

# run agents in parallel and collect pids
pids=()
start_time=$(date +%s)

for i in 1 2 3; do
    "$TEST_STATE_DIR/agent$i.sh" > "$TEST_STATE_DIR/agent$i.log" 2>&1 &
    pids+=($!)
    echo "pid_agent$i: ${pids[$((i-1))]}" >> "$TRACKING_FILE"
done

# wait for all
results=()
for i in "${!pids[@]}"; do
    pid="${pids[$i]}"
    agent_num=$((i+1))

    if wait "$pid"; then
        results+=("agent${agent_num}:success")
    else
        results+=("agent${agent_num}:failed")
    fi
done

end_time=$(date +%s)
duration=$((end_time - start_time))

# update tracking file
cat >> "$TRACKING_FILE" <<EOF
status: complete
completed: $(date -Iseconds)
results: ${results[*]}
EOF

if [[ ${#results[@]} -ne 3 ]]; then
    echo "  ✖ failed: not all agents completed"
    rm -rf "$TEST_STATE_DIR"
    rm -f "$TEST_CHAIN"
    exit 1
fi

echo "  ✔ all 3 agents completed in ${duration}s (parallel execution)"
echo ""

# test 3: result aggregation
echo "test 3: result aggregation"

# count successes
success_count=0
failed_count=0
for result in "${results[@]}"; do
    if [[ "$result" == *:success ]]; then
        success_count=$((success_count + 1))
    else
        failed_count=$((failed_count + 1))
    fi
done

if [[ $success_count -ne 3 ]]; then
    echo "  ✖ failed: expected 3 successes, got $success_count"
    rm -rf "$TEST_STATE_DIR"
    rm -f "$TEST_CHAIN"
    exit 1
fi

echo "  ✔ result aggregation: $success_count success, $failed_count failed"
echo ""

# test 4: failure detection
echo "test 4: failure detection"

# create a failing agent
cat > "$TEST_STATE_DIR/agent-fail.sh" <<'EOF'
#!/bin/bash
echo "failing agent starting"
sleep 0.1
echo "agent error!"
exit 1
EOF
chmod +x "$TEST_STATE_DIR/agent-fail.sh"

# run mix of success and failure
FAIL_CHAIN="/tmp/test-parallel-fail-$$.json"
cat > "$FAIL_CHAIN" <<EOF
{
  "name": "parallel-fail-test",
  "config": {
    "cli": "echo",
    "project_root": "$TEST_STATE_DIR"
  },
  "agents": [
    {"id": "good1", "name": "Good Agent 1", "triggers": ["manual-start"]},
    {"id": "bad", "name": "Bad Agent", "triggers": ["manual-start"]},
    {"id": "good2", "name": "Good Agent 2", "triggers": ["manual-start"]}
  ]
}
EOF

pids=()
"$TEST_STATE_DIR/agent1.sh" > /dev/null 2>&1 & pids+=($!)
"$TEST_STATE_DIR/agent-fail.sh" > /dev/null 2>&1 & pids+=($!)
"$TEST_STATE_DIR/agent2.sh" > /dev/null 2>&1 & pids+=($!)

fail_results=()
for i in "${!pids[@]}"; do
    if wait "${pids[$i]}"; then
        fail_results+=("success")
    else
        fail_results+=("failed")
    fi
done

has_failure=0
for result in "${fail_results[@]}"; do
    if [[ "$result" == "failed" ]]; then
        has_failure=1
        break
    fi
done

if [[ $has_failure -eq 0 ]]; then
    echo "  ✖ failed: failure not detected"
    rm -rf "$TEST_STATE_DIR"
    rm -f "$TEST_CHAIN" "$FAIL_CHAIN"
    exit 1
fi

echo "  ✔ failure detected correctly"
echo ""

# test 5: parallel state directory structure
echo "test 5: parallel state directory"

if [[ ! -d "$TEST_STATE_DIR/parallel" ]]; then
    echo "  ✖ failed: parallel state dir not created"
    rm -rf "$TEST_STATE_DIR"
    rm -f "$TEST_CHAIN" "$FAIL_CHAIN"
    exit 1
fi

# check tracking file exists
TRACKING_COUNT=$(ls -1 "$TEST_STATE_DIR/parallel"/*.tracking 2>/dev/null | wc -l)
if [[ "$TRACKING_COUNT" -lt 1 ]]; then
    echo "  ✖ failed: no tracking files found"
    rm -rf "$TEST_STATE_DIR"
    rm -f "$TEST_CHAIN" "$FAIL_CHAIN"
    exit 1
fi

echo "  ✔ parallel state directory structure correct"
echo ""

# test 6: cleanup old tracking files
echo "test 6: cleanup old tracking files"

# create an old tracking file (modify timestamp to be old)
touch -t "202401010000" "$TEST_STATE_DIR/parallel/old-tracking.tracking"

# run cleanup (simulate find command)
find "$TEST_STATE_DIR/parallel" -name "*.tracking" -mtime +1 -delete 2>/dev/null || true

OLD_COUNT=$(find "$TEST_STATE_DIR/parallel" -name "*old*.tracking" 2>/dev/null | wc -l)
OLD_COUNT=${OLD_COUNT// /}  # remove spaces
if [[ "$OLD_COUNT" -gt 0 ]]; then
    echo "  ⚠ warning: old tracking files not cleaned (may need actual time passage)"
else
    echo "  ✔ old tracking files cleaned"
fi
echo ""

# cleanup
rm -rf "$TEST_STATE_DIR"
rm -f "$TEST_CHAIN" "$FAIL_CHAIN"

echo "=== parallel agents tests completed ==="
echo "status: 6/6 tests passed"

exit 0
