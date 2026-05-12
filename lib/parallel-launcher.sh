#!/bin/bash
# parallel-launcher.sh - Launch multiple agents in parallel
#
# usage:
#   parallel-launcher.sh <chain.json> <agent-id1> <agent-id2> [...]
#
# launches multiple agents simultaneously in background pty sessions.
# waits for all to complete before returning.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v jq &> /dev/null; then
    echo "  error: jq required"
    exit 1
fi

source "$SCRIPT_DIR/chain-runner.sh"

CHAIN_FILE="${1:-}"
shift || true

if [[ -z "$CHAIN_FILE" || ! -f "$CHAIN_FILE" ]]; then
    echo "usage: parallel-launcher.sh <chain.json> <agent-id1> <agent-id2> [...]"
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

PROJECT_NAME=$(basename "$CHAIN_PROJECT_ROOT")
# state dir (config.sh already sets this with proper collapse logic)
NAMESPACE_ID="${NAMESPACE_ID:-default}"
STATE_DIR="${STATE_DIR:-${MENTIKO_PROJECT_ROOT:-${MENTIKO_NAMESPACE_ROOT:-$HOME/.mentiko/namespaces/${NAMESPACE_ID}}}/state}"
PARALLEL_DIR="${STATE_DIR}/parallel"
mkdir -p "$PARALLEL_DIR"

# create a tracking file for this parallel group
GROUP_ID="$(date +%Y%m%d-%H%M%S)-$$"
TRACKING_FILE="$PARALLEL_DIR/${GROUP_ID}.tracking"

echo "status: running" > "$TRACKING_FILE"
echo "started: $(date -Iseconds)" >> "$TRACKING_FILE"
echo "agents: $*" >> "$TRACKING_FILE"
echo "pending: $*" >> "$TRACKING_FILE"

# launch each agent in background
for agent_id in "$@"; do
    echo ""
    echo "  [parallel] launching agent: $agent_id"

    # launch in background - chain-runner.sh will handle the rest
    (
        source "$SCRIPT_DIR/chain-runner.sh"
        launch_chain_agent "$agent_id" 1
    ) &

    # store pid
    echo "pid_${agent_id}: $!" >> "$TRACKING_FILE"
done

echo ""
echo "  [parallel] launched $# agent(s) in background"
echo "  [parallel] tracking: $TRACKING_FILE"
echo ""
echo "  waiting for all agents to complete..."

# wait for all background jobs
wait

echo "  all parallel agents complete"
echo "  status: complete" >> "$TRACKING_FILE"
echo "  completed: $(date -Iseconds)" >> "$TRACKING_FILE"

# cleanup old tracking files (older than 1 day)
find "$PARALLEL_DIR" -name "*.tracking" -mtime +1 -delete 2>/dev/null || true
