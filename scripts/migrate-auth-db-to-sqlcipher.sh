#!/usr/bin/env bash
# migrate-auth-db-to-sqlcipher.sh
# Ops script to encrypt auth.db with SQLCipher.
# Idempotent: safe to re-run on an already-encrypted DB.
#
# Prerequisites:
#   - AUTH_DB_ENCRYPT=1 in env
#   - BETTER_AUTH_SECRET (or SECRET_KEY) set (used as encryption key)
#   - Node.js with better-sqlite3-multiple-ciphers installed
#
# Usage:
#   AUTH_DB_ENCRYPT=1 BETTER_AUTH_SECRET=<key> ./scripts/migrate-auth-db-to-sqlcipher.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WEB_DIR="$(cd "$SCRIPT_DIR/../web" && pwd)"

if [ "${AUTH_DB_ENCRYPT:-}" != "1" ]; then
  echo "[migrate] AUTH_DB_ENCRYPT not set to 1, nothing to do"
  exit 0
fi

if [ -z "${BETTER_AUTH_SECRET:-}" ] && [ -z "${SECRET_KEY:-}" ]; then
  echo "[migrate] ERROR: BETTER_AUTH_SECRET or SECRET_KEY must be set" >&2
  exit 1
fi

echo "[migrate] running sqlcipher migration..."
cd "$WEB_DIR"
node -e "require('./lib/system/sqlcipher-migrate').migrateToSqlCipher().then(() => process.exit(0), e => { console.error(e); process.exit(1) })"
echo "[migrate] done"
