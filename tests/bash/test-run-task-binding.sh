#!/bin/bash
# test-run-task-binding.sh - runs created from task execution preserve task id

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

TEST_TMP_DIR="$(mktemp -d)"
trap 'rm -r "$TEST_TMP_DIR"' EXIT

cat > "$TEST_TMP_DIR/chain.json" <<'JSON'
{
  "name": "task-bound-chain",
  "description": "Task-bound run"
}
JSON

export MENTIKO_GLOBAL_ROOT="$TEST_TMP_DIR"
export RUNS_DIR="$TEST_TMP_DIR/runs"
source "$PROJECT_ROOT/lib/run-lib.sh"

run_id="$(create-run "$TEST_TMP_DIR/chain.json" "Task-bound run" "/repo/live-mentiko" "TASK-001")"
run_file="$TEST_TMP_DIR/runs/$run_id/run.json"

task_id="$(jq -r '.taskId // empty' "$run_file")"
if [[ "$task_id" != "TASK-001" ]]; then
  echo "FAIL: create-run should persist taskId"
  cat "$run_file"
  exit 1
fi

workspace_path="$(jq -r '.workspacePath // empty' "$run_file")"
if [[ "$workspace_path" != "/repo/live-mentiko" ]]; then
  echo "FAIL: create-run should preserve workspacePath"
  cat "$run_file"
  exit 1
fi

cat > "$run_file" <<JSON
{
  "id": "$run_id",
  "taskId": "TASK-001",
  "chain": "task-bound-chain",
  "chainId": "task-bound-chain",
  "status": "completed",
  "started": "2026-05-29T00:00:00.000Z",
  "completed": "2026-05-29T00:01:00.000Z",
  "agents": [],
  "artifacts": []
}
JSON

curl_log="$TEST_TMP_DIR/curl.log"
curl() {
  printf '%s\n' "$*" >> "$curl_log"
  local url="${!#}"
  case "$url" in
    *"/api/tasks/TASK-001")
      if [[ "$*" == *"-X PATCH"* ]]; then
        printf '{}\n'
      else
        printf '{"data":{"issue":{"status":"in_progress","metadata":{"auto_run":true}}}}\n'
      fi
      ;;
    *"/api/tasks/TASK-001/comments")
      printf '{}\n'
      ;;
    *)
      printf '{}\n'
      ;;
  esac
}

update-task-from-run "$run_id" "completed" >/dev/null

if grep -q '/api/tasks/TASK-001/close' "$curl_log"; then
  echo "FAIL: completed chain run should not close linked task automatically"
  cat "$curl_log"
  exit 1
fi

if ! grep -q '"status":"open"' "$curl_log"; then
  echo "FAIL: completed chain run should return linked task to open"
  cat "$curl_log"
  exit 1
fi

echo "PASS: create-run persists task binding and completed runs leave task open"
