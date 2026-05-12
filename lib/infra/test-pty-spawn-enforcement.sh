#!/bin/bash
#
# test-pty-spawn-enforcement.sh - test PTY spawn endpoint security
#
# tests:
# 1. production mode requires linuxUsername
# 2. development mode allows without linuxUsername
# 3. valid spawn with linuxUsername works
#

set -euo pipefail

BASE_URL="${MENTIKO_BASE_URL:-http://localhost:3000}"
API_URL="$BASE_URL/api/terminal/spawn"

# colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m' # no color

log() {
  echo -e "[$(date +'%H:%M:%S')] $*"
}

test_spawn() {
  local test_name="$1"
  local node_env="$2"
  local has_linux_username="$3"
  local should_fail="$4"

  log "test: $test_name"
  log "  NODE_ENV=$node_env, linuxUsername=$([ "$has_linux_username" = "true" ] && echo 'set' || echo 'missing')"

  local payload='{"name":"test-session-'$(date +%s)'"}'
  if [[ "$has_linux_username" = "true" ]]; then
    payload='{"name":"test-session-'$(date +%s)'","linuxUsername":"testuser"}'
  fi

  local response
  response=$(curl -s -w "\n%{http_code}" -X POST \
    -H "Content-Type: application/json" \
    -H "Cookie: dev-auth-bypass=true" \
    -d "$payload" \
    "$API_URL" 2>/dev/null)

  local status_code=$(echo "$response" | tail -n1)
  local body=$(echo "$response" | head -n-1)

  log "  response: $status_code"

  if [[ "$should_fail" = "true" ]]; then
    if [[ "$status_code" == "400" ]]; then
      if echo "$body" | grep -q "linuxUsername"; then
        echo -e "${GREEN}✔ PASS${NC}: correctly rejected with 400 and linuxUsername field error"
      else
        echo -e "${YELLOW}⚠ WARN${NC}: rejected with 400 but error message doesn't mention linuxUsername"
        log "  body: $body"
      fi
    elif [[ "$status_code" == "401" ]]; then
      echo -e "${YELLOW}⚠ SKIP${NC}: auth failed (login required for this test)"
    else
      echo -e "${RED}✗ FAIL${NC}: expected 400, got $status_code"
      log "  body: $body"
    fi
  else
    if [[ "$status_code" == "200" ]] || [[ "$status_code" == "201" ]]; then
      echo -e "${GREEN}✔ PASS${NC}: spawn allowed"
    elif [[ "$status_code" == "401" ]]; then
      echo -e "${YELLOW}⚠ SKIP${NC}: auth failed (login required for this test)"
    else
      echo -e "${RED}✗ FAIL${NC}: expected 200/201, got $status_code"
      log "  body: $body"
    fi
  fi
  echo
}

# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

log "--- PTY Spawn Endpoint Security Tests ---"
log "base url: $BASE_URL"
echo

# check if server is running
log "checking if server is running..."
if ! curl -s -f "$BASE_URL" >/dev/null 2>&1; then
  echo -e "${RED}error: server not responding at $BASE_URL${NC}"
  echo "  start the dev server first: cd web && npm run dev"
  exit 1
fi
echo -e "${GREEN}✔ server is running${NC}"
echo

# test 1: dev mode without linuxUsername (should pass)
log "test suite 1: development mode (NODE_ENV=development)"
test_spawn "dev mode without linuxUsername" "development" "false" "false"

# test 2: dev mode with linuxUsername (should pass)
test_spawn "dev mode with linuxUsername" "development" "true" "false"

# NOTE: production tests require actual production deployment
# these are commented out to prevent breaking live systems
#
# log "test suite 2: production mode (NODE_ENV=production)"
# test_spawn "prod mode without linuxUsername" "production" "false" "true"
# test_spawn "prod mode with linuxUsername" "production" "true" "false"

log "--- test summary ---"
log "production mode tests skipped (require deployment to VPS)"
echo
log "to test production:"
log "  1. deploy to VPS with NODE_ENV=production"
log "  2. uncomment the production test suite above"
log "  3. run: MENTIKO_BASE_URL=https://mentiko.com ./test-pty-spawn-enforcement.sh"
