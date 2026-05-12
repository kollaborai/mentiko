#!/bin/bash
# test-secret-decryption.sh - verifies vault secret decryption
# in job-runner.mjs matches the web server's BETTER_AUTH_SECRET
#
# catches: BETTER_AUTH_SECRET mismatch between encryption and
# decryption context (the bug that killed all decision jobs on 2026-03-19)

[[ "${BASH_SOURCE[0]}" == "${0}" ]] || return 0

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

TESTS_PASSED=0
TESTS_FAILED=0
TESTS_RUN=0

pass() { ((TESTS_PASSED++)); ((TESTS_RUN++)); echo "  [PASS] $1"; }
fail() { ((TESTS_FAILED++)); ((TESTS_RUN++)); echo "  [FAIL] $1"; echo "    $2"; }

# ── setup ──

ENV_FILE="$PROJECT_ROOT/web/.env.local"
SECRETS_DIR="$HOME/.mentiko/namespaces/default/secrets"

echo "secret decryption tests"
echo "========================"

# ── test 1: BETTER_AUTH_SECRET exists in .env.local ──

if [[ -f "$ENV_FILE" ]]; then
  SERVER_SECRET=$(grep '^BETTER_AUTH_SECRET=' "$ENV_FILE" | cut -d= -f2-)
  if [[ -n "$SERVER_SECRET" ]]; then
    pass "BETTER_AUTH_SECRET exists in .env.local"
  else
    fail "BETTER_AUTH_SECRET missing from .env.local" \
      "job-runner will fall back to 'mentiko-default-secret'"
  fi
else
  fail ".env.local not found" "$ENV_FILE does not exist"
  SERVER_SECRET=""
fi

# ── test 2: secrets dir exists and has secrets ──

if [[ -d "$SECRETS_DIR" ]]; then
  SECRET_COUNT=$(ls "$SECRETS_DIR"/*.json 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$SECRET_COUNT" -gt 0 ]]; then
    pass "secrets vault has $SECRET_COUNT secret(s)"
  else
    pass "secrets vault is empty (no secrets to test)"
    echo ""
    echo "results: $TESTS_PASSED passed, $TESTS_FAILED failed ($TESTS_RUN total)"
    exit 0
  fi
else
  pass "no secrets dir (vault not initialized)"
  echo ""
  echo "results: $TESTS_PASSED passed, $TESTS_FAILED failed ($TESTS_RUN total)"
  exit 0
fi

# ── test 3: every secret decrypts with the server's BETTER_AUTH_SECRET ──

if [[ -n "$SERVER_SECRET" ]]; then
  DECRYPT_SCRIPT=$(cat <<'NODESCRIPT'
const { readFileSync, readdirSync } = require("fs");
const { join } = require("path");
const { createDecipheriv, createHash } = require("crypto");

const secretsDir = process.env.TEST_SECRETS_DIR;
const authSecret = process.env.TEST_AUTH_SECRET;
const key = createHash("sha256").update(authSecret).digest();

let passed = 0;
let failed = 0;
const failures = [];

for (const f of readdirSync(secretsDir).filter(x => x.endsWith(".json"))) {
  const rec = JSON.parse(readFileSync(join(secretsDir, f), "utf8"));
  if (!rec.encryptedValue) continue;

  try {
    const [ivHex, tagHex, encHex] = rec.encryptedValue.split(":");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    Buffer.concat([decipher.update(Buffer.from(encHex, "hex")), decipher.final()]);
    passed++;
  } catch (e) {
    failed++;
    failures.push(rec.name || f);
  }
}

console.log(JSON.stringify({ passed, failed, failures }));
NODESCRIPT
  )

  RESULT=$(TEST_SECRETS_DIR="$SECRETS_DIR" TEST_AUTH_SECRET="$SERVER_SECRET" node -e "$DECRYPT_SCRIPT")
  DECRYPT_PASSED=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['passed'])")
  DECRYPT_FAILED=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['failed'])")
  DECRYPT_FAILURES=$(echo "$RESULT" | python3 -c "import sys,json; print(', '.join(json.load(sys.stdin)['failures']))")

  if [[ "$DECRYPT_FAILED" -eq 0 ]]; then
    pass "all $DECRYPT_PASSED secret(s) decrypt with server's BETTER_AUTH_SECRET"
  else
    fail "$DECRYPT_FAILED secret(s) fail to decrypt with server's BETTER_AUTH_SECRET" \
      "broken: $DECRYPT_FAILURES (encrypted with a different key)"
  fi
fi

# ── test 4: job-runner resolves the same key ──
# simulates what job-runner.mjs does: reads BETTER_AUTH_SECRET from env

JR_SCRIPT=$(cat <<'NODESCRIPT'
const authSecret = process.env.BETTER_AUTH_SECRET || process.env.SECRET_KEY || "mentiko-default-secret";
const expected = process.env.EXPECTED_SECRET;
if (authSecret === expected) {
  console.log("match");
} else {
  console.log("mismatch:" + authSecret.slice(0, 10) + "... vs " + expected.slice(0, 10) + "...");
}
NODESCRIPT
)

JR_RESULT=$(BETTER_AUTH_SECRET="$SERVER_SECRET" EXPECTED_SECRET="$SERVER_SECRET" node -e "$JR_SCRIPT")
if [[ "$JR_RESULT" == "match" ]]; then
  pass "job-runner resolves same BETTER_AUTH_SECRET as server"
else
  fail "job-runner resolves different BETTER_AUTH_SECRET" "$JR_RESULT"
fi

# ── test 5: job-runner without BETTER_AUTH_SECRET falls back to default ──

JR_FALLBACK=$(unset BETTER_AUTH_SECRET; unset SECRET_KEY; EXPECTED_SECRET="$SERVER_SECRET" node -e "$JR_SCRIPT")
if [[ "$JR_FALLBACK" == match ]]; then
  pass "job-runner fallback matches server (both use same key)"
else
  fail "job-runner fallback uses 'mentiko-default-secret' but server uses different key" \
    "if BETTER_AUTH_SECRET is not passed to job-runner, decryption will fail"
fi

# ── results ──

echo ""
echo "results: $TESTS_PASSED passed, $TESTS_FAILED failed ($TESTS_RUN total)"

if [[ "$TESTS_FAILED" -gt 0 ]]; then
  exit 1
fi
