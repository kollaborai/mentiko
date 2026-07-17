#!/bin/bash
# parallel-launcher.sh - external process boundary for parallel agent launches.
# Group state and result reduction are owned by runner-parallel-contract.js.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh"

CHAIN_FILE="${1:?usage: parallel-launcher.sh <chain.json> <agent...>}"
shift
[[ $# -gt 0 ]] || { echo "error: at least one agent id required" >&2; exit 1; }

parallel_cli() { node "$SCRIPT_DIR/runner-parallel-contract.js" "$@"; }
GROUP_ID="$(parallel_cli create-id --state-dir "${STATE_DIR:?STATE_DIR must be configured}" --agents "$(IFS=,; printf '%s' "$*")")"

pids=()
agents=("$@")
for agent in "${agents[@]}"; do
    # Each child is an external chain-runner process. Do not source the
    # monolithic runner: sourcing it executes its top-level chain lifecycle.
    ( exec "$SCRIPT_DIR/chain-runner.sh" "$CHAIN_FILE" --start "$agent" ) &
    pid=$!
    pids+=("$pid")
    parallel_cli pid --state-dir "$STATE_DIR" --id "$GROUP_ID" --agent "$agent" --pid "$pid" >/dev/null
done

for index in "${!pids[@]}"; do
    exit_code=0
    wait "${pids[$index]}" || exit_code=$?
    parallel_cli result --state-dir "$STATE_DIR" --id "$GROUP_ID" --agent "${agents[$index]}" --exit "$exit_code" >/dev/null
done
