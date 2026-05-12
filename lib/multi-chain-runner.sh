#!/bin/bash
# multi-chain-runner.sh - Orchestrate multiple chains in parallel or sequential
#
# usage:
#   multi-chain-runner.sh <batch.json> [--mode parallel|sequential]
#
# batch.json format:
# {
#   "id": "batch-20250225-143000",
#   "mode": "parallel|sequential",
#   "chains": [
#     {"id": "chain1", "file": "/path/to/chain1.json", "goal": "..."},
#     {"id": "chain2", "file": "/path/to/chain2.json", "goal": "..."}
#   ]
# }

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

source "$SCRIPT_DIR/config.sh"
source "$SCRIPT_DIR/run-lib.sh"
source "$SCRIPT_DIR/metrics.sh"

# check jq
if ! command -v jq &> /dev/null; then
    echo "  error: jq required"
    exit 1
fi

BATCH_FILE="${1:-}"
MODE="${2:-parallel}"

if [[ -z "$BATCH_FILE" || ! -f "$BATCH_FILE" ]]; then
    echo "usage: multi-chain-runner.sh <batch.json> [--mode parallel|sequential]"
    exit 1
fi

# validate JSON
if ! jq empty "$BATCH_FILE" 2>/dev/null; then
    echo "  error: invalid JSON in $BATCH_FILE"
    exit 1
fi

# -------------------------------------------------------------------
# read batch config
# -------------------------------------------------------------------

BATCH_ID=$(jq -r '.id // "batch-'"$(date +%Y%m%d-%H%M%S)"'"' "$BATCH_FILE")
BATCH_MODE=$(jq -r '.mode // "parallel"' "$BATCH_FILE")
[[ "$MODE" != "default" ]] && BATCH_MODE="$MODE"

CHAIN_COUNT=$(jq '.chains | length' "$BATCH_FILE")

echo ""
echo "  multi-chain orchestration"
echo "  batch: $BATCH_ID"
echo "  chains: $CHAIN_COUNT"
echo "  mode: $BATCH_MODE"
echo ""

# -------------------------------------------------------------------
# batch state directory (namespace-aware)
# -------------------------------------------------------------------

# BATCH_DIR uses MENTIKO_PROJECT_ROOT from config.sh (already namespace-aware with collapse)
BATCH_DIR="${MENTIKO_PROJECT_ROOT:-${MENTIKO_NAMESPACE_ROOT:-$HOME/.mentiko/namespaces/${NAMESPACE_ID:-default}}}/batches/$BATCH_ID"
mkdir -p "$BATCH_DIR"

# create batch state file
BATCH_STATE="$BATCH_DIR/batch.json"
cat > "$BATCH_STATE" <<BATCHEOF
{
  "id": "$BATCH_ID",
  "mode": "$BATCH_MODE",
  "started": "$(date -Iseconds)",
  "status": "running",
  "chains": []
}
BATCHEOF

# -------------------------------------------------------------------
# run_single_chain: execute one chain and track results
# -------------------------------------------------------------------
run_single_chain() {
    chain_id="$1"
    chain_file="$2"
    chain_goal="$3"
    index="$4"

    echo "  [$((index+1))/$CHAIN_COUNT] running: $chain_id"
    echo "    file:  $chain_file"
    echo "    goal:  ${chain_goal:-<default>}"

    # create run for this chain
    run_id=$(create-run "$chain_file" "$chain_goal")
    chain_dir="$BATCH_DIR/$chain_id"
    mkdir -p "$chain_dir"

    # copy chain file into batch dir
    cp "$chain_file" "$chain_dir/chain.json"

    # run the chain
    start_time=$(date +%s)
    exit_code=0
    output=""
    error_output=""

    if [[ "$BATCH_MODE" == "parallel" ]]; then
        # run in background subshell for parallel mode
        (
            export MENTIKO_RUN_ID="$run_id"
            export CHAIN_RUNNER_OUTPUT="$chain_dir/output.txt"
            export CHAIN_RUNNER_ERROR="$chain_dir/error.txt"

            "$SCRIPT_DIR/chain-runner.sh" "$chain_file" > "$CHAIN_RUNNER_OUTPUT" 2> "$CHAIN_RUNNER_ERROR" || true
        ) &
        pid=$!

        # write pid file for tracking
        echo "$pid" > "$chain_dir/pid"

        # return run_id and pid for tracking
        echo "run_id:$run_id,pid:$pid"
        return 0
    else
        # sequential mode - run and wait
        export MENTIKO_RUN_ID="$run_id"

        if ! output=$("$SCRIPT_DIR/chain-runner.sh" "$chain_file" 2>&1); then
            exit_code=$?
            error_output="$output"
        fi

        end_time=$(date +%s)
        duration=$((end_time - start_time))

        # write chain result
        cat > "$chain_dir/result.json" <<RESOF
{
  "chain_id": "$chain_id",
  "run_id": "$run_id",
  "status": $([[ $exit_code -eq 0 ]] && echo '"complete"' || echo '"failed"'),
  "exit_code": $exit_code,
  "started": "$(date -r $start_time -Iseconds 2>/dev/null || date -Iseconds)",
  "completed": "$(date -r $end_time -Iseconds 2>/dev/null || date -Iseconds)",
  "duration": $duration,
  "output": $(echo "$output" | jq -Rs .),
  "error": $(echo "$error_output" | jq -Rs .)
}
RESOF

        # update batch state
        chain_status="complete"
        [[ $exit_code -ne 0 ]] && chain_status="failed"
        updated=$(jq --arg cid "$chain_id" --arg run "$run_id" --arg st "$chain_status" '
            .chains += [{
              id: $cid,
              run_id: $run,
              status: $st,
              completed: "'"$(date -Iseconds)"'"
            }]
        ' "$BATCH_STATE")
        echo "$updated" > "$BATCH_STATE"

        echo "    status: $([[ $exit_code -eq 0 ]] && echo '✔ complete' || echo '✗ failed') (${duration}s)"
        return $exit_code
    fi
}

# -------------------------------------------------------------------
# parallel mode: launch all chains and wait
# -------------------------------------------------------------------
if [[ "$BATCH_MODE" == "parallel" ]]; then
    echo "  launching $CHAIN_COUNT chain(s) in parallel..."
    echo ""

    declare -A CHAIN_PIDS
    declare -A CHAIN_RUNS

    # launch all chains
    for i in $(seq 0 $((CHAIN_COUNT - 1))); do
        chain_id=$(jq -r ".chains[$i].id" "$BATCH_FILE")
        chain_file=$(jq -r ".chains[$i].file" "$BATCH_FILE")
        chain_goal=$(jq -r ".chains[$i].goal // \"\"" "$BATCH_FILE")

        if [[ ! -f "$chain_file" ]]; then
            echo "  ✗ chain file not found: $chain_file"
            continue
        fi

        result=$(run_single_chain "$chain_id" "$chain_file" "$chain_goal" "$i")

        # parse result
        run_id=$(echo "$result" | grep -o 'run_id:[^,]*' | cut -d: -f2)
        pid=$(echo "$result" | grep -o 'pid:[^,]*' | cut -d: -f2)

        CHAIN_PIDS[$chain_id]=$pid
        CHAIN_RUNS[$chain_id]=$run_id

        # add to batch state as pending
        updated=$(jq --arg cid "$chain_id" --arg run "$run_id" '
            .chains += [{id: $cid, run_id: $run, status: "running"}]
        ' "$BATCH_STATE")
        echo "$updated" > "$BATCH_STATE"
    done

    echo ""
    echo "  waiting for ${#CHAIN_PIDS[@]} chain(s) to complete..."
    echo ""

    # wait for all and collect results
    declare -A CHAIN_RESULTS
    has_failed=0

    for chain_id in "${!CHAIN_PIDS[@]}"; do
        pid="${CHAIN_PIDS[$chain_id]}"
        run_id="${CHAIN_RUNS[$chain_id]}"
        chain_dir="$BATCH_DIR/$chain_id"
        start_time=$(date +%s)

        if wait "$pid"; then
            CHAIN_RESULTS[$chain_id]="complete"
            echo "  ✔ $chain_id complete"
        else
            exit_code=$?
            CHAIN_RESULTS[$chain_id]="failed:$exit_code"
            has_failed=1
            echo "  ✗ $chain_id failed (exit $exit_code)"
        fi

        end_time=$(date +%s)
        duration=$((end_time - start_time))

        # read output if available
        output_file="$chain_dir/output.txt"
        error_file="$chain_dir/error.txt"
        output=""
        error_output=""

        [[ -f "$output_file" ]] && output=$(cat "$output_file")
        [[ -f "$error_file" ]] && error_output=$(cat "$error_file")

        # write result
        cat > "$chain_dir/result.json" <<RESOF
{
  "chain_id": "$chain_id",
  "run_id": "$run_id",
  "status": "${CHAIN_RESULTS[$chain_id]}",
  "started": "$(date -r $start_time -Iseconds 2>/dev/null || date -Iseconds)",
  "completed": "$(date -r $end_time -Iseconds 2>/dev/null || date -Iseconds)",
  "duration": $duration,
  "output": $(echo "$output" | jq -Rs .),
  "error": $(echo "$error_output" | jq -Rs .)
}
RESOF

        # update batch state
        updated=$(jq --arg cid "$chain_id" --arg st "${CHAIN_RESULTS[$chain_id]}" '
            .chains |= map(
                if .id == $cid then .status = $st | .completed = "'"$(date -Iseconds)"'"
                else .
                end
            )
        ' "$BATCH_STATE")
        echo "$updated" > "$BATCH_STATE"
    done

    echo ""

# -------------------------------------------------------------------
# sequential mode: run chains one by one
# -------------------------------------------------------------------
else
    echo "  running $CHAIN_COUNT chain(s) sequentially..."
    echo ""

    has_failed=0

    for i in $(seq 0 $((CHAIN_COUNT - 1))); do
        chain_id=$(jq -r ".chains[$i].id" "$BATCH_FILE")
        chain_file=$(jq -r ".chains[$i].file" "$BATCH_FILE")
        chain_goal=$(jq -r ".chains[$i].goal // \"\"" "$BATCH_FILE")

        if [[ ! -f "$chain_file" ]]; then
            echo "  ✗ chain file not found: $chain_file"
            has_failed=1
            continue
        fi

        if ! run_single_chain "$chain_id" "$chain_file" "$chain_goal" "$i"; then
            has_failed=1
            # continue running other chains even if one fails
        fi

        echo ""
    done
fi

# -------------------------------------------------------------------
# finalize batch
# -------------------------------------------------------------------

final_status="complete"
[[ $has_failed -eq 1 ]] && final_status="partial"

updated=$(jq --arg st "$final_status" '
    .status = $st |
    .completed = "'"$(date -Iseconds)"'"
' "$BATCH_STATE")
echo "$updated" > "$BATCH_STATE"

echo "  batch $final_status: $BATCH_DIR/batch.json"
echo ""

# metrics
metric-counter "batch_runs" 1
metric-counter "batch_${BATCH_MODE}" 1
metric-counter "batch_chains_total" "$CHAIN_COUNT"

exit $has_failed
