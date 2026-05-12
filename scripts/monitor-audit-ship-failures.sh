#!/usr/bin/env bash
#
# monitor-audit-ship-failures.sh
#
# Ops cron for FUTURE-9. Watches ship-failures.log for recent entries and
# prints a human-readable report to stdout. Cron delivers stdout to the
# configured MAILTO address, so this script itself does not send mail.
#
# Exit codes:
#   0 — ran to completion (whether or not failures were found). Cron emails
#       only if stdout is non-empty, so empty runs are silent.
#   1 — internal error (missing file access, bad jq payload). Cron WILL
#       email on non-zero exit regardless of stdout.
#
# Typical cron entry on the tenant VPS:
#
#   MAILTO=support@mentiko.com
#   */15 * * * * /opt/mentiko/scripts/monitor-audit-ship-failures.sh
#
# Env:
#   AUDIT_DIR         — override the audit directory path (default derived
#                       from NAMESPACE_ROOT or /app/namespaces/{NAMESPACE_ID})
#   NAMESPACE_ID      — tenant namespace (default "default")
#   NAMESPACE_ROOT    — optional override, wins over derived path
#   WINDOW_MINUTES    — report window in minutes (default 60)
#   QUIET_THRESHOLD   — max failures per window before report is emitted
#                       (default 0 = emit on any failure). Raise if a
#                       transient flurry is acceptable.

set -euo pipefail

: "${NAMESPACE_ID:=default}"
: "${WINDOW_MINUTES:=60}"
: "${QUIET_THRESHOLD:=0}"

# resolve audit directory
if [[ -n "${AUDIT_DIR:-}" ]]; then
  audit_dir="$AUDIT_DIR"
elif [[ -n "${NAMESPACE_ROOT:-}" ]]; then
  audit_dir="$NAMESPACE_ROOT/audit"
else
  audit_dir="/app/namespaces/$NAMESPACE_ID/audit"
fi

log_file="$audit_dir/ship-failures.log"

# missing log = no failures yet. silent success.
if [[ ! -f "$log_file" ]]; then
  exit 0
fi

# ensure jq is available
if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq not found on PATH — cannot parse ship-failures.log" >&2
  exit 1
fi

# compute the cutoff timestamp (ISO8601 UTC)
if date -u -d "@0" >/dev/null 2>&1; then
  # GNU date (linux)
  cutoff=$(date -u -d "$WINDOW_MINUTES minutes ago" +%Y-%m-%dT%H:%M:%SZ)
else
  # BSD date (macOS)
  cutoff=$(date -u -v-"${WINDOW_MINUTES}"M +%Y-%m-%dT%H:%M:%SZ)
fi

# count + extract failures within the window
# each line is a compact JSON object:
#   {"failed_at": "...", "entry_id": "...", "remote_key": "...",
#    "remote_url": "...", "attempts": 3}
recent=$(jq -c --arg cutoff "$cutoff" \
  'select(.failed_at >= $cutoff)' "$log_file" 2>/dev/null || true)

count=$(printf '%s\n' "$recent" | grep -c '^{' || true)

# below threshold = silent success
if (( count <= QUIET_THRESHOLD )); then
  exit 0
fi

# emit report (cron will deliver via MAILTO)
cat <<EOF
Mentiko audit-ship failures detected

Tenant:          $NAMESPACE_ID
Host:            $(hostname 2>/dev/null || echo "unknown")
Window:          last $WINDOW_MINUTES minutes (since $cutoff)
Failures:        $count
Threshold:       $QUIET_THRESHOLD (alert above)
Log file:        $log_file

Recent failures:
EOF

# render up to 20 most recent entries with the key fields
printf '%s\n' "$recent" | tail -20 | jq -r '
  "  [" + .failed_at + "] entry=" + .entry_id +
  " key=" + .remote_key +
  " url=" + .remote_url +
  " attempts=" + (.attempts | tostring)
' 2>/dev/null || {
  echo "  (failed to render JSON; inspect $log_file directly)" >&2
  exit 1
}

cat <<'EOF'

Next steps:
  1. Check tenant outbound network: rclone ls :s3:$BUCKET/
  2. Verify AUDIT_REMOTE_* credentials still valid.
  3. Check linode object-storage dashboard for bucket health + quota.
  4. If rclone works manually but ship fails, pull recent tenant logs:
     docker logs <container> 2>&1 | grep "warn: audit ship"
  5. See docs/AUDIT_SETUP.md section "ship-failures.log monitoring"
     for the full runbook.
EOF
