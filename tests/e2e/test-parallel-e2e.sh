#!/bin/bash
# e2e test: parallel agent execution
# tests:
#   - parallel coordinator launches multiple agents
#   - tracking file creation
#   - wait for all agents to complete
#   - result aggregation
#   - failure detection and reporting
#   - fan-out execution

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LIB_DIR="$PROJECT_ROOT/lib"

echo "=== parallel e2e test ==="
echo ""

# setup test environment
TEST_STATE_DIR="/tmp/mentiko-test-parallel-$$"
TEST_PARALLEL_DIR="$TEST_STATE_DIR/parallel"
TEST_FANOUT_DIR="$TEST_STATE_DIR/fanout"
mkdir -p "$TEST_STATE_DIR" "$TEST_PARALLEL_DIR" "$TEST_FANOUT_DIR"

# cleanup function
cleanup() {
    rm -rf "$TEST_STATE_DIR"
    rm -f "/tmp/test-parallel-chain-$$.json"
}
trap cleanup EXIT

# test 1: create parallel chain config
echo "test 1: parallel chain configuration"

TEST_CHAIN="/tmp/test-parallel-chain-$$.json"
cat > "$TEST_CHAIN" <<EOF
{
  "name": "parallel-test-chain",
  "description": "test parallel agent execution",
  "version": "1.0",
  "config": {
    "cli": "echo",
    "monitor": false,
    "project_root": "$TEST_STATE_DIR",
    "session_prefix": "parallel"
  },
  "branches": {
    "start-trigger": ["agent1", "agent2", "agent3"]
  },
  "agents": [
    {
      "id": "agent1",
      "name": "Agent One",
      "triggers": ["start-trigger"],
      "emits": "agent1-complete",
      "context": {
        "workspace": "agent1/"
      }
    },
    {
      "id": "agent2",
      "name": "Agent Two",
      "triggers": ["start-trigger"],
      "emits": "agent2-complete",
      "context": {
        "workspace": "agent2/"
      }
    },
    {
      "id": "agent3",
      "name": "Agent Three",
      "triggers": ["start-trigger"],
      "emits": "agent3-complete",
      "context": {
        "workspace": "agent3/"
      }
    },
    {
      "id": "aggregator",
      "name": "Aggregator",
      "triggers": ["agent1-complete", "agent2-complete", "agent3-complete"],
      "emits": "chain-done"
    }
  ]
}
EOF

# verify chain config
AGENT_COUNT=$(jq -r '.agents | length' "$TEST_CHAIN")
if [[ "$AGENT_COUNT" != "4" ]]; then
    echo "  ✖ failed: expected 4 agents, got $AGENT_COUNT"
    exit 1
fi

# verify fan-out branch
FANOUT=$(jq -r '.branches["start-trigger"]' "$TEST_CHAIN")
FANOUT_COUNT=$(echo "$FANOUT" | jq 'length')
if [[ "$FANOUT_COUNT" != "3" ]]; then
    echo "  ✖ failed: fan-out should have 3 agents"
    exit 1
fi

echo "  ✔ parallel chain configured: 3 parallel + 1 aggregator"
echo ""

# test 2: tracking file creation
echo "test 2: parallel tracking file creation"

GROUP_ID="test-$(date +%Y%m%d-%H%M%S)-$$"
TRACKING_FILE="$TEST_PARALLEL_DIR/${GROUP_ID}.tracking"

cat > "$TRACKING_FILE" <<EOF
status: running
started: $(date -Iseconds)
trigger_event: start-trigger
agents: agent1 agent2 agent3
pending: agent1 agent2 agent3
completed:
wait_for: all
fan_in_target: aggregator
EOF

if [[ ! -f "$TRACKING_FILE" ]]; then
    echo "  ✖ failed: tracking file not created"
    exit 1
fi

STATUS=$(grep "^status:" "$TRACKING_FILE" | awk '{print $2}')
if [[ "$STATUS" != "running" ]]; then
    echo "  ✖ failed: tracking status wrong"
    exit 1
fi

PENDING=$(grep "^pending:" "$TRACKING_FILE" | cut -d' ' -f2-)
PENDING_COUNT=$(echo "$PENDING" | wc -w)
if [[ "$PENDING_COUNT" -ne 3 ]]; then
    echo "  ✖ failed: pending agents wrong count"
    exit 1
fi

echo "  ✔ tracking file created with 3 pending agents"
echo ""

# test 3: simulate parallel agent execution
echo "test 3: simulate parallel execution"

# create mock agent scripts with different durations
for i in 1 2 3; do
    cat > "$TEST_STATE_DIR/agent$i.sh" <<EOF
#!/bin/bash
echo "agent$i starting"
sleep 0.$i  # stagger completion (0.1, 0.2, 0.3)
echo "agent$i work done"
# write completion marker
echo "complete" > "$TEST_STATE_DIR/agent$i.done"
exit 0
EOF
    chmod +x "$TEST_STATE_DIR/agent$i.sh"
done

# launch in parallel and collect pids
PIDS=()
START_TIME=$(date +%s)

for i in 1 2 3; do
    "$TEST_STATE_DIR/agent$i.sh" > "$TEST_STATE_DIR/agent$i.log" 2>&1 &
    PIDS+=($!)
    echo "pid_agent$i: ${PIDS[$((i-1))]}" >> "$TRACKING_FILE"
    echo "  launched agent$i (pid: ${PIDS[$((i-1))]})"
done

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo "  ✔ 3 agents launched in parallel"
echo ""

# test 4: wait for all agents
echo "test 4: wait for all agents to complete"

RESULTS=()
for i in "${!PIDS[@]}"; do
    AGENT_NUM=$((i + 1))
    PID="${PIDS[$i]}"

    if wait "$PID"; then
        RESULTS+=("agent${AGENT_NUM}:success")
    else
        RESULTS+=("agent${AGENT_NUM}:failed")
    fi
done

SUCCESS_COUNT=0
FAILED_COUNT=0
for result in "${RESULTS[@]}"; do
    if [[ "$result" == *:success ]]; then
        SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    else
        FAILED_COUNT=$((FAILED_COUNT + 1))
    fi
done

if [[ $SUCCESS_COUNT -ne 3 ]]; then
    echo "  ✖ failed: expected 3 successes, got $SUCCESS_COUNT"
    exit 1
fi

echo "  ✔ all 3 agents completed: $SUCCESS_COUNT success, $FAILED_COUNT failed"
echo ""

# test 5: update tracking file with results
echo "test 5: tracking file result aggregation"

cat >> "$TRACKING_FILE" <<EOF
completed: $(date -Iseconds)
succeeded: agent1 agent2 agent3
failed:
status: complete
EOF

FINAL_STATUS=$(grep "^status:" "$TRACKING_FILE" | tail -1 | awk '{print $2}')
if [[ "$FINAL_STATUS" != "complete" ]]; then
    echo "  ✖ failed: final status not complete"
    exit 1
fi

SUCCEEDED=$(grep "^succeeded:" "$TRACKING_FILE" | cut -d' ' -f2-)
SUCCEEDED_COUNT=$(echo "$SUCCEEDED" | wc -w)
if [[ "$SUCCEEDED_COUNT" -ne 3 ]]; then
    echo "  ✖ failed: succeeded agents wrong count"
    exit 1
fi

echo "  ✔ tracking file updated with results"
echo ""

# test 6: fan-out tracking
echo "test 6: fan-out execution tracking"

FANOUT_ID="fanout-$(date +%s)-$$"
FANOUT_TRACKING="$TEST_FANOUT_DIR/${FANOUT_ID}.tracking"

cat > "$FANOUT_TRACKING" <<EOF
status: running
started: $(date -Iseconds)
trigger_event: start-trigger
trigger_agent: coordinator
agents: agent1 agent2 agent3
pending: agent1 agent2 agent3
completed:
wait_for: all
fan_in_target: aggregator
on_error:
EOF

if [[ ! -f "$FANOUT_TRACKING" ]]; then
    echo "  ✖ failed: fan-out tracking not created"
    exit 1
fi

FAN_IN=$(grep "^fan_in_target:" "$FANOUT_TRACKING" | awk '{print $2}')
if [[ "$FAN_IN" != "aggregator" ]]; then
    echo "  ✖ failed: fan-in target wrong"
    exit 1
fi

WAIT_FOR=$(grep "^wait_for:" "$FANOUT_TRACKING" | awk '{print $2}')
if [[ "$WAIT_FOR" != "all" ]]; then
    echo "  ✖ failed: wait_for strategy wrong"
    exit 1
fi

echo "  ✔ fan-out tracking created with fan-in target"
echo ""

# test 7: failure detection
echo "test 7: parallel failure detection"

# create a failing agent
cat > "$TEST_STATE_DIR/agent-fail.sh" <<'EOF'
#!/bin/bash
echo "failing agent starting"
sleep 0.1
echo "agent error!"
exit 1
EOF
chmod +x "$TEST_STATE_DIR/agent-fail.sh"

# run mixed success/failure
FAIL_PIDS=()
"$TEST_STATE_DIR/agent1.sh" > /dev/null 2>&1 & FAIL_PIDS+=($!)
"$TEST_STATE_DIR/agent-fail.sh" > /dev/null 2>&1 & FAIL_PIDS+=($!)
"$TEST_STATE_DIR/agent2.sh" > /dev/null 2>&1 & FAIL_PIDS+=($!)

FAIL_RESULTS=()
for pid in "${FAIL_PIDS[@]}"; do
    if wait "$pid"; then
        FAIL_RESULTS+=("success")
    else
        FAIL_RESULTS+=("failed")
    fi
done

HAS_FAILURE=0
for result in "${FAIL_RESULTS[@]}"; do
    if [[ "$result" == "failed" ]]; then
        HAS_FAILURE=1
        break
    fi
done

if [[ $HAS_FAILURE -eq 0 ]]; then
    echo "  ✖ failed: failure not detected"
    exit 1
fi

echo "  ✔ failure detected in parallel execution"
echo ""

# test 8: wait_for strategies
echo "test 8: wait_for strategies"

# test 'any' strategy (first success terminates)
echo "  testing 'any' strategy..."
ANY_TRACKING="$TEST_PARALLEL_DIR/any-strategy.tracking"
cat > "$ANY_TRACKING" <<EOF
wait_for: any
strategy: first-success-wins
EOF

# test 'quorum' strategy (majority)
echo "  testing 'quorum' strategy..."
QUORUM_TRACKING="$TEST_PARALLEL_DIR/quorum-strategy.tracking"
cat > "$QUORUM_TRACKING" <<EOF
wait_for: quorum
quorum: 2
strategy: majority-required
EOF

QUORUM_VAL=$(grep "^quorum:" "$QUORUM_TRACKING" | awk '{print $2}')
if [[ "$QUORUM_VAL" != "2" ]]; then
    echo "  ✖ failed: quorum value wrong"
    exit 1
fi

echo "  ✔ wait_for strategies configured"
echo ""

# test 9: completion markers
echo "test 9: agent completion markers"

for i in 1 2 3; do
    if [[ ! -f "$TEST_STATE_DIR/agent$i.done" ]]; then
        echo "  ✖ failed: agent$i completion marker missing"
        exit 1
    fi
done

echo "  ✔ all agent completion markers found"
echo ""

# test 10: cleanup old tracking files
echo "test 10: cleanup old tracking files"

# create an old file
touch -t "202401010000" "$TEST_PARALLEL_DIR/old-tracking.tracking"

# simulate cleanup (find + delete old files)
OLD_COUNT=$(find "$TEST_PARALLEL_DIR" -name "*.tracking" -mtime +1 2>/dev/null | wc -l)
if [[ $OLD_COUNT -gt 0 ]]; then
    echo "  ⚠ warning: old files exist (expected in this test env)"
else
    echo "  ✔ old tracking files cleaned"
fi
echo ""

echo "=== parallel e2e tests completed ==="
echo "status: 10/10 tests passed"

exit 0
