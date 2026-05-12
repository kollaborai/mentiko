#!/bin/bash
# test-runner.sh - test runner that runs all tests
#
# usage:
#   ./tests/test-runner.sh [--verbose] [--filter <pattern>]
#
# runs all test suites in tests/ directory and reports results

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TESTS_DIR="$SCRIPT_DIR"

# options
VERBOSE=false
FILTER=""

# parse args
while [[ $# -gt 0 ]]; do
    case "$1" in
        --verbose|-v) VERBOSE=true; shift ;;
        --filter|-f) FILTER="$2"; shift 2 ;;
        --help|-h)
            echo "usage: test-runner.sh [--verbose] [--filter <pattern>]"
            echo ""
            echo "options:"
            echo "  --verbose, -v     show detailed test output"
            echo "  --filter, -f      only run tests matching pattern"
            echo "  --help, -h        show this help"
            exit 0
            ;;
        *) shift ;;
    esac
done

# color codes (if terminal)
if [[ -t 1 ]]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[0;33m'
    BLUE='\033[0;34m'
    RESET='\033[0m'
else
    RED=''
    GREEN=''
    YELLOW=''
    BLUE=''
    RESET=''
fi

# counters
TOTAL_SUITES=0
PASSED_SUITES=0
FAILED_SUITES=0
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# -------------------------------------------------------------------
# run single test suite
# -------------------------------------------------------------------

run_test_suite() {
    local test_file="$1"
    local test_name="$(basename "$test_file" .sh)"

    # check filter
    if [[ -n "$FILTER" && ! "$test_name" =~ $FILTER ]]; then
        return
    fi

    ((TOTAL_SUITES++))
    echo ""
    echo -e "${BLUE}▶ running: $test_name${RESET}"
    echo "=================================="

    # run test
    local start_time=$(date +%s)
    local output
    local exit_code

    if [[ "$VERBOSE" == "true" ]]; then
        bash "$test_file"
        exit_code=$?
    else
        output=$(bash "$test_file" 2>&1)
        exit_code=$?
    fi

    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    # parse results from output
    local passed=0
    local failed=0

    if [[ "$VERBOSE" != "true" ]]; then
        # show output on failure
        if [[ $exit_code -ne 0 ]]; then
            echo "$output"
        else
            # show summary lines
            echo "$output" | grep -E "(✔|✖|passed|failed)" || true
        fi
    fi

    # extract counts from output
    if [[ -n "$output" ]]; then
        passed=$(echo "$output" | grep "✔ passed:" | awk '{print $3}' || echo "0")
        failed=$(echo "$output" | grep "✖ failed:" | awk '{print $3}' || echo "0")

        # fallback: count the icons
        if [[ "$passed" == "0" ]]; then
            passed=$(echo "$output" | grep -c "✔" || echo "0")
        fi
        if [[ "$failed" == "0" ]]; then
            failed=$(echo "$output" | grep -c "✖" || echo "0")
        fi
    fi

    TOTAL_TESTS=$((TOTAL_TESTS + passed + failed))
    PASSED_TESTS=$((PASSED_TESTS + passed))
    FAILED_TESTS=$((FAILED_TESTS + failed))

    # result
    if [[ $exit_code -eq 0 ]]; then
        ((PASSED_SUITES++))
        echo -e "${GREEN}✔ passed${RESET} (${duration}s)"
    else
        ((FAILED_SUITES++))
        echo -e "${RED}✖ failed${RESET} (${duration}s)"
    fi
}

# -------------------------------------------------------------------
# discover and run tests
# -------------------------------------------------------------------

echo ""
echo -e "${BLUE}mentiko test runner${RESET}"
echo "======================="
echo ""

# find all test-*.sh files
test_files=()
while IFS= read -r -d '' file; do
    test_files+=("$file")
done < <(find "$TESTS_DIR" -name "test-*.sh" -type f -print0 2>/dev/null)

# sort
IFS=$'\n' test_files=($(sort <<<"${test_files[*]}"))
unset IFS

# run each test suite
for test_file in "${test_files[@]}"; do
    # skip self
    [[ "$(basename "$test_file")" == "test-runner.sh" ]] && continue

    run_test_suite "$test_file"
done

# -------------------------------------------------------------------
# final summary
# -------------------------------------------------------------------

echo ""
echo "==================================="
echo -e "${BLUE}final summary${RESET}"
echo "==================================="

if [[ $FAILED_SUITES -eq 0 ]]; then
    echo -e "${GREEN}✔ all test suites passed!${RESET}"
else
    echo -e "${RED}✖ $FAILED_SUITES test suite(s) failed${RESET}"
fi

echo ""
echo "suites:"
echo "  total:   $TOTAL_SUITES"
echo -e "  ${GREEN}passed:${RESET}  $PASSED_SUITES"
echo -e "  ${RED}failed:${RESET}  $FAILED_SUITES"

echo ""
echo "individual tests:"
echo "  total:   $TOTAL_TESTS"
echo -e "  ${GREEN}passed:${RESET}  $PASSED_TESTS"
echo -e "  ${RED}failed:${RESET}  $FAILED_TESTS"

echo ""

# exit with proper code
[[ $FAILED_SUITES -eq 0 ]] && exit 0 || exit 1
