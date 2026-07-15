#!/usr/bin/env bash
# Compiled TypeScript Run Record runtime proof.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CLI="$REPO_ROOT/lib/runner-run-record.js"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/mentiko-run-record-e2e.XXXXXX")"
trap 'rm -rf "$TMP_ROOT"' EXIT

export MENTIKO_CODE_ROOT="$REPO_ROOT"
export MENTIKO_GLOBAL_ROOT="$TMP_ROOT/data"
export RUNS_DIR="$MENTIKO_GLOBAL_ROOT/runs"
mkdir -p "$RUNS_DIR"

[[ -f "$CLI" ]] || { echo "FAIL: compiled Run Record bundle missing: $CLI" >&2; exit 1; }

CHAIN="$TMP_ROOT/chain.json"
printf '%s\n' '{"name":"typed-run-record-e2e"}' > "$CHAIN"

# Collision proof: compiled TypeScript mints and exclusively claims every run.
ids_file="$TMP_ROOT/ids"
: > "$ids_file"
for _ in $(seq 1 40); do
  node "$CLI" create --runs-dir "$RUNS_DIR" --chain-file "$CHAIN" --goal "collision proof" >> "$ids_file"
done
unique_count="$(sort -u "$ids_file" | wc -l | tr -d ' ')"
[[ "$unique_count" == "40" ]] || { echo "FAIL: only $unique_count/40 unique typed run ids" >&2; exit 1; }
echo "PASS: compiled TypeScript created 40/40 unique Run Records"

# Concurrent mutation proof: every writer goes through the same typed lock and
# all independent agent transitions survive.
run_id="$(head -1 "$ids_file")"
for agent in $(seq 1 8); do
  node "$CLI" add-session \
    --runs-dir "$RUNS_DIR" --run-id "$run_id" \
    --session "agent-$agent-session" --agent-id "agent-$agent" --agent-name "Agent $agent" >/dev/null
done
for agent in $(seq 1 8); do
  node "$CLI" set-agent-status \
    --runs-dir "$RUNS_DIR" --run-id "$run_id" \
    --agent-id "agent-$agent" --status complete >/dev/null &
done
wait
completed_count="$(node "$CLI" completed-agents --runs-dir "$RUNS_DIR" --run-id "$run_id" | wc -l | tr -d ' ')"
[[ "$completed_count" == "8" ]] || { echo "FAIL: only $completed_count/8 concurrent agent updates landed" >&2; exit 1; }
echo "PASS: 8/8 concurrent typed agent mutations landed"

node "$CLI" set-status --runs-dir "$RUNS_DIR" --run-id "$run_id" --status completed >/dev/null
status="$(node "$CLI" status --runs-dir "$RUNS_DIR" --run-id "$run_id")"
[[ "$status" == "completed" ]] || { echo "FAIL: terminal typed status was $status" >&2; exit 1; }
echo "PASS: compiled TypeScript published terminal Run Record status"

# Shell compatibility names are invocation-only; this smoke proves the real
# exported boundary resolves the same compiled bundle without a fallback loader.
source "$REPO_ROOT/lib/run-lib.sh"
shell_run_id="$(create-run "$CHAIN" "shell invocation boundary")"
update-run-status "$shell_run_id" running
[[ "$(_run_record_cli status --runs-dir "$RUNS_DIR" --run-id "$shell_run_id")" == "running" ]]
echo "PASS: shell compatibility functions invoke the compiled typed boundary"

echo "Run Record e2e: 4 passed, 0 failed"
