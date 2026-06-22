#!/bin/bash
# test-cli-readiness.sh - profile-driven CLI readiness classification.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$PROJECT_ROOT/lib/cli-readiness.sh"

TMP_DIR="$(mktemp -d)"
cleanup() { rm -r "$TMP_DIR"; }
trap cleanup EXIT

PROFILE="$TMP_DIR/profile.json"
CAPTURE="$TMP_DIR/capture.txt"

cat > "$PROFILE" <<'JSON'
{
  "id": "codex-default",
  "cli": "codex",
  "readiness": {
    "enabled": true,
    "ready_patterns": [
      { "name": "shell prompt", "type": "text", "value": "[podman] ❯", "action": "ready", "risk": "low", "enabled": true }
    ],
    "blocked_patterns": [
      { "name": "bad codex arg", "type": "text", "value": "unexpected argument '--skip-git-repo-check'", "action": "block", "risk": "low", "enabled": true }
    ],
    "recoverable_patterns": [
      { "name": "press enter", "type": "regex", "value": "Press Enter to continue", "action": "recover", "risk": "low", "enabled": true }
    ],
    "retry_patterns": [
      { "name": "installing", "type": "regex", "value": "(installing|updating|downloading)", "action": "retry", "risk": "medium", "enabled": true }
    ]
  }
}
JSON

PASS=0
FAIL=0

expect_status() {
  local name="$1" expected="$2" capture="$3"
  printf '%s\n' "$capture" > "$CAPTURE"
  local out status
  out="$(cli_readiness_check "$PROFILE" "$CAPTURE")"
  status="$(printf '%s\n' "$out" | jq -r '.status')"
  if [[ "$status" == "$expected" ]]; then
    PASS=$((PASS+1)); printf '  PASS %-24s -> %s\n' "$name" "$status"
  else
    FAIL=$((FAIL+1)); printf '  FAIL %-24s -> got %s want %s\n%s\n' "$name" "$status" "$expected" "$out"
  fi
}

echo "[cli readiness]"
expect_status "ready pattern" "ready" "Ecom on master via v22.22.3
[podman] ❯"
expect_status "blocked pattern" "blocked" "error: unexpected argument '--skip-git-repo-check' found"
expect_status "recover pattern" "recover" "Codex setup
Press Enter to continue"
expect_status "retry pattern" "retry" "codex is updating components"
expect_status "unknown pattern" "unknown" "plain settled output with no known prompt"

jq '.readiness.enabled=false' "$PROFILE" > "$PROFILE.disabled"
mv "$PROFILE.disabled" "$PROFILE"
expect_status "disabled policy" "ready" "anything goes when readiness is disabled"

echo
echo "cli-readiness: $PASS passed, $FAIL failed"
[[ "$FAIL" = 0 ]]
