#!/bin/bash
# restore-db.sh — restore mentiko postgres from a pg_dump backup
#
# usage:
#   ./scripts/restore-db.sh <backup-file.sql.gz>
#   ./scripts/restore-db.sh --list        # list available local backups
#
# the restore will DROP and recreate all tables (pg_dump --clean was used).
# run this ONLY when you need to recover from data loss or corruption.

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

BACKUP_DIR="${BACKUP_DIR:-/opt/mentiko/backups}"
POSTGRES_USER="${POSTGRES_USER:-mentiko}"
POSTGRES_DB="${POSTGRES_DB:-mentiko}"
CONTAINER_NAME="${POSTGRES_CONTAINER:-mentiko-postgres-1}"

log() { echo "[$(date +%H:%M:%S)] $*"; }
die() { log "ERROR: $*"; exit 1; }

# ──────────────────────────────────────────────────────────────
# --list
# ──────────────────────────────────────────────────────────────

if [[ "${1:-}" == "--list" ]]; then
  echo "available backups in $BACKUP_DIR:"
  ls -lht "$BACKUP_DIR"/*.sql.gz 2>/dev/null | awk '{print $6, $7, $8, $9, "("$5")"}' \
    || echo "  (none found)"
  exit 0
fi

# ──────────────────────────────────────────────────────────────
# validate args
# ──────────────────────────────────────────────────────────────

BACKUP_FILE="${1:-}"
if [[ -z "$BACKUP_FILE" ]]; then
  echo "usage: $0 <backup-file.sql.gz>"
  echo "       $0 --list"
  exit 1
fi

if [[ ! -f "$BACKUP_FILE" ]]; then
  die "backup file not found: $BACKUP_FILE"
fi

# ──────────────────────────────────────────────────────────────
# pre-flight
# ──────────────────────────────────────────────────────────────

if ! command -v docker &>/dev/null; then
  die "docker not found"
fi

if ! docker inspect --format '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null | grep -q true; then
  die "postgres container '$CONTAINER_NAME' not running"
fi

log "restore target: $POSTGRES_DB in container $CONTAINER_NAME"
log "backup file: $BACKUP_FILE ($(du -sh "$BACKUP_FILE" | cut -f1))"
echo ""
echo "WARNING: this will drop and recreate all tables in $POSTGRES_DB"
echo "         ALL CURRENT DATA WILL BE OVERWRITTEN"
echo ""
read -r -p "type 'yes' to confirm: " confirm
if [[ "$confirm" != "yes" ]]; then
  echo "aborted"
  exit 0
fi

# ──────────────────────────────────────────────────────────────
# restore
# ──────────────────────────────────────────────────────────────

log "starting restore..."

if ! gunzip -c "$BACKUP_FILE" | docker exec -i \
  -e PGPASSWORD="${POSTGRES_PASSWORD:-}" \
  "$CONTAINER_NAME" \
  psql -U "$POSTGRES_USER" --no-password "$POSTGRES_DB"; then
  die "restore failed"
fi

log "restore complete"
log "verify the application is working correctly before resuming traffic"
