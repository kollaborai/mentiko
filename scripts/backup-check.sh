#!/bin/bash
# backup-check.sh — verify latest backup is fresh (run from cron, alert on stale)
#
# cron (run 1h after backup, check that it succeeded):
#   0 4 * * * /opt/mentiko/scripts/backup-check.sh >> /var/log/mentiko-backup.log 2>&1
#
# exits 1 if no backup found or latest is >25h old (allows 1h grace window)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

if [[ -f "$PROJECT_DIR/.env" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "$PROJECT_DIR/.env"
  set +a
fi

BACKUP_DIR="${BACKUP_DIR:-/opt/mentiko/backups}"
MAX_AGE_SECONDS=90000  # 25 hours
NOTIFY_EMAIL="${BACKUP_NOTIFY_EMAIL:-}"

log() { echo "[$(date +%H:%M:%S)] $*"; }
alert() {
  log "ALERT: $*"
  if [[ -n "$NOTIFY_EMAIL" ]] && command -v mail &>/dev/null; then
    echo "mentiko backup check failed on $(hostname) at $(date): $*" | \
      mail -s "ALERT: mentiko backup stale or missing" "$NOTIFY_EMAIL"
  fi
  exit 1
}

# find most recent backup
LATEST=$(ls -1t "$BACKUP_DIR"/*.sql.gz 2>/dev/null | head -1)

if [[ -z "$LATEST" ]]; then
  alert "no backup files found in $BACKUP_DIR"
fi

# check age
if [[ "$(uname)" == "Darwin" ]]; then
  MTIME=$(stat -f %m "$LATEST")
else
  MTIME=$(stat -c %Y "$LATEST")
fi

NOW=$(date +%s)
AGE=$(( NOW - MTIME ))

if [[ "$AGE" -gt "$MAX_AGE_SECONDS" ]]; then
  HOURS=$(( AGE / 3600 ))
  alert "latest backup is ${HOURS}h old ($(basename "$LATEST")) — exceeds 25h threshold"
fi

SIZE=$(du -sh "$LATEST" | cut -f1)
HOURS=$(( AGE / 3600 ))
log "backup OK: $(basename "$LATEST") — ${SIZE}, ${HOURS}h old"
