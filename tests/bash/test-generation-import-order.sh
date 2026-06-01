#!/bin/bash
# Regression guard: generation import must run after quality gates.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TARGET="$PROJECT_ROOT/lib/chain-runner-complete.sh"

line_of() {
  local pattern="$1"
  awk -v pat="$pattern" 'index($0, pat) { print NR; exit }' "$TARGET"
}

import_line="$(line_of 'MENTIKO_GENERATION_JOB_ID')"
summary_gate_line="$(line_of 'summary_status=')"
route_gate_line="$(line_of 'route_coverage_gate_applies=')"
downstream_line="$(line_of 'phase 6')"

fail() {
  echo "  [FAIL] $1"
  exit 1
}

pass() {
  echo "  [PASS] $1"
}

[[ -n "$import_line" ]] || fail "generation import backstop not found"
[[ -n "$summary_gate_line" ]] || fail "summary quality gate not found"
[[ -n "$route_gate_line" ]] || fail "route coverage quality gate not found"
[[ -n "$downstream_line" ]] || fail "phase 6 downstream marker not found"

if (( import_line <= summary_gate_line )); then
  fail "generation import runs before summary quality gate"
fi

if (( import_line <= route_gate_line )); then
  fail "generation import runs before route coverage quality gate"
fi

if (( import_line >= downstream_line )); then
  fail "generation import must happen before downstream phase 6"
fi

pass "generation import runs after quality gates and before downstream launch"

