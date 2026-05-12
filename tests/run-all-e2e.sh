#!/bin/bash
# run-all-e2e.sh - run all e2e tests
# usage: ./run-all-e2e.sh [test-name]
#
# if test-name provided, only run that test
# otherwise runs all tests in order

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
E2E_DIR="$SCRIPT_DIR/e2e"

# color codes
red='\033[0;31m'
green='\033[0;32m'
yellow='\033[0;33m'
blue='\033[0;34m'
nc='\033[0m' # no color

# test list in order
TESTS=(
    "test-full-chain.sh"
    "test-webhook-e2e.sh"
    "test-auth-e2e.sh"
    "test-parallel-e2e.sh"
    "test-debug-e2e.sh"
    "test-integrations-e2e.sh"
    "test-run-object.sh"
    "test-webhook-sender.sh"
    "test-auth-flow.sh"
    "test-remote-workspace.sh"
    "test-parallel-agents.sh"
    "test-conditional-branching.sh"
)

# counters
total_tests=0
passed_tests=0
failed_tests=0
skipped_tests=0

# header
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║         mentiko e2e test suite                       ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# check dependencies
echo -e "${blue}checking dependencies...${nc}"

DEPS_OK=true

if ! command -v jq &> /dev/null; then
    echo -e "  ${red}✖ jq required but not found${nc}"
    DEPS_OK=false
fi

if [[ "$DEPS_OK" == "false" ]]; then
    echo ""
    echo -e "${red}aborting: missing dependencies${nc}"
    exit 1
fi

echo -e "  ${green}✔ all dependencies found${nc}"
echo ""

# determine which tests to run
if [[ -n "${1:-}" ]]; then
    # run specific test
    TEST_FILES=("$E2E_DIR/$1")
    if [[ ! -f "$TEST_FILES" ]]; then
        echo -e "${red}error: test not found: $1${nc}"
        exit 1
    fi
else
    # run all tests
    TEST_FILES=("${TESTS[@]/#/$E2E_DIR/}")
fi

# run tests
for test_file in "${TEST_FILES[@]}"; do
    test_name=$(basename "$test_file")
    total_tests=$((total_tests + 1))

    echo -e "${blue}running: $test_name${nc}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    # make test executable
    chmod +x "$test_file"

    # run test
    if bash "$test_file"; then
        passed_tests=$((passed_tests + 1))
        echo -e "${green}✓ passed${nc}"
    else
        failed_tests=$((failed_tests + 1))
        echo -e "${red}✗ failed${nc}"
    fi

    echo ""
done

# summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "summary:"
echo "  total:   $total_tests"
echo -e "  ${green}passed:  $passed_tests${nc}"

if [[ $failed_tests -gt 0 ]]; then
    echo -e "  ${red}failed:  $failed_tests${nc}"
fi

if [[ $skipped_tests -gt 0 ]]; then
    echo -e "  ${yellow}skipped: $skipped_tests${nc}"
fi

echo ""

# exit code
if [[ $failed_tests -gt 0 ]]; then
    echo -e "${red}tests failed${nc}"
    exit 1
else
    echo -e "${green}all tests passed${nc}"
    exit 0
fi
