#!/bin/bash
# test-advisor-recovery.sh - strict startup recovery prompt and JSON parsing.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$PROJECT_ROOT/lib/advisor-recovery.sh"

TMP_DIR="$(mktemp -d)"
cleanup() { rm -r "$TMP_DIR"; }
trap cleanup EXIT

CAPTURE="$TMP_DIR/capture.txt"
STATE="$TMP_DIR/state.txt"
PROMPT="$TMP_DIR/prompt.txt"

cat > "$CAPTURE" <<'TXT'
error: unexpected argument '--skip-git-repo-check' found
Ecom on master via v22.22.3
[podman] ❯
TXT

cat > "$STATE" <<'TXT'
status: running
session: Ecom-chain-recommender-run-123
agent_id: chain-recommender
TXT

advisor_recovery_prompt \
  --run-id "run-123" \
  --agent-id "chain-recommender" \
  --profile-id "codex-default" \
  --cli "codex" \
  --cwd "/workspace/ecom" \
  --command "codex exec --dangerously-bypass-approvals-and-sandbox --model gpt-5.5 --skip-git-repo-check" \
  --state-file "$STATE" \
  --capture-file "$CAPTURE" \
  > "$PROMPT"

PASS=0
FAIL=0
check() {
  local name="$1" pattern="$2"
  if grep -qF -- "$pattern" "$PROMPT"; then
    PASS=$((PASS+1)); printf '  PASS %s\n' "$name"
  else
    FAIL=$((FAIL+1)); printf '  FAIL %s missing: %s\n' "$name" "$pattern"
  fi
}

echo "[advisor recovery prompt]"
check "mentions mentiko pty contract" "Mentiko executes CLI tools inside pty-manager sessions"
check "includes run id" "run-123"
check "includes profile id" "codex-default"
check "includes cwd" "/workspace/ecom"
check "includes attempted command" "--skip-git-repo-check"
check "includes state file" "status: running"
check "includes capture" "unexpected argument '--skip-git-repo-check'"
check "demands json" "Return strict JSON only"

echo "[advisor recovery json]"
VALID='{"action":"suggest_profile_fix","confidence":0.93,"risk":"low","reason":"bad arg","evidence":"unexpected argument","remove_extra_args":["--skip-git-repo-check"]}'
INVALID='{"action":"send_keys","confidence":0.2,"risk":"high","keys":["enter"]}'
advisor_recovery_validate_json "$VALID" >/dev/null && PASS=$((PASS+1)) || { FAIL=$((FAIL+1)); echo "  FAIL valid json rejected"; }
if advisor_recovery_should_auto_apply "$INVALID"; then
  FAIL=$((FAIL+1)); echo "  FAIL high-risk action auto-applied"
else
  PASS=$((PASS+1)); echo "  PASS high-risk action not auto-applied"
fi

echo
echo "advisor-recovery: $PASS passed, $FAIL failed"
[[ "$FAIL" = 0 ]]
