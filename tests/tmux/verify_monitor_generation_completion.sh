#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SOCKET_NAME="mentiko-generation-proof-$$"
SESSION_NAME="verify-generation-$$"
OUTPUT_FILE="$(mktemp "${TMPDIR:-/tmp}/mentiko-generation-proof.XXXXXX")"

cleanup() {
  tmux -L "$SOCKET_NAME" kill-server >/dev/null 2>&1 || true
  rm -f "$OUTPUT_FILE"
}
trap cleanup EXIT INT TERM

tmux -L "$SOCKET_NAME" new-session -d -s "$SESSION_NAME" -x 140 -y 40 \
  "cd '$REPO_ROOT' && node web/scripts/runner-v2-generation-monitor-proof.cjs >'$OUTPUT_FILE' 2>&1"

deadline=$((SECONDS + 60))
while tmux -L "$SOCKET_NAME" has-session -t "$SESSION_NAME" 2>/dev/null; do
  if (( SECONDS >= deadline )); then
    cat "$OUTPUT_FILE"
    echo "[FAIL] generation completion proof timed out" >&2
    exit 1
  fi
  sleep 1
done

cat "$OUTPUT_FILE"
grep -q '"status": "passed"' "$OUTPUT_FILE"
echo "[PASS] isolated monitor -> import -> job/run -> PTY proof"
