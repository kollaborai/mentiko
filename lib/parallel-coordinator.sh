#!/bin/bash
# parallel-coordinator.sh - Coordinate parallel agent execution
#
# usage:
#   parallel-coordinator.sh <chain.json> <agent-id1> <agent-id2> ...
#
# tracks multiple agents running in parallel and waits for all to complete.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v jq &> /dev/null; then
    echo "  error: jq required"
    exit 1
fi

CHAIN_FILE="${1:-}"
shift || true

if [[ -z "$CHAIN_FILE" || ! -f "$CHAIN_FILE" ]]; then
    echo "usage: parallel-coordinator.sh <chain.json> <agent-id1> <agent-id2> ..."
    exit 1
fi

if [[ $# -eq 0 ]]; then
    echo "  error: at least one agent id required"
    exit 1
fi

# read chain config
CHAIN_PROJECT_ROOT=$(jq -r '.config.project_root // "auto"' "$CHAIN_FILE")
if [[ "$CHAIN_PROJECT_ROOT" == "auto" ]]; then
    CHAIN_PROJECT_ROOT="${MENTIKO_GLOBAL_ROOT:-$HOME/.mentiko}"
fi

# state dir (config.sh already sets this with proper collapse logic)
NAMESPACE_ID="${NAMESPACE_ID:-default}"

PROJECT_NAME=$(basename "$CHAIN_PROJECT_ROOT")
STATE_DIR="${STATE_DIR:-${MENTIKO_PROJECT_ROOT:-${MENTIKO_NAMESPACE_ROOT:-$HOME/.mentiko/namespaces/${NAMESPACE_ID}}}/state}"
PARALLEL_DIR="${STATE_DIR}/parallel"
mkdir -p "$PARALLEL_DIR"

# create tracking file
GROUP_ID="$(date +%Y%m%d-%H%M%S)-$$"
TRACKING_FILE="$PARALLEL_DIR/${GROUP_ID}.tracking"

echo "status: running" > "$TRACKING_FILE"
echo "started: $(date -Iseconds)" >> "$TRACKING_FILE"
echo "agents: $*" >> "$TRACKING_FILE"
echo "pending: $*" >> "$TRACKING_FILE"

echo ""
echo "  [parallel coordinator] group: $GROUP_ID"
echo "  agents: $*"
echo "  launching agents in parallel..."
echo ""

# launch each agent in background
pids=()
for agent_id in "$@"; do
    agent_name=$(jq -r --arg id "$agent_id" '.agents[] | select(.id == $id) | .name' "$CHAIN_FILE")
    echo "  [parallel] launching: $agent_name ($agent_id)"

    # source the launch function and run in background
    (
        source "$SCRIPT_DIR/chain-runner.sh"
        launch_chain_agent "$agent_id" 1
    ) &
    pids+=($!)
    echo "pid_${agent_id}: $!" >> "$TRACKING_FILE"
done

echo ""
echo "  [parallel] all ${#pids[@]} agent(s) launched. pids: ${pids[*]}"
echo "  waiting for all to complete..."
echo ""

# wait for all and track results
results=()
for i in "${!pids[@]}"; do
    pid="${pids[$i]}"
    agent_id="${@:$((i+1)):1}"

    if wait "$pid"; then
        echo "  [parallel] ✓ $agent_id complete"
        results+=("$agent_id:success")
    else
        exit_code=$?
        echo "  [parallel] ✗ $agent_id failed (exit $exit_code)"
        results+=("$agent_id:failed:$exit_code")
    fi
done

# update tracking file
echo "status: complete" >> "$TRACKING_FILE"
echo "completed: $(date -Iseconds)" >> "$TRACKING_FILE"
echo "results: ${results[*]}" >> "$TRACKING_FILE"

# check for failures
has_failed=0
for result in "${results[@]}"; do
    if [[ "$result" == *:failed* ]]; then
        has_failed=1
        break
    fi
done

if [[ $has_failed -eq 0 ]]; then
    echo ""
    echo "  [parallel] ✓ all agents completed successfully"
else
    echo ""
    echo "  [parallel] ⚠ some agents failed"
fi

# cleanup old tracking files (older than 1 day)
find "$PARALLEL_DIR" -name "*.tracking" -mtime +1 -delete 2>/dev/null || true

exit $has_failed
