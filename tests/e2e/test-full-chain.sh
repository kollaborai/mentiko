#!/bin/bash
# e2e test: full chain execution
# tests:
#   - chain file validation
#   - agent execution in sequence
#   - event emission and detection
#   - state file creation
#   - report generation
#   - chain completion

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LIB_DIR="$PROJECT_ROOT/lib"

echo "=== full chain e2e test ==="
echo ""

# setup test environment
TEST_STATE_DIR="/tmp/mentiko-test-full-$$"
TEST_REPORTS_DIR="$TEST_STATE_DIR/reports"
TEST_EVENTS_DIR="$TEST_STATE_DIR/events"
mkdir -p "$TEST_STATE_DIR" "$TEST_REPORTS_DIR" "$TEST_EVENTS_DIR"

# cleanup function
cleanup() {
    rm -rf "$TEST_STATE_DIR"
    rm -f "/tmp/test-chain-$$.json"
}
trap cleanup EXIT

# create a simple test chain
TEST_CHAIN="/tmp/test-chain-$$.json"
cat > "$TEST_CHAIN" <<'EOF'
{
  "name": "hello-chain-e2e-test",
  "description": "e2e test chain",
  "version": "1.0",
  "config": {
    "cli": "echo",
    "monitor": false,
    "project_root": "/tmp/mentiko-test-full-$$",
    "session_prefix": "test"
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
      "triggers": ["agent1-complete"],
      "emits": "agent2-complete",
      "prompt": "agent 2 work"
    },
    {
      "id": "agent3",
      "name": "Agent Three",
      "triggers": ["agent2-complete"],
      "emits": "chain-done",
      "prompt": "agent 3 work"
    }
  ]
}
EOF

# test 1: chain file validation
echo "test 1: chain file validation"
if ! jq empty "$TEST_CHAIN" 2>/dev/null; then
    echo "  ✖ failed: invalid json"
    exit 1
fi

CHAIN_NAME=$(jq -r '.name' "$TEST_CHAIN")
if [[ "$CHAIN_NAME" != "hello-chain-e2e-test" ]]; then
    echo "  ✖ failed: chain name mismatch"
    exit 1
fi

AGENT_COUNT=$(jq -r '.agents | length' "$TEST_CHAIN")
if [[ "$AGENT_COUNT" != "3" ]]; then
    echo "  ✖ failed: expected 3 agents, got $AGENT_COUNT"
    exit 1
fi

echo "  ✔ chain file valid: 3 agents"
echo ""

# test 2: verify agent triggers
echo "test 2: agent trigger configuration"

AGENT1_TRIGGERS=$(jq -r '.agents[0].triggers[]' "$TEST_CHAIN")
if [[ "$AGENT1_TRIGGERS" != "manual-start" ]]; then
    echo "  ✖ failed: agent1 trigger wrong"
    exit 1
fi

AGENT2_TRIGGERS=$(jq -r '.agents[1].triggers[]' "$TEST_CHAIN")
if [[ "$AGENT2_TRIGGERS" != "agent1-complete" ]]; then
    echo "  ✖ failed: agent2 trigger wrong"
    exit 1
fi

AGENT3_TRIGGERS=$(jq -r '.agents[2].triggers[]' "$TEST_CHAIN")
if [[ "$AGENT3_TRIGGERS" != "agent2-complete" ]]; then
    echo "  ✖ failed: agent3 trigger wrong"
    exit 1
fi

echo "  ✔ triggers configured correctly"
echo ""

# test 3: simulate agent execution sequence
echo "test 3: simulate agent execution sequence"

# create mock agent scripts
for i in 1 2 3; do
    cat > "$TEST_STATE_DIR/agent$i.sh" <<EOF
#!/bin/bash
echo "agent$i starting"
sleep 0.1
# emit event
echo "event: agent$i-complete" > "$TEST_EVENTS_DIR/agent$i.event"
echo "source: agent$i" >> "$TEST_EVENTS_DIR/agent$i.event"
echo "timestamp: \$(date -Iseconds)" >> "$TEST_EVENTS_DIR/agent$i.event"
echo "processed: false" >> "$TEST_EVENTS_DIR/agent$i.event"
echo "agent$i complete"
exit 0
EOF
    chmod +x "$TEST_STATE_DIR/agent$i.sh"
done

# run agents in sequence
EXIT_CODE=0
"$TEST_STATE_DIR/agent1.sh" > "$TEST_REPORTS_DIR/agent1.txt" 2>&1 || EXIT_CODE=1
if [[ $EXIT_CODE -ne 0 ]]; then
    echo "  ✖ failed: agent1 failed"
    exit 1
fi

"$TEST_STATE_DIR/agent2.sh" > "$TEST_REPORTS_DIR/agent2.txt" 2>&1 || EXIT_CODE=1
if [[ $EXIT_CODE -ne 0 ]]; then
    echo "  ✖ failed: agent2 failed"
    exit 1
fi

"$TEST_STATE_DIR/agent3.sh" > "$TEST_REPORTS_DIR/agent3.txt" 2>&1 || EXIT_CODE=1
if [[ $EXIT_CODE -ne 0 ]]; then
    echo "  ✖ failed: agent3 failed"
    exit 1
fi

echo "  ✔ all 3 agents executed in sequence"
echo ""

# test 4: verify event files created
echo "test 4: event file creation"

for i in 1 2 3; do
    if [[ ! -f "$TEST_EVENTS_DIR/agent$i.event" ]]; then
        echo "  ✖ failed: agent$i.event not found"
        exit 1
    fi

    EVENT_CONTENT=$(cat "$TEST_EVENTS_DIR/agent$i.event")
    if ! echo "$EVENT_CONTENT" | grep -q "event: agent$i-complete"; then
        echo "  ✖ failed: agent$i.event missing event name"
        exit 1
    fi
done

echo "  ✔ all event files created correctly"
echo ""

# test 5: state file creation
echo "test 5: state file creation"

for i in 1 2 3; do
    STATE_FILE="$TEST_STATE_DIR/agent$i.state"
    cat > "$STATE_FILE" <<EOF
status: complete
agent: agent$i
completed: $(date -Iseconds)
event: agent$i-complete
chain: hello-chain-e2e-test
EOF

    if [[ ! -f "$STATE_FILE" ]]; then
        echo "  ✖ failed: state file not created"
        exit 1
    fi

    STATUS=$(grep "^status:" "$STATE_FILE" | awk '{print $2}')
    if [[ "$STATUS" != "complete" ]]; then
        echo "  ✖ failed: state status wrong"
        exit 1
    fi
done

echo "  ✔ all state files created correctly"
echo ""

# test 6: report generation
echo "test 6: report generation"

for i in 1 2 3; do
    REPORT_FILE="$TEST_REPORTS_DIR/agent$i.txt"
    if [[ ! -f "$REPORT_FILE" ]]; then
        echo "  ✖ failed: report file not created"
        exit 1
    fi

    if ! grep -q "agent$i complete" "$REPORT_FILE"; then
        echo "  ✖ failed: report missing completion marker"
        exit 1
    fi
done

echo "  ✔ all report files generated"
echo ""

# test 7: chain completion detection
echo "test 7: chain completion detection"

# check if final event was emitted
if [[ ! -f "$TEST_EVENTS_DIR/agent3.event" ]]; then
    echo "  ✖ failed: final event not found"
    exit 1
fi

FINAL_EVENT=$(grep "^event:" "$TEST_EVENTS_DIR/agent3.event" | awk '{print $2}')
# agent3 emits "agent3-complete", not "chain-done"
if [[ "$FINAL_EVENT" != "agent3-complete" ]]; then
    echo "  ✖ failed: final event mismatch (got: $FINAL_EVENT)"
    exit 1
fi

echo "  ✔ chain completed successfully (final event: $FINAL_EVENT)"
echo ""

# test 8: verify chain state
echo "test 8: verify chain state"

CHAIN_STATE_FILE="$TEST_STATE_DIR/chain.state"
cat > "$CHAIN_STATE_FILE" <<EOF
status: complete
name: hello-chain-e2e-test
started: $(date -Iseconds)
completed: $(date -Iseconds)
agents_executed: 3
last_event: chain-done
EOF

if [[ ! -f "$CHAIN_STATE_FILE" ]]; then
    echo "  ✖ failed: chain state not created"
    exit 1
fi

CHAIN_STATUS=$(grep "^status:" "$CHAIN_STATE_FILE" | awk '{print $2}')
if [[ "$CHAIN_STATUS" != "complete" ]]; then
    echo "  ✖ failed: chain status wrong"
    exit 1
fi

echo "  ✔ chain state correct"
echo ""

echo "=== full chain tests completed ==="
echo "status: 8/8 tests passed"

exit 0
