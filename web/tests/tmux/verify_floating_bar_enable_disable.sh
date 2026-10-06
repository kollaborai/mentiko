#!/usr/bin/env bash
# Repeatable spec verification against the already-running Mentiko web app.
# This wrapper uses a uniquely named tmux server/session to isolate test output;
# it deliberately does not start or stop a web server.

set -euo pipefail

SPEC_NAME="floating-bar-enable-disable"
SOCKET_NAME="${SOCKET_NAME:-fb-verify-$$-${RANDOM}}"
SESSION_NAME="verify-${SPEC_NAME}-$$"
BASE_URL="${E2E_BASE_URL:-http://127.0.0.1:3200}"
SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WEB_ROOT="$REPO_ROOT/web"

JEST_PATHS=(
app/settings/layout.test.tsx
app/settings/mentiko-agent/page.test.tsx
app/mcp-auth/page.test.tsx
"app/api/kollabor/engine/[...path]/route.test.ts"
app/api/system/storage-scope/route.test.ts
components/app-shell/__tests__/floating-app-panels.test.tsx
components/app-shell/__tests__/floating-bar-storage-scope.test.tsx
components/app-shell/__tests__/floating-kollabor-bar-gateway.test.tsx
components/app-shell/__tests__/floating-pill-nav.test.tsx
components/app-shell/__tests__/ui-control-grant.test.tsx
lib/__tests__/floating-app-panel-routing.test.ts
lib/__tests__/floating-bar-availability.test.ts
lib/__tests__/floating-bar-lifecycle.test.ts
lib/__tests__/floating-surface-z.test.ts
lib/__tests__/kollabor-bar-flag.test.ts
lib/__tests__/kollabor-bar-store-enable.test.ts
lib/__tests__/kollabor-engine-client.test.ts
lib/__tests__/kollabor-engine-session-reconciliation.test.ts
lib/__tests__/kollabor-engine-storage-scope.test.ts
lib/__tests__/kollabor-session-reuse.test.ts
lib/__tests__/mentiko-mcp-bar-client.test.ts
lib/__tests__/mentiko-mcp-bar-client-lifecycle.test.ts
)

if [[ "${1:-}" == "--inside-tmux" ]]; then
  set +e
  npm test -- --runInBand --runTestsByPath "${JEST_PATHS[@]}"
  jest_status=$?

  e2e_output="$(E2E_BASE_URL="$BASE_URL" npx playwright test \
    e2e/tests/floating-bar-enable-disable.spec.ts --reporter=line 2>&1)"
  e2e_status=$?
  printf '%s\n' "$e2e_output"

  # Playwright exits zero when environment-gated cases are skipped. A skipped
  # required acceptance case is not evidence of a pass, so make this verifier
  # fail until every criterion in the E2E file actually ran.
  if grep -Eiq '[0-9]+ skipped' <<<"$e2e_output"; then
    echo "[BLOCKED] Playwright skipped required cases; supply the documented E2E environment and rerun."
    e2e_status=1
  fi

  if (( jest_status == 0 && e2e_status == 0 )); then
    result=0
  else
    result=1
  fi
  printf '\nJest exit: %s | Playwright exit (skips treated as incomplete): %s\n' "$jest_status" "$e2e_status"
  tmux -L "$SOCKET_NAME" set-option -g @floating_bar_spec_exit "$result"
  exit "$result"
fi

if ! command -v tmux >/dev/null 2>&1; then
  echo "[FAIL] tmux is required for isolated spec verification." >&2
  exit 2
fi

case "$BASE_URL" in
  http://*|https://*) ;;
  *) echo "[FAIL] E2E_BASE_URL must be an http(s) URL." >&2; exit 2 ;;
esac

http_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --max-time 8 "$BASE_URL/login" 2>/dev/null || true)"
if [[ ! "$http_status" =~ ^[23][0-9][0-9]$ ]]; then
  echo "[FAIL] Existing app is not responding at $BASE_URL/login (HTTP ${http_status:-unavailable})." >&2
  echo "No dev server was started." >&2
  exit 2
fi

printf '=== Spec verification: %s ===\n' "$SPEC_NAME"
printf 'Existing app: %s (HTTP %s)\n' "$BASE_URL/login" "$http_status"
printf 'Isolated tmux socket/session: %s / %s\n' "$SOCKET_NAME" "$SESSION_NAME"
printf 'No web server will be started or stopped.\n\n'

cleanup() {
  tmux -L "$SOCKET_NAME" kill-server >/dev/null 2>&1 || true
}
trap cleanup EXIT

printf -v inside_command 'env SOCKET_NAME=%q E2E_BASE_URL=%q bash %q --inside-tmux' \
  "$SOCKET_NAME" "$BASE_URL" "$SCRIPT_PATH"
tmux -L "$SOCKET_NAME" new-session -d -s "$SESSION_NAME" -c "$WEB_ROOT" 'exec bash'
tmux -L "$SOCKET_NAME" set-option -w -t "$SESSION_NAME" remain-on-exit on
tmux -L "$SOCKET_NAME" send-keys -t "$SESSION_NAME" "$inside_command; exit" C-m

deadline=$((SECONDS + 1200))
pane_finished=0
while (( SECONDS < deadline )); do
  pane_dead="$(tmux -L "$SOCKET_NAME" list-panes -t "$SESSION_NAME" -F '#{pane_dead}' 2>/dev/null || true)"
  if [[ -z "$pane_dead" ]]; then
    echo "[FAIL] Isolated verifier pane disappeared before recording a result." >&2
    exit 1
  fi
  if [[ "$pane_dead" == "1" ]]; then
    pane_finished=1
    break
  fi
  sleep 1
done

tmux -L "$SOCKET_NAME" capture-pane -t "$SESSION_NAME" -p -S -3000 2>/dev/null || true
if (( pane_finished == 0 )); then
  echo "[FAIL] Verification exceeded 20 minutes; the isolated tmux session will be cleaned up." >&2
  exit 124
fi

result="$(tmux -L "$SOCKET_NAME" show-option -gqv @floating_bar_spec_exit 2>/dev/null || true)"
if [[ "$result" != "0" ]]; then
  echo "[FAIL] Spec verification failed or did not record a complete result." >&2
  exit 1
fi

echo "[PASS] Focused unit suite and every required Playwright case completed without skips."
