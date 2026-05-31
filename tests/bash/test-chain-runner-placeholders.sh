#!/bin/bash
# test-chain-runner-placeholders.sh - prompt placeholder regression coverage

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

TEST_TMP_DIR="$(mktemp -d)"
trap 'rm -r "$TEST_TMP_DIR"' EXIT

CHAIN_FILE="$TEST_TMP_DIR/chain.json"
cat > "$CHAIN_FILE" <<'JSON'
{
  "name": "placeholder-test",
  "description": "Test placeholder expansion"
}
JSON

substitute_fn="$(awk '
  /^substitute_placeholders\(\) \{/ { capture=1 }
  capture { print }
  capture && /^}/ { exit }
' "$PROJECT_ROOT/lib/chain-runner.sh")"

eval "$substitute_fn"

TASK_ID="TASK-123"
TASK_TITLE="Fix stale run completion"
TASK_DESCRIPTION="A finished agent should advance the run."
TASK_TYPE="bug"
TASK_PRIORITY="1"
TASK_ACCEPTANCE_CRITERIA="Given AGENT_COMPLETE, when the monitor sees it, then the run advances."
TASK_DESIGN="Launch completion in a separate PTY session."
TASK_NOTES="Regression from monitor handoff."
TASK_COMMENTS="Marco said hurry up."
TASK_CONTEXT="TASK ID: TASK-123"
CHAIN_NAME="placeholder-chain"
ARTIFACTS_DIR="$TEST_TMP_DIR/artifacts"
REMOTE_PROJECT_ROOT="/repo/live-mentiko"
CHAIN_PROJECT_ROOT="$REMOTE_PROJECT_ROOT"

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local message="$3"
  if ! grep -qF "$needle" <<<"$haystack"; then
    echo "FAIL: $message"
    echo "expected to contain: $needle"
    echo "actual: $haystack"
    exit 1
  fi
  echo "PASS: $message"
}

assert_not_contains() {
  local haystack="$1"
  local needle="$2"
  local message="$3"
  if grep -qF "$needle" <<<"$haystack"; then
    echo "FAIL: $message"
    echo "should not contain: $needle"
    echo "actual: $haystack"
    exit 1
  fi
  echo "PASS: $message"
}

expanded="$(substitute_placeholders 'id={TASK_ID}; title={TASK_TITLE}; task={TASK}; workspace={WORKSPACE_PATH}; project={PROJECT_ROOT}; artifacts={ARTIFACTS_DIR}; chain={CHAIN_NAME}')"

assert_contains "$expanded" "id=TASK-123" "expands task id"
assert_contains "$expanded" "title=Fix stale run completion" "expands task title"
assert_contains "$expanded" "task=A finished agent should advance the run." "expands task description alias"
assert_contains "$expanded" "workspace=/repo/live-mentiko" "expands workspace path"
assert_contains "$expanded" "project=/repo/live-mentiko" "expands project root"
assert_contains "$expanded" "artifacts=$ARTIFACTS_DIR" "expands artifacts directory"
assert_contains "$expanded" "chain=placeholder-chain" "expands chain name"
assert_not_contains "$expanded" '$TASK_' "does not leave literal task variables"
assert_not_contains "$expanded" '${' "does not leave shell-style placeholders"

# search the whole file rather than a hardcoded line range (line numbers drift as
# chain-runner.sh changes; the assertion is about the call existing, not its location)
chain_runner_source="$(cat "$PROJECT_ROOT/lib/chain-runner.sh")"
assert_contains "$chain_runner_source" \
  'agent_workspace=$(substitute_placeholders "$agent_workspace")' \
  "expands agent context workspace placeholders"
