#!/bin/bash
# backup-db.sh — postgres backup for mentiko production
#
# usage:
#   ./scripts/backup-db.sh [--dry-run]
#
# env vars (set in /opt/mentiko/.env or export before running):
#   POSTGRES_PASSWORD      — required for pg_dump auth
#   BACKUP_DIR             — local backup dir (default: /opt/mentiko/backups)
#   BACKUP_BUCKET          — linode object storage bucket (e.g. mentiko-backups)
#   BACKUP_ENDPOINT        — s3 endpoint (e.g. us-east-1.linodeobjects.com)
#   LINODE_OBJ_ACCESS_KEY  — object storage access key
#   LINODE_OBJ_SECRET_KEY  — object storage secret key
#   BACKUP_NOTIFY_EMAIL    — email to alert on failure (optional, needs mail cmd)
#
# cron (run as root on VPS):
#   0 3 * * * /opt/mentiko/scripts/backup-db.sh >> /var/log/mentiko-backup.log 2>&1
#
# retention:
#   7 daily, 4 weekly (sunday), 3 monthly (1st of month)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# load .env if present
if [[ -f "$PROJECT_DIR/.env" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "$PROJECT_DIR/.env"
  set +a
fi

# config
BACKUP_DIR="${BACKUP_DIR:-/opt/mentiko/backups}"
BACKUP_BUCKET="${BACKUP_BUCKET:-}"
BACKUP_ENDPOINT="${BACKUP_ENDPOINT:-us-east-1.linodeobjects.com}"
POSTGRES_USER="${POSTGRES_USER:-mentiko}"
POSTGRES_DB="${POSTGRES_DB:-mentiko}"
CONTAINER_NAME="${POSTGRES_CONTAINER:-mentiko-postgres-1}"
DRY_RUN=false
NOTIFY_EMAIL="${BACKUP_NOTIFY_EMAIL:-}"

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

# timestamps
NOW=$(date +%Y-%m-%d_%H%M%S)
DOW=$(date +%u)   # 1=Monday, 7=Sunday
DOM=$(date +%d)   # day of month

log() { echo "[$(date +%H:%M:%S)] $*"; }
die() {
  log "ERROR: $*"
  if [[ -n "$NOTIFY_EMAIL" ]] && command -v mail &>/dev/null; then
    echo "mentiko backup failed on $(hostname) at $(date): $*" | \
      mail -s "ALERT: mentiko backup failed" "$NOTIFY_EMAIL"
  fi
  exit 1
}

# ──────────────────────────────────────────────────────────────
# pre-flight checks
# ──────────────────────────────────────────────────────────────

log "starting postgres backup"

if ! command -v docker &>/dev/null; then
  die "docker not found"
fi

# verify postgres container is running
if ! docker inspect --format '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null | grep -q true; then
  die "postgres container '$CONTAINER_NAME' not running"
fi

mkdir -p "$BACKUP_DIR"

# ──────────────────────────────────────────────────────────────
# determine backup type (daily / weekly / monthly)
# ──────────────────────────────────────────────────────────────

BACKUP_TYPE="daily"
if [[ "$DOW" == "7" ]]; then
  BACKUP_TYPE="weekly"
fi
if [[ "$DOM" == "01" ]]; then
  BACKUP_TYPE="monthly"
fi

BACKUP_FILE="$BACKUP_DIR/${BACKUP_TYPE}-${NOW}.sql.gz"

log "backup type: $BACKUP_TYPE"
log "output: $BACKUP_FILE"

# ──────────────────────────────────────────────────────────────
# pg_dump
# ──────────────────────────────────────────────────────────────

if [[ "$DRY_RUN" == true ]]; then
  log "[dry-run] would run: docker exec -e PGPASSWORD=*** $CONTAINER_NAME pg_dump -U $POSTGRES_USER $POSTGRES_DB | gzip > $BACKUP_FILE"
else
  log "running pg_dump..."
  if ! docker exec \
    -e PGPASSWORD="${POSTGRES_PASSWORD:-}" \
    "$CONTAINER_NAME" \
    pg_dump -U "$POSTGRES_USER" --no-password --clean --if-exists "$POSTGRES_DB" \
    | gzip > "$BACKUP_FILE"; then
    # clean up partial file
    rm -f "$BACKUP_FILE"
    die "pg_dump failed"
  fi

  BACKUP_SIZE=$(du -sh "$BACKUP_FILE" 2>/dev/null | cut -f1)
  log "backup complete: $BACKUP_SIZE"
fi

# ──────────────────────────────────────────────────────────────
# offsite upload (linode object storage)
# ──────────────────────────────────────────────────────────────

if [[ -z "$BACKUP_BUCKET" ]]; then
  log "BACKUP_BUCKET not set — skipping offsite upload"
elif [[ -z "${LINODE_OBJ_ACCESS_KEY:-}" ]] || [[ -z "${LINODE_OBJ_SECRET_KEY:-}" ]]; then
  log "WARNING: LINODE_OBJ_ACCESS_KEY/SECRET_KEY not set — skipping offsite upload"
else
  S3_KEY="backups/$(basename "$BACKUP_FILE")"
  S3_URI="s3://${BACKUP_BUCKET}/${S3_KEY}"
  ENDPOINT_URL="https://${BACKUP_ENDPOINT}"

  if [[ "$DRY_RUN" == true ]]; then
    log "[dry-run] would upload to $S3_URI via $ENDPOINT_URL"
  else
    log "uploading to $S3_URI..."

    if command -v aws &>/dev/null; then
      AWS_ACCESS_KEY_ID="$LINODE_OBJ_ACCESS_KEY" \
      AWS_SECRET_ACCESS_KEY="$LINODE_OBJ_SECRET_KEY" \
      aws s3 cp \
        --endpoint-url "$ENDPOINT_URL" \
        --quiet \
        "$BACKUP_FILE" "$S3_URI" \
        || die "s3 upload failed"
    elif command -v s3cmd &>/dev/null; then
      s3cmd put \
        --access_key="$LINODE_OBJ_ACCESS_KEY" \
        --secret_key="$LINODE_OBJ_SECRET_KEY" \
        --host="$BACKUP_ENDPOINT" \
        --host-bucket="%(bucket)s.${BACKUP_ENDPOINT}" \
        "$BACKUP_FILE" "$S3_URI" \
        || die "s3cmd upload failed"
    else
      log "WARNING: neither aws nor s3cmd found — skipping offsite upload"
    fi

    log "offsite upload complete"
  fi
fi

# ──────────────────────────────────────────────────────────────
# retention: prune old backups
# ──────────────────────────────────────────────────────────────

prune_local() {
  local prefix="$1"
  local keep="$2"
  local count
  count=$(ls -1t "$BACKUP_DIR"/${prefix}-*.sql.gz 2>/dev/null | wc -l)
  if [[ "$count" -gt "$keep" ]]; then
    local to_delete=$(( count - keep ))
    log "pruning $to_delete old ${prefix} backup(s)"
    if [[ "$DRY_RUN" == false ]]; then
      ls -1t "$BACKUP_DIR"/${prefix}-*.sql.gz | tail -n "$to_delete" | xargs rm -f
    fi
  fi
}

prune_local "daily"   7
prune_local "weekly"  4
prune_local "monthly" 3

# ──────────────────────────────────────────────────────────────
# done
# ──────────────────────────────────────────────────────────────

log "backup-db.sh finished successfully"
