#!/bin/bash
# gdpr-sweep.sh — remove orphan files owned by a deleted user.
#
# called by /api/gdpr/delete after crypto-shred.
# runs in background, non-blocking.
#
# usage: gdpr-sweep.sh <user_id> <namespace_id>

set -euo pipefail

USER_ID="${1:?usage: gdpr-sweep.sh <user_id> <namespace_id>}"
NAMESPACE_ID="${2:-default}"
export NAMESPACE_ID

GLOBAL_ROOT="${MENTIKO_GLOBAL_ROOT:-$HOME/.mentiko}"
NS_ROOT="$GLOBAL_ROOT/namespaces/$NAMESPACE_ID"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh"
source "$SCRIPT_DIR/run-record-client.sh"

echo "[gdpr-sweep] starting sweep for user=$USER_ID namespace=$NAMESPACE_ID"

# chains, conversations, and decisions owned by this user. Ownership detection
# (canonical field comparison, not raw-JSON grep) and removal are owned by the
# typed module lib/gdpr-user-artifacts.mjs; the shell forwards the namespace
# root and user id and parses no JSON. There is no shell fallback.
GDPR_ARTIFACTS_MJS="${MENTIKO_CODE_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}/lib/gdpr-user-artifacts.mjs"
if [[ ! -f "$GDPR_ARTIFACTS_MJS" ]]; then
    echo "[gdpr-sweep] typed gdpr-user-artifacts module missing: $GDPR_ARTIFACTS_MJS" >&2
    exit 1
fi
node "$GDPR_ARTIFACTS_MJS" sweep --ns-root "$NS_ROOT" --user-id "$USER_ID"

# runs by this user (owned by the typed Run Record CLI)
RUNS_DIR="$NS_ROOT/runs"
if [[ -d "$RUNS_DIR" ]]; then
    deleted_runs=$(_run_record_cli delete-user-runs --runs-dir "$RUNS_DIR" --user-id "$USER_ID")
    while IFS= read -r run_dir; do
        [[ -n "$run_dir" ]] && echo "[gdpr-sweep] removed run: $run_dir"
    done <<< "$deleted_runs"
fi

echo "[gdpr-sweep] complete for user=$USER_ID"
