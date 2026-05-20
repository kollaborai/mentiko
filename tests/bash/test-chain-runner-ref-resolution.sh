#!/bin/bash
# test-chain-runner-ref-resolution.sh - CLI chain runs resolve catalog agent refs

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

TEST_TMP_DIR="$(mktemp -d)"
trap 'rm -r "$TEST_TMP_DIR"' EXIT

mkdir -p "$TEST_TMP_DIR/namespaces/default/agents/ref-agent"

cat > "$TEST_TMP_DIR/namespaces/default/agents/ref-agent/agent.json" <<'JSON'
{
  "id": "ref-agent",
  "name": "Referenced Agent",
  "triggers": ["manual-start"],
  "emits": "ref-agent-complete",
  "prompt": "Inspect {WORKSPACE_PATH}.",
  "context": {
    "workspace": "{WORKSPACE_PATH}"
  },
  "authorities": ["read_files"]
}
JSON

cat > "$TEST_TMP_DIR/ref-chain.json" <<'JSON'
{
  "name": "ref-chain",
  "version": "1.0.0",
  "config": {
    "session_prefix": "rf"
  },
  "agents": [
    {
      "$ref": "ref-agent"
    }
  ]
}
JSON

output="$(
  MENTIKO_GLOBAL_ROOT="$TEST_TMP_DIR" \
  MENTIKO_CODE_ROOT="$PROJECT_ROOT" \
  MENTIKO_CLI="echo" \
  "$PROJECT_ROOT/bin/mentiko" run "$TEST_TMP_DIR/ref-chain.json" --workspace "$PROJECT_ROOT" --dry-run
)"

second_output="$(
  MENTIKO_GLOBAL_ROOT="$TEST_TMP_DIR" \
  MENTIKO_CODE_ROOT="$PROJECT_ROOT" \
  MENTIKO_CLI="echo" \
  "$PROJECT_ROOT/bin/mentiko" run "$TEST_TMP_DIR/ref-chain.json" --workspace "$PROJECT_ROOT" --dry-run
)"

if ! grep -qF "[ref-agent] Referenced Agent" <<<"$output"; then
  echo "FAIL: dry-run should show resolved ref agent"
  echo "$output"
  exit 1
fi

if ! grep -qF "triggers: manual-start" <<<"$output"; then
  echo "FAIL: dry-run should show resolved triggers"
  echo "$output"
  exit 1
fi

if ! grep -qF "[ref-agent] Referenced Agent" <<<"$second_output"; then
  echo "FAIL: repeated dry-run should not collide on resolved chain temp files"
  echo "$second_output"
  exit 1
fi

echo "PASS: chain-runner resolves catalog agent refs in CLI mode"
