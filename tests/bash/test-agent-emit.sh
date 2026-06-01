#!/bin/bash
# test-agent-emit.sh - regression coverage for `mentiko emit` and emit-event()
#
# Guards the canonical event format that chain-runner-complete.sh's matcher relies on.
# Background: agents used to hand-write event files and got the name/source wrong, so
# the completion handler couldn't recognize the event and chains stalled. Agents now run
# `mentiko emit <event>`, which must produce:
#   filename: $EVENTS_DIR/${RUN_ID}-${SOURCE}-${EVENT}.event  (run_id prefix dropped if empty)
#   body:     event: / source: ${MENTIKO_AGENT_ID} / run_id: / timestamp: / processed: false
# `mentiko emit` and emit-event() must produce byte-identical naming + content.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MENTIKO_BIN="$PROJECT_ROOT/bin/mentiko"

TESTS_PASSED=0
TESTS_FAILED=0

pass() { echo "  [PASS] $1"; ((TESTS_PASSED++)) || true; }
fail() { echo "  [FAIL] $1"; ((TESTS_FAILED++)) || true; }

assert_eq() {
  if [[ "$1" == "$2" ]]; then pass "$3"; else
    fail "$3"; echo "    expected: $1"; echo "    actual:   $2"; fi
}
assert_contains() {
  if grep -qF "$2" <<<"$1"; then pass "$3"; else
    fail "$3"; echo "    expected to contain: $2"; echo "    actual: $1"; fi
}

# run `mentiko emit` in an isolated env so the outer shell's MENTIKO_* vars don't leak.
# EVENTS_DIR is exported so config.sh (sourced by bin/mentiko) honors it (it uses :-).
run_emit() {
  local events_dir="$1" run_id="$2" agent_id="$3"; shift 3
  env -u MENTIKO_RUN_ID -u RUN_ID -u MENTIKO_AGENT_ID -u MENTIKO_AGENT_EMITS \
      EVENTS_DIR="$events_dir" \
      ${run_id:+MENTIKO_RUN_ID="$run_id" RUN_ID="$run_id"} \
      ${agent_id:+MENTIKO_AGENT_ID="$agent_id"} \
      bash "$MENTIKO_BIN" emit "$@" >/dev/null 2>&1
}

# -------------------------------------------------------------------
# case 1: run-scoped emit, source defaults to MENTIKO_AGENT_ID
# -------------------------------------------------------------------
D1="$(mktemp -d)"
run_emit "$D1" "run-emit-1" "smoke-runner-3" "smoke-results-ready"
F1="$(find "$D1" -name '*.event' | head -1)"

assert_eq "run-emit-1-smoke-runner-3-smoke-results-ready.event" "$(basename "$F1")" \
  "canonical filename: \${RUN_ID}-\${AGENT_ID}-\${EVENT}.event"
assert_contains "$(cat "$F1")" "event: smoke-results-ready" "writes event: field"
assert_contains "$(cat "$F1")" "source: smoke-runner-3" "source: defaults to \$MENTIKO_AGENT_ID"
assert_contains "$(cat "$F1")" "run_id: run-emit-1" "writes run_id: field (required by matcher)"
assert_contains "$(cat "$F1")" "processed: false" "writes processed: false"

# matcher sanity: source value contains the agent id (CURRENT_AGENT_ID), so
# chain-runner-complete.sh's grep -qi "$SESSION_PREFIX\|$CURRENT_AGENT_ID" matches.
src1="$(grep '^source:' "$F1" | sed 's/^source:[[:space:]]*//')"
assert_eq "smoke-runner-3" "$src1" "source is the agent id (matcher-recognized)"

# -------------------------------------------------------------------
# case 2: explicit source overrides MENTIKO_AGENT_ID
# -------------------------------------------------------------------
D2="$(mktemp -d)"
run_emit "$D2" "run-emit-2" "agent-default" "my-event" "explicit-src"
F2="$(find "$D2" -name '*.event' | head -1)"
assert_eq "run-emit-2-explicit-src-my-event.event" "$(basename "$F2")" \
  "explicit source arg overrides MENTIKO_AGENT_ID in filename"
assert_contains "$(cat "$F2")" "source: explicit-src" "explicit source arg overrides in body"

# -------------------------------------------------------------------
# case 3: manual CLI use (no RUN_ID) drops the run-id prefix
# -------------------------------------------------------------------
D3="$(mktemp -d)"
run_emit "$D3" "" "" "custom-event" "researcher"
F3="$(find "$D3" -name '*.event' | head -1)"
assert_eq "researcher-custom-event.event" "$(basename "$F3")" \
  "no RUN_ID: filename drops the run-id prefix"
assert_contains "$(cat "$F3")" "run_id: " "run_id: line still present (empty)"

# -------------------------------------------------------------------
# case 4: missing event-name -> usage error, non-zero exit
# -------------------------------------------------------------------
D4="$(mktemp -d)"
if env -u MENTIKO_AGENT_ID EVENTS_DIR="$D4" bash "$MENTIKO_BIN" emit >/dev/null 2>&1; then
  fail "missing event-name should exit non-zero"
else
  pass "missing event-name exits non-zero"
fi

# -------------------------------------------------------------------
# case 5: no source AND no MENTIKO_AGENT_ID -> error, no file written
# -------------------------------------------------------------------
D5="$(mktemp -d)"
if env -u MENTIKO_AGENT_ID EVENTS_DIR="$D5" bash "$MENTIKO_BIN" emit lonely-event >/dev/null 2>&1; then
  fail "no source + no MENTIKO_AGENT_ID should exit non-zero"
else
  pass "no source + no MENTIKO_AGENT_ID exits non-zero"
fi
if [[ -z "$(find "$D5" -name '*.event' 2>/dev/null)" ]]; then
  pass "no event file written when source cannot be resolved"
else
  fail "no event file should be written when source cannot be resolved"
fi

# -------------------------------------------------------------------
# case 6: unsafe filename characters are sanitized, but body fields stay intact
# -------------------------------------------------------------------
D6="$(mktemp -d)"
run_emit "$D6" "run-unsafe" "bad/source" "event/with/slash"
F6_ALL="$(find "$D6" -name '*.event' -type f)"
F6_COUNT="$(printf '%s\n' "$F6_ALL" | sed '/^$/d' | wc -l | tr -d ' ')"
if [[ "$F6_COUNT" == "1" ]]; then
  pass "unsafe source/event still writes exactly one event file"
else
  fail "unsafe source/event should write exactly one event file"
  echo "$F6_ALL"
fi
F6="$(printf '%s\n' "$F6_ALL" | sed -n '1p')"
assert_eq "run-unsafe-bad_source-event_with_slash.event" "$(basename "$F6")" \
  "unsafe filename characters are sanitized"
assert_contains "$(cat "$F6")" "source: bad/source" "body preserves raw source"
assert_contains "$(cat "$F6")" "event: event/with/slash" "body preserves raw event name"

# -------------------------------------------------------------------
# case 6: `mentiko emit` and emit-event() produce identical name + body
#         (acceptance: one implementation, proven identical)
# -------------------------------------------------------------------
DA="$(mktemp -d)"; DB="$(mktemp -d)"
run_emit "$DA" "run-parity" "parity-agent" "done"
(
  set +u
  EVENTS_DIR="$DB"; RUN_ID="run-parity"; MENTIKO_RUN_ID="run-parity"
  source "$PROJECT_ROOT/lib/event-trigger.sh" >/dev/null 2>&1
  emit-event "done" "parity-agent" "" >/dev/null 2>&1
)
FA="$(find "$DA" -name '*.event' | head -1)"
FB="$(find "$DB" -name '*.event' | head -1)"
assert_eq "$(basename "$FA")" "$(basename "$FB")" \
  "mentiko emit and emit-event produce identical filename"
# bodies differ only on the volatile timestamp: line
if diff <(grep -v '^timestamp:' "$FA") <(grep -v '^timestamp:' "$FB") >/dev/null; then
  pass "mentiko emit and emit-event produce identical body (minus timestamp)"
else
  fail "mentiko emit and emit-event bodies diverge"
  diff <(grep -v '^timestamp:' "$FA") <(grep -v '^timestamp:' "$FB") || true
fi

# -------------------------------------------------------------------
echo ""
echo "  results: $TESTS_PASSED passed, $TESTS_FAILED failed"
[[ "$TESTS_FAILED" -eq 0 ]]
