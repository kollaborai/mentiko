#!/usr/bin/env bash
# engine-e2e-routing.sh — hermetic shell retry-delay regression proof.
# Fan-group ownership is typed and covered by runner-v2 Jest and engine event E2E.

set -uo pipefail

SCRIPT_DIR_SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR_SELF/../../.." && pwd)"
ROUTING_LIB="$REPO_ROOT/lib/routing-lib.sh"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/mentiko-routing-e2e.XXXXXX")"
cleanup() { rm -rf "$TMP_ROOT" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

PASS=0; FAIL=0
pass() { printf '  ok %s\n' "$1"; PASS=$((PASS + 1)); }
fail() { printf '  fail %s\n' "$1"; FAIL=$((FAIL + 1)); }

rcd() { # <args...> -> value|stderr|exit
  local out err rc
  err="$TMP_ROOT/rcd.err"
  out="$(MENTIKO_CODE_ROOT="$REPO_ROOT" bash -c '
    set -uo pipefail
    source "'"$ROUTING_LIB"'"
    retry-calculate-delay "$@"
  ' _ "$@" 2>"$err")"
  rc=$?
  printf '%s|%s|%s' "$out" "$(cat "$err" 2>/dev/null)" "$rc"
}

check_delay() { # <label> <expected> <args...>
  local label="$1" expected="$2"; shift 2
  local result value stderr
  result="$(rcd "$@")"; value="${result%%|*}"; stderr="${result#*|}"; stderr="${stderr%|*}"
  if [[ -n "$stderr" || ! "$value" =~ ^[0-9]+$ || "$value" -ne "$expected" ]]; then
    fail "$label (got=$value stderr=$stderr)"
  else
    pass "$label"
  fi
}

bash -n "$ROUTING_LIB" && pass "routing-lib.sh parses" || fail "routing-lib.sh syntax"
check_delay "fractional exponential truncates" 7 1 exponential 5 300 1.5
check_delay "exponential cap" 300 10 exponential 5 300 2.0
check_delay "linear strategy" 15 2 linear 5 300 2.0
check_delay "fixed strategy" 7 3 fixed 7 300 2.0

printf 'routing e2e results: %d passed, %d failed\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
