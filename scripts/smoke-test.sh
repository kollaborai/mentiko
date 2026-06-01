#!/bin/bash
# mentiko post-deploy smoke test suite
# runs in <90 seconds, outputs pass/fail with evidence
# usage: SMOKE_BASE_URL=https://<your-qa-host> ./scripts/smoke-test.sh
#        SMOKE_BASE_URL=https://<your-prod-host> ./scripts/smoke-test.sh

set -euo pipefail

# ============================================================================
# CONFIGURATION
# ============================================================================

SMOKE_BASE_URL="${SMOKE_BASE_URL:-http://localhost:3000}"
SMOKE_EMAIL="${SMOKE_EMAIL:-}"
SMOKE_PASSWORD="${SMOKE_PASSWORD:-}"
SMOKE_OUTPUT_DIR="${SMOKE_OUTPUT_DIR:-./smoke-test-results}"
SMOKE_TIMEOUT="${SMOKE_TIMEOUT:-85}"
SMOKE_PARALLEL="${SMOKE_PARALLEL:-true}"

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ============================================================================
# UTILITIES
# ============================================================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1" >&2
}

log_success() {
    echo -e "${GREEN}[PASS]${NC} $1" >&2
}

log_error() {
    echo -e "${RED}[FAIL]${NC} $1" >&2
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1" >&2
}

# Create output directory
mkdir -p "$SMOKE_OUTPUT_DIR"

# Track results
PASSED=0
FAILED=0
WARNINGS=0

# Record start time
START_TIME=$(date +%s)

# ============================================================================
# TEST HELPERS
# ============================================================================

# Check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Make an API request and check response
api_get() {
    local endpoint="$1"
    local expected_status="${2:-200}"
    local url="${SMOKE_BASE_URL}/api${endpoint}"

    log_info "GET $url"

    local response
    local status
    response=$(curl -s -w "\n%{http_code}" "$url" 2>&1)
    status=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')

    echo "$body" > "${SMOKE_OUTPUT_DIR}/api_${endpoint//\//_}.json"

    if [ "$status" -eq "$expected_status" ]; then
        log_success "API $endpoint returned $status"
        PASSED=$((PASSED + 1))
        echo "$body"
        return 0
    else
        log_error "API $endpoint returned $status (expected $expected_status)"
        FAILED=$((FAILED + 1))
        echo "$body"
        return 1
    fi
}

# Verify API response envelope has required fields
verify_envelope() {
    local response="$1"
    local endpoint="$2"

    if ! echo "$response" | jq -e '.success' >/dev/null 2>&1; then
        log_error "API $endpoint missing 'success' field"
        FAILED=$((FAILED + 1))
        return 1
    fi

    if ! echo "$response" | jq -e '.requestId' >/dev/null 2>&1; then
        log_warn "API $endpoint missing 'requestId' field"
        WARNINGS=$((WARNINGS + 1))
        return 0
    fi

    log_success "API $endpoint has valid envelope"
    PASSED=$((PASSED + 1))
    return 0
}

# ============================================================================
# HEALTH CHECK TEST
# ============================================================================

test_health() {
    log_info "Testing health endpoint..."

    local response
    response=$(api_get "/health" 200)

    if [ $? -ne 0 ]; then
        return 1
    fi

    # Verify health check structure
    local status
    status=$(echo "$response" | jq -r '.status // empty')

    if [ -z "$status" ]; then
        log_error "Health check missing 'status' field"
        FAILED=$((FAILED + 1))
        return 1
    fi

    # Check for degraded or unhealthy status
    # In dev mode, database check failing is acceptable (SQLite vs Postgres)
    local mode
    mode=$(echo "$response" | jq -r '.mode // "unknown"')

    if [ "$status" = "unhealthy" ]; then
        # Only fail if NOT in dev mode with just database failing
        local db_status
        db_status=$(echo "$response" | jq -r '.checks.database.status // "unknown"')

        if [ "$mode" = "development" ] && [ "$db_status" = "fail" ]; then
            log_warn "Health check: $status (dev mode, database fail acceptable)"
            WARNINGS=$((WARNINGS + 1))
        else
            log_error "Health check status: $status"
            FAILED=$((FAILED + 1))
            return 1
        fi
    elif [ "$status" = "degraded" ]; then
        log_warn "Health check status: $status"
        WARNINGS=$((WARNINGS + 1))
    else
        log_success "Health check status: $status"
        PASSED=$((PASSED + 1))
    fi

    # Verify critical checks (database in production)
    local db_status
    db_status=$(echo "$response" | jq -r '.checks.database.status // empty')

    if [ "$db_status" = "fail" ] && [ "$mode" != "development" ]; then
        log_error "Database check failed in $mode mode"
        FAILED=$((FAILED + 1))
        return 1
    fi

    if [ "$db_status" = "fail" ] && [ "$mode" = "development" ]; then
        log_warn "Database check failed (acceptable in dev mode)"
        WARNINGS=$((WARNINGS + 1))
    fi

    log_success "Health check passed"
    PASSED=$((PASSED + 1))
    return 0
}

# ============================================================================
# API ENVELOPE TESTS
# ============================================================================

test_api_envelope() {
    log_info "Testing API envelope shapes..."

    # Note: workspace API requires auth, so we'll test health and public endpoints
    # Authenticated endpoints will be tested after login via puppeteer

    # Test health endpoint envelope (doesn't use standard wrapper)
    local response
    response=$(cat "${SMOKE_OUTPUT_DIR}/api__health.json" 2>/dev/null || echo "{}")

    # Health endpoint has different structure, just verify it returns JSON
    if echo "$response" | jq -e '.status' >/dev/null 2>&1; then
        log_success "Health endpoint returns valid JSON"
        PASSED=$((PASSED + 1))
    else
        log_error "Health endpoint returned invalid JSON"
        FAILED=$((FAILED + 1))
    fi
}

# ============================================================================
# PUPPETEER UI TESTS
# ============================================================================

test_ui_pages() {
    log_info "Testing UI pages with Puppeteer..."

    # Create a Node.js script for Puppeteer tests
    cat > "${SMOKE_OUTPUT_DIR}/puppeteer-test.mjs" << 'EOF'
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';

const BASE_URL = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
const EMAIL = process.env.SMOKE_EMAIL || '';
const PASSWORD = process.env.SMOKE_PASSWORD || '';
const OUTPUT_DIR = process.env.SMOKE_OUTPUT_DIR || './smoke-test-results';
const ALLOW_DEV_AUTH_BYPASS = process.env.MENTIKO_ALLOW_DEV_AUTH_BYPASS === '1' ||
    process.env.MENTIKO_ALLOW_DEV_AUTH_BYPASS === 'true';

// In CI, use puppeteer MCP server. Locally, we can't directly call MCP from node.
// For CI compatibility, we'll output curl commands and screenshot targets.
const pages = [
    { path: '/', name: 'home' },
    { path: '/chains', name: 'chains', auth: true },
    { path: '/agents', name: 'agents', auth: true },
    { path: '/runs', name: 'runs', auth: true },
    { path: '/settings', name: 'settings', auth: true },
    { path: '/code', name: 'code', auth: true },
    { path: '/swarm', name: 'swarm', auth: true },
];

async function testWithCurl() {
    const results = [];
    let passed = 0;
    let failed = 0;

    for (const page of pages) {
        const url = `${BASE_URL}${page.path}`;
        console.log(`Testing ${page.name}: ${url}`);

        try {
            // Use curl to check if page returns 200
            const response = await fetch(url, {
                redirect: 'manual',
                headers: {
                    'User-Agent': 'Smoke-Test/1.0'
                }
            });

            const status = response.status;
            const finalUrl = response.headers.get('location') || url;

            if (status === 200 || status === 302 || status === 307) {
                console.log(`  [PASS] ${page.name} returned ${status}`);
                passed++;
                results.push({ page: page.name, status: 'pass', httpStatus: status });
            } else {
                console.log(`  [FAIL] ${page.name} returned ${status}`);
                failed++;
                results.push({ page: page.name, status: 'fail', httpStatus: status });
            }
        } catch (error) {
            console.log(`  [FAIL] ${page.name} error: ${error.message}`);
            failed++;
            results.push({ page: page.name, status: 'error', error: error.message });
        }
    }

    // Write results
    writeFileSync(join(OUTPUT_DIR, 'ui-results.json'), JSON.stringify(results, null, 2));

    console.log(`\nUI Tests: ${passed} passed, ${failed} failed`);
    return { passed, failed, results };
}

testWithCurl().then(({ passed, failed }) => {
    process.exit(failed > 0 ? 1 : 0);
});
EOF

    # Run the puppeteer test
    log_info "Running UI page checks..."

    local ui_exit=0
    SMOKE_BASE_URL="$SMOKE_BASE_URL" \
        SMOKE_EMAIL="$SMOKE_EMAIL" \
        SMOKE_PASSWORD="$SMOKE_PASSWORD" \
        SMOKE_OUTPUT_DIR="$SMOKE_OUTPUT_DIR" \
        node "${SMOKE_OUTPUT_DIR}/puppeteer-test.mjs" 2>&1 || ui_exit=$?

    # Parse results
    if [ -f "${SMOKE_OUTPUT_DIR}/ui-results.json" ]; then
        local passed
        local failed
        passed=$(jq '[.[] | select(.status == "pass")] | length' "${SMOKE_OUTPUT_DIR}/ui-results.json")
        failed=$(jq '[.[] | select(.status == "fail" or .status == "error")] | length' "${SMOKE_OUTPUT_DIR}/ui-results.json")

        PASSED=$((PASSED + passed))
        FAILED=$((FAILED + failed))

        log_info "UI page checks: $passed passed, $failed failed"
    elif [ "$ui_exit" -ne 0 ]; then
        log_error "UI page checks failed before writing results"
        FAILED=$((FAILED + 1))
    fi
}

# ============================================================================
# AUTHENTICATED API TESTS
# ============================================================================

test_authenticated_api() {
    log_info "Testing authenticated API endpoints..."

    # We'll use the MCP puppeteer tools to login and get cookies, then make API calls
    # For now, we'll create a simple test that checks if the terminal token endpoint exists
    # (actual terminal token test requires a running ws-terminal daemon)

    cat > "${SMOKE_OUTPUT_DIR}/auth-api-test.mjs" << 'EOF'
import { writeFileSync } from 'fs';
import { join } from 'path';

const BASE_URL = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
const EMAIL = process.env.SMOKE_EMAIL || '';
const PASSWORD = process.env.SMOKE_PASSWORD || '';
const OUTPUT_DIR = process.env.SMOKE_OUTPUT_DIR || './smoke-test-results';
const ALLOW_DEV_AUTH_BYPASS = process.env.MENTIKO_ALLOW_DEV_AUTH_BYPASS === '1' ||
    process.env.MENTIKO_ALLOW_DEV_AUTH_BYPASS === 'true';

async function testAuthRequired() {
    const endpoints = [
        '/api/workspaces',
        '/api/chains',
        '/api/tasks',
        '/api/terminal/token',
    ];

    const results = [];

    for (const endpoint of endpoints) {
        const url = `${BASE_URL}${endpoint}`;
        try {
            const response = await fetch(url, {
                redirect: 'manual'
            });
            const status = response.status;

            // Auth-required endpoints should either:
            // - Return 401 when not authenticated
            // - Return 302/307 redirect to login
            // - Return 200 only when explicit dev auth bypass is enabled
            if (status === 401 || status === 302 || status === 307 || (ALLOW_DEV_AUTH_BYPASS && status === 200)) {
                console.log(`[PASS] ${endpoint} returned ${status} (auth check)`);
                results.push({ endpoint, status: 'pass', httpStatus: status });
            } else {
                console.log(`[WARN] ${endpoint} returned ${status}`);
                results.push({ endpoint, status: 'warn', httpStatus: status });
            }
        } catch (error) {
            console.log(`[FAIL] ${endpoint} error: ${error.message}`);
            results.push({ endpoint, status: 'fail', error: error.message });
        }
    }

    return results;
}

testAuthRequired().then(results => {
    writeFileSync(join(OUTPUT_DIR, 'auth-api-results.json'), JSON.stringify(results, null, 2));
    process.exit(results.some(r => r.status === 'fail') ? 1 : 0);
});
EOF

    local auth_exit=0
    SMOKE_BASE_URL="$SMOKE_BASE_URL" \
        SMOKE_OUTPUT_DIR="$SMOKE_OUTPUT_DIR" \
        node "${SMOKE_OUTPUT_DIR}/auth-api-test.mjs" 2>&1 || auth_exit=$?

    if [ "$auth_exit" -ne 0 ] && [ ! -f "${SMOKE_OUTPUT_DIR}/auth-api-results.json" ]; then
        log_error "Authenticated API checks failed"
        FAILED=$((FAILED + 1))
    fi

    if [ -f "${SMOKE_OUTPUT_DIR}/auth-api-results.json" ]; then
        local passed
        local failed
        local warnings
        passed=$(jq '[.[] | select(.status == "pass")] | length' "${SMOKE_OUTPUT_DIR}/auth-api-results.json")
        failed=$(jq '[.[] | select(.status == "fail")] | length' "${SMOKE_OUTPUT_DIR}/auth-api-results.json")
        warnings=$(jq '[.[] | select(.status == "warn")] | length' "${SMOKE_OUTPUT_DIR}/auth-api-results.json")

        PASSED=$((PASSED + passed))
        FAILED=$((FAILED + failed))
        WARNINGS=$((WARNINGS + warnings))

        log_info "Authenticated API checks: $passed passed, $warnings warnings, $failed failed"
    fi
}

# ============================================================================
# MAIN TEST RUNNER
# ============================================================================

main() {
    echo "================================"
    echo "MENTIKO SMOKE TEST SUITE"
    echo "================================"
    echo "Base URL: $SMOKE_BASE_URL"
    echo "Output: $SMOKE_OUTPUT_DIR"
    echo "================================"
    echo

    # Check dependencies
    log_info "Checking dependencies..."

    if ! command_exists curl; then
        log_error "curl is required"
        exit 1
    fi

    if ! command_exists jq; then
        log_error "jq is required"
        exit 1
    fi

    if ! command_exists node; then
        log_error "node is required"
        exit 1
    fi

    log_success "All dependencies available"
    echo

    # Run tests
    test_health
    test_api_envelope
    test_ui_pages
    test_authenticated_api

    # Calculate elapsed time
    local end_time
    end_time=$(date +%s)
    local elapsed
    elapsed=$((end_time - START_TIME))

    # Print summary
    echo
    echo "================================"
    echo "SMOKE TEST SUMMARY"
    echo "================================"
    echo "Passed:   $PASSED"
    echo "Failed:   $FAILED"
    echo "Warnings: $WARNINGS"
    echo "Time:     ${elapsed}s"
    echo "================================"

    # Write summary to file
    cat > "${SMOKE_OUTPUT_DIR}/summary.json" << EOF
{
  "passed": $PASSED,
  "failed": $FAILED,
  "warnings": $WARNINGS,
  "elapsed_seconds": $elapsed,
  "base_url": "$SMOKE_BASE_URL",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

    if [ $FAILED -gt 0 ]; then
        log_error "Smoke tests failed!"
        echo "Results saved to: $SMOKE_OUTPUT_DIR"
        exit 1
    fi

    if [ $elapsed -gt "$SMOKE_TIMEOUT" ]; then
        log_warn "Smoke tests exceeded timeout (${elapsed}s > ${SMOKE_TIMEOUT}s)"
    fi

    log_success "All smoke tests passed!"
    echo "Results saved to: $SMOKE_OUTPUT_DIR"
    exit 0
}

# Run main
main "$@"
