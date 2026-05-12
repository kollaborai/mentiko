#!/bin/bash
# test-validate-artifacts.sh - unit tests for bin/validate-artifacts
#
# tests:
#   - validates successful pass for valid artifacts
#   - fails cleanly when artifacts directory is missing
#   - handles empty artifact directories as a no-op
#   - validates malformed artifact files are reported as failures

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SCRIPT="$REPO_ROOT/bin/validate-artifacts"
FIXTURES="$SCRIPT_DIR/fixtures/validate-artifacts"

TMP_DIR="$(mktemp -d)"
export TMP_DIR
trap 'rm -rf "$TMP_DIR"' EXIT

TESTS_PASSED=0
TESTS_FAILED=0

assert_output_contains() {
  local output="$1"
  local needle="$2"
  local msg="${3:-assertion failed}"
  if echo "$output" | grep -qF "$needle"; then
    echo "  ✔ $msg"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo "  ✖ $msg"
    echo "    expected: $needle"
    echo "    output:   $(printf '%s' "$output" | head -n 3)"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
}

assert_exit_code() {
  local expected="$1"
  local actual="$2"
  local msg="${3:-exit code check}"
  if [[ "$expected" == "$actual" ]]; then
    echo "  ✔ $msg"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo "  ✖ $msg (expected $expected, got $actual)"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
}

run_validator() {
  local workspace="$1"
  if VALIDATOR_OUTPUT=$(HOME="$workspace" MENTIKO_GLOBAL_ROOT="$workspace" node "$SCRIPT" 2>&1); then
    VALIDATOR_STATUS=0
  else
    VALIDATOR_STATUS=$?
  fi
}

setup_artifacts_dir() {
  local workspace="$1"
  local fixture_file="$2"
  mkdir -p "$workspace/marketplace/artifacts"
  rm -f "$workspace/marketplace/artifacts"/*.md
  if [[ -n "${fixture_file:-}" ]]; then
    cp "$fixture_file" "$workspace/marketplace/artifacts/"
  fi
}

echo "validate-artifacts unit tests"
echo "============================"
echo ""

# test: success path
setup_artifacts_dir "$TMP_DIR" "$FIXTURES/valid-artifact.md"
run_validator "$TMP_DIR"
assert_exit_code 0 "$VALIDATOR_STATUS" "valid artifacts pass"
assert_output_contains "$VALIDATOR_OUTPUT" "results:  1 passed  0 failed  1 total" \
  "valid artifact reports pass count"
assert_output_contains "$VALIDATOR_OUTPUT" "valid-artifact.md" \
  "valid artifact is marked as pass"
assert_output_contains "$VALIDATOR_OUTPUT" "pass" \
  "valid artifact status is pass"

echo ""

# test: missing artifacts directory -> error
rm -rf "$TMP_DIR/marketplace"
run_validator "$TMP_DIR"
assert_exit_code 1 "$VALIDATOR_STATUS" "missing artifacts directory exits 1"
assert_output_contains "$VALIDATOR_OUTPUT" "error: cannot read artifacts directory" \
  "missing directory emits read error"

echo ""

# test: empty artifacts directory returns no .md files
setup_artifacts_dir "$TMP_DIR" ""
run_validator "$TMP_DIR"
assert_exit_code 0 "$VALIDATOR_STATUS" "empty artifacts directory exits 0"
assert_output_contains "$VALIDATOR_OUTPUT" "no .md files found in" \
  "empty directory is treated as a no-op"

echo ""

# test: malformed artifacts fail validation
setup_artifacts_dir "$TMP_DIR" "$FIXTURES/invalid-frontmatter.md"
run_validator "$TMP_DIR"
assert_exit_code 1 "$VALIDATOR_STATUS" "invalid frontmatter exits 1"
assert_output_contains "$VALIDATOR_OUTPUT" "missing: frontmatter" \
  "missing frontmatter is surfaced"
assert_output_contains "$VALIDATOR_OUTPUT" "invalid-frontmatter.md" \
  "invalid artifact is marked as failure"

echo ""
echo "results: $TESTS_PASSED passed, $TESTS_FAILED failed"
if [[ "$TESTS_FAILED" -ne 0 ]]; then
  exit 1
fi

exit 0
