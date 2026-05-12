#!/bin/bash
# audit-scrub.test.sh — canary test for PII scrubber
# inserts a PII-laden audit row, runs scrubber, asserts clean.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SCRUBBER="$REPO_ROOT/scripts/scrub-audit-pii.mjs"

# set up a temp mentiko root with a fake audit log
TEST_ROOT=$(mktemp -d)
TEST_LOG_DIR="$TEST_ROOT/namespaces/default/audit"
mkdir -p "$TEST_LOG_DIR"

# create a fake auth.db with one user
mkdir -p "$TEST_ROOT/data" && sqlite3 "$TEST_ROOT/data/auth.db" <<'SQL'
CREATE TABLE "user" (id TEXT PRIMARY KEY, email TEXT, name TEXT);
INSERT INTO "user" (id, email, name) VALUES ('test-user-123', 'test@example.com', 'Test User');
SQL

# seed audit.log with PII entries
cat > "$TEST_LOG_DIR/audit.log" <<'EOF'
{"id":"audit_001","timestamp":"2026-01-01T00:00:00Z","event_type":"auth_login","description":"user logged in","user":"testuser","source":"web","ip":"","hostname":"test","metadata":{"user_id":"test-user-123","email":"test@example.com"}}
{"id":"audit_002","timestamp":"2026-01-01T00:01:00Z","event_type":"chain_start","description":"Started chain: test","user":"testuser","source":"web","ip":"","hostname":"test","metadata":{"chain_name":"test"}}
{"id":"audit_003","timestamp":"2026-01-01T00:02:00Z","event_type":"config_change","description":"Config changed: test","user":"testuser","source":"cli","ip":"","hostname":"test","metadata":{"name":"Test User","config_key":"test"}}
EOF

echo "  test: audit.log before scrub:"
PII_BEFORE=$(grep -c '@example\.com' "$TEST_LOG_DIR/audit.log" || true)
echo "    PII entries: $PII_BEFORE"
[[ "$PII_BEFORE" -eq 1 ]] || { echo "FAIL: expected 1 PII entry before scrub"; exit 1; }

# run scrubber with test root
MENTIKO_GLOBAL_ROOT="$TEST_ROOT" node "$SCRUBBER" 2>&1

echo ""
echo "  test: audit.log after scrub:"
PII_AFTER=$(grep -c '@example\.com' "$TEST_LOG_DIR/audit.log" || true)
echo "    PII entries: $PII_AFTER"
[[ "$PII_AFTER" -eq 0 ]] || { echo "FAIL: PII still present after scrub"; cat "$TEST_LOG_DIR/audit.log"; exit 1; }

# verify user_id was preserved
USER_ID_COUNT=$(grep -c 'test-user-123' "$TEST_LOG_DIR/audit.log" || true)
echo "    user_id references: $USER_ID_COUNT"
[[ "$USER_ID_COUNT" -ge 1 ]] || { echo "FAIL: user_id was lost during scrub"; exit 1; }

# verify the "name" PII key was removed from entry 3
NAME_KEY_COUNT=$(grep -c '"name"' "$TEST_LOG_DIR/audit.log" || true)
echo "    'name' key in metadata: $NAME_KEY_COUNT"
# entry 3 should no longer have "name" key — but the JSON key "name" might appear elsewhere
# check specifically that the PII value "Test User" is gone
PII_NAME=$(grep -c 'Test User' "$TEST_LOG_DIR/audit.log" || true)
echo "    PII name values: $PII_NAME"
[[ "$PII_NAME" -eq 0 ]] || { echo "FAIL: PII name value still present"; cat "$TEST_LOG_DIR/audit.log"; exit 1; }

# verify non-PII entry untouched
CHAIN_COUNT=$(grep -c '"chain_name":"test"' "$TEST_LOG_DIR/audit.log" || true)
echo "    non-PII entries preserved: $CHAIN_COUNT"
[[ "$CHAIN_COUNT" -eq 1 ]] || { echo "FAIL: non-PII entry was modified"; exit 1; }

# cleanup
rm -rf "$TEST_ROOT"

echo ""
echo "  ✔ all canary tests passed"
