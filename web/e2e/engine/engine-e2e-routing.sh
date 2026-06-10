#!/usr/bin/env bash
# engine-e2e-routing.sh — hermetic concurrency + unit proof for lib/routing-lib.sh
#
# Covers the wave-2 "group B" routing fixes:
#   #5  fanin-race          — fan-group counter had no mutual exclusion (lost-update
#                             increments + TOCTOU on the trigger claim), so under N
#                             parallel completers the fan-in either never fired (run
#                             hangs) or fired more than once (double-trigger).
#   #10 retry-delay-float   — exponential strategy computed the delay via bc (floats
#                             like "12.50"), then `$((delay))` aborted the script.
#
# This is fully hermetic: it sources routing-lib.sh directly into a throwaway state
# dir (MENTIKO temp), and replaces the fan-in launch target ($SCRIPT_DIR/chain-runner.sh)
# with a tiny stub that records ONE unique marker file per launch — so "did the fan-in
# fire, and exactly how many times?" is answered by counting files, with zero append
# races and zero real agent/model/network traffic.
#
# The concurrency hammer also runs against a PRE-FIX copy of the functions (pulled from
# `git show HEAD:lib/routing-lib.sh`) to prove the test actually catches the bug: the
# unfixed code is expected to FAIL the exactly-once invariant.
#
# Usage:   web/e2e/engine/engine-e2e-routing.sh
# Exit:    0 = all assertions passed, non-zero = failure (CI gate).

set -uo pipefail

SCRIPT_DIR_SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR_SELF/../../.." && pwd)"
ROUTING_LIB="$REPO_ROOT/lib/routing-lib.sh"

# Pick a bash 4+ for the engine (macOS system bash is 3.2; CI is 5.x). The lock
# primitive is deliberately portable to 3.2, but we run under the same interpreter
# the engine uses so the proof matches production.
pick_bash() {
  if [[ "${BASH_VERSINFO:-0}" -ge 4 ]]; then command -v bash; return; fi
  local cand
  for cand in /opt/homebrew/bin/bash /usr/local/bin/bash; do
    [[ -x "$cand" ]] && { echo "$cand"; return; }
  done
  command -v bash
}
ENGINE_BASH="$(pick_bash)"

if [[ -t 1 && -z "${CI:-}" ]]; then
  C_RED=$'\033[0;31m'; C_GREEN=$'\033[0;32m'; C_YEL=$'\033[0;33m'; C_BLU=$'\033[0;34m'; C_NC=$'\033[0m'
else
  C_RED=""; C_GREEN=""; C_YEL=""; C_BLU=""; C_NC=""
fi

PASS=0; FAIL=0
pass() { printf '  %s✔%s %s\n' "$C_GREEN" "$C_NC" "$1"; PASS=$((PASS+1)); }
fail() { printf '  %sx%s %s\n' "$C_RED" "$C_NC" "$1"; FAIL=$((FAIL+1)); }
note() { printf '  %s·%s %s\n' "$C_BLU" "$C_NC" "$1"; }
hr()   { printf '%s\n' "------------------------------------------------------------"; }

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/mentiko-routing-e2e.XXXXXX")"
cleanup() { rm -rf "$TMP_ROOT" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

hr; printf '%smentiko ROUTING e2e%s — fan-in concurrency + retry-delay, hermetic\n' "$C_YEL" "$C_NC"; hr
note "repo:        $REPO_ROOT"
note "engine bash: $ENGINE_BASH ($("$ENGINE_BASH" -c 'echo $BASH_VERSION'))"
note "routing lib: $ROUTING_LIB"
note "tmp root:    $TMP_ROOT"
echo

# =====================================================================
# Shared worker library, sourced by every (sub)shell that drives the fan group.
#
# It sources a given routing-lib path with STATE_DIR pointed at a temp dir, and a
# SCRIPT_DIR pointed at a dir containing a stub chain-runner.sh that records ONE
# unique marker file per fan-in launch. Counting marker files = counting fan-ins.
# =====================================================================
WORKER_LIB="$TMP_ROOT/worker-lib.sh"
cat > "$WORKER_LIB" <<'WLIB'
# args via env: RL_PATH (routing-lib to source), STATE_DIR, SCRIPT_DIR
set -uo pipefail
source "$RL_PATH"
WLIB

# Build a stub "chain-runner.sh" that the real _fan_group_launch will invoke.
# It writes a unique file into $TRIGGER_DIR (passed via env) — no append races.
make_stub_scriptdir() {  # <dest_dir> <trigger_dir>
  local dest="$1" trig="$2"
  mkdir -p "$dest"
  cat > "$dest/chain-runner.sh" <<STUB
#!/usr/bin/env bash
# stub fan-in target: record exactly one marker per invocation.
mkdir -p "$trig" 2>/dev/null || true
: > "$trig/trigger.\$\$.\$RANDOM.\$(date +%s%N 2>/dev/null || date +%s)"
exit 0
STUB
  chmod +x "$dest/chain-runner.sh"
}

# write a fan group state file directly (mirrors fan-group-create + the launcher's
# appended chain_file/run_id lines). total is written WITH macOS-style padding on
# purpose, to keep exercising the _fan_num whitespace hardening.
write_group_state() {  # <state_dir> <group_id> <n> <wait_for> <fan_in> <chain_file>
  local sd="$1" gid="$2" n="$3" wf="$4" fin="$5" cf="$6"
  mkdir -p "$sd/fan-groups"
  cat > "$sd/fan-groups/${gid}.state" <<EOF
status: running
started: $(date -Iseconds)
event: hammer-event
fan_out_agents: $(seq -s' ' 1 "$n" | sed 's/[0-9]\+/agent&/g')
fan_in_agent: $fin
wait_for: $wf
quorum: 0
on_error:
completed: 0
failed: 0
total:        $n
chain_file: $cf
run_id: test-run
EOF
}

# Run ONE hammer iteration: N concurrent completers against a fresh group.
# echoes "<completed_count> <trigger_count>".
# args: <routing_lib_path> <iteration_tag> <N>
hammer_once() {
  local rl="$1" tag="$2" n="$3"
  local sd="$TMP_ROOT/state-$tag"
  local scd="$TMP_ROOT/scriptdir-$tag"
  local trig="$TMP_ROOT/triggers-$tag"
  local cf="$TMP_ROOT/chain-$tag.json"
  rm -rf "$sd" "$scd" "$trig"; mkdir -p "$sd" "$trig"
  echo '{"name":"hammer"}' > "$cf"           # chain_file must exist for the launch
  make_stub_scriptdir "$scd" "$trig"
  write_group_state "$sd" hammergrp "$n" all faninZ "$cf"

  # fire N concurrent completers, each in its own subshell sourcing the worker lib.
  local i
  for ((i=1; i<=n; i++)); do
    (
      export RL_PATH="$rl" STATE_DIR="$sd" SCRIPT_DIR="$scd"
      source "$WORKER_LIB"
      fan-group-agent-complete hammergrp "agent$i" complete >/dev/null 2>&1
    ) &
  done
  wait

  local completed trigger_count
  completed="$(grep "^completed:" "$sd/fan-groups/hammergrp.state" 2>/dev/null | tr -dc '0-9')"
  [[ -z "$completed" ]] && completed=0
  trigger_count="$(ls -1 "$trig" 2>/dev/null | wc -l | tr -d ' ')"
  echo "$completed $trigger_count"
}

# ---------------------------------------------------------------------
# 0. preflight + pre-fix snapshot
# ---------------------------------------------------------------------
"$ENGINE_BASH" -n "$ROUTING_LIB" >/dev/null 2>&1 \
  && pass "routing-lib.sh parses under $("$ENGINE_BASH" -c 'echo bash $BASH_VERSION' | awk '{print $2}')" \
  || { fail "routing-lib.sh has a syntax error"; }

PREFIX_LIB="$TMP_ROOT/routing-lib.PREFIX.sh"
if git -C "$REPO_ROOT" show HEAD:lib/routing-lib.sh > "$PREFIX_LIB" 2>/dev/null && [[ -s "$PREFIX_LIB" ]]; then
  note "pre-fix snapshot pulled from git HEAD:lib/routing-lib.sh ($(wc -l < "$PREFIX_LIB") lines)"
  HAVE_PREFIX=1
else
  note "${C_YEL}could not pull HEAD:lib/routing-lib.sh (uncommitted repo?) — skipping pre-fix-fails demo${C_NC}"
  HAVE_PREFIX=0
fi
echo

# the worker lib + hammer helpers must be visible to functions we call below.
# (they're defined in THIS shell; hammer_once spawns subshells that re-source.)
export TMP_ROOT WORKER_LIB

# =====================================================================
# TEST A — concurrency hammer: N parallel completers, ~20 iterations.
# Post-fix: exactly N completions recorded AND fan-in fired EXACTLY once, every
# iteration. Pre-fix (if available): expected to FAIL the invariant at least once.
# =====================================================================
printf '%s[A] concurrency hammer — %d parallel completers × %d iterations%s\n' "$C_BLU" 8 20 "$C_NC"
N=8; ITERS=20
a_ok=1
for ((it=1; it<=ITERS; it++)); do
  read -r got_completed got_triggers <<<"$(hammer_once "$ROUTING_LIB" "fix-$it" "$N")"
  if [[ "$got_completed" -ne "$N" || "$got_triggers" -ne 1 ]]; then
    a_ok=0
    note "iteration $it: completed=$got_completed (want $N), fan-in fired=$got_triggers (want 1)  <-- FAIL"
  fi
done
if [[ "$a_ok" -eq 1 ]]; then
  pass "post-fix: $ITERS/$ITERS iterations recorded exactly $N completions and fired fan-in exactly once"
else
  fail "post-fix: at least one iteration lost an increment or mis-fired the fan-in"
fi

# pre-fix demonstration: the same hammer against HEAD's code should break the invariant.
if [[ "$HAVE_PREFIX" -eq 1 ]]; then
  prefix_violations=0
  for ((it=1; it<=ITERS; it++)); do
    read -r pc pt <<<"$(hammer_once "$PREFIX_LIB" "prefix-$it" "$N")"
    # a violation = wrong completion count OR fan-in not fired exactly once.
    if [[ "$pc" -ne "$N" || "$pt" -ne 1 ]]; then
      prefix_violations=$((prefix_violations+1))
    fi
  done
  note "pre-fix hammer: $prefix_violations/$ITERS iterations violated the invariant (lost increment and/or mis-fire)"
  if [[ "$prefix_violations" -gt 0 ]]; then
    pass "pre-fix-fails proof: unfixed HEAD code FAILS the exactly-once/no-lost-update invariant ($prefix_violations/$ITERS bad)"
  else
    # racy by nature; absence of a catch in 20 iters is not a pass for the fix, but
    # note it loudly rather than silently claiming the test proves anything.
    fail "pre-fix-fails proof: 20 iterations did not surface the race on this host (try re-running; the bug is timing-dependent)"
  fi
fi
echo

# =====================================================================
# TEST B — trigger idempotence: after the group is satisfied, calling the trigger
# path repeatedly launches the fan-in AT MOST once total.
# =====================================================================
printf '%s[B] trigger idempotence — repeated trigger after completion fires once%s\n' "$C_BLU" "$C_NC"
b_sd="$TMP_ROOT/state-idem"; b_scd="$TMP_ROOT/scriptdir-idem"; b_trig="$TMP_ROOT/triggers-idem"; b_cf="$TMP_ROOT/chain-idem.json"
mkdir -p "$b_sd" "$b_trig"; echo '{"name":"idem"}' > "$b_cf"
make_stub_scriptdir "$b_scd" "$b_trig"
write_group_state "$b_sd" idemgrp 3 all faninI "$b_cf"
(
  export RL_PATH="$ROUTING_LIB" STATE_DIR="$b_sd" SCRIPT_DIR="$b_scd"
  source "$WORKER_LIB"
  # complete all three sequentially; the 3rd should win the claim and launch once.
  fan-group-agent-complete idemgrp a complete >/dev/null 2>&1
  fan-group-agent-complete idemgrp b complete >/dev/null 2>&1
  fan-group-agent-complete idemgrp c complete >/dev/null 2>&1
  # now hammer the public trigger path repeatedly — all must be no-ops.
  fan-group-check-trigger idemgrp >/dev/null 2>&1
  fan-group-check-trigger idemgrp >/dev/null 2>&1
  fan-group-check-trigger idemgrp >/dev/null 2>&1
  # and an extra late completer (e.g. a duplicated completion signal) must not re-fire.
  fan-group-agent-complete idemgrp c complete >/dev/null 2>&1
)
idem_triggers="$(ls -1 "$b_trig" 2>/dev/null | wc -l | tr -d ' ')"
idem_status="$(grep '^status:' "$b_sd/fan-groups/idemgrp.state" | cut -d' ' -f2-)"
if [[ "$idem_triggers" -eq 1 ]]; then
  pass "idempotence: fan-in launched exactly once across 3 completes + 3 trigger calls + 1 dup complete (status=$idem_status)"
else
  fail "idempotence: fan-in launched $idem_triggers times (want 1)"
fi
echo

# =====================================================================
# TEST B2 — concurrent completers + concurrent trigger pollers race the claim.
# Mixing the two public entrypoints under contention must STILL fire exactly once.
# =====================================================================
printf '%s[B2] mixed contention — completers + trigger pollers fire fan-in once%s\n' "$C_BLU" "$C_NC"
m_sd="$TMP_ROOT/state-mix"; m_scd="$TMP_ROOT/scriptdir-mix"; m_trig="$TMP_ROOT/triggers-mix"; m_cf="$TMP_ROOT/chain-mix.json"
mix_ok=1
for ((it=1; it<=10; it++)); do
  rm -rf "$m_sd" "$m_scd" "$m_trig"; mkdir -p "$m_sd" "$m_trig"; echo '{"name":"mix"}' > "$m_cf"
  make_stub_scriptdir "$m_scd" "$m_trig"
  write_group_state "$m_sd" mixgrp 4 all faninM "$m_cf"
  for k in 1 2 3 4; do
    ( export RL_PATH="$ROUTING_LIB" STATE_DIR="$m_sd" SCRIPT_DIR="$m_scd"; source "$WORKER_LIB"
      fan-group-agent-complete mixgrp "agent$k" complete >/dev/null 2>&1 ) &
  done
  for k in 1 2 3; do
    ( export RL_PATH="$ROUTING_LIB" STATE_DIR="$m_sd" SCRIPT_DIR="$m_scd"; source "$WORKER_LIB"
      fan-group-check-trigger mixgrp >/dev/null 2>&1 ) &
  done
  wait
  mt="$(ls -1 "$m_trig" 2>/dev/null | wc -l | tr -d ' ')"
  [[ "$mt" -ne 1 ]] && { mix_ok=0; note "mixed iter $it: fan-in fired $mt times (want 1)"; }
done
[[ "$mix_ok" -eq 1 ]] && pass "mixed contention: 10/10 iterations fired fan-in exactly once" \
                      || fail "mixed contention: a fan-in mis-fired under completer+poller contention"
echo

# =====================================================================
# TEST C — retry-delay unit checks (run under the engine bash so $(( )) semantics
# match production). Asserts integers, no arithmetic errors, max cap, and that
# float-producing exponential inputs are truncated cleanly.
# =====================================================================
printf '%s[C] retry-calculate-delay — float-safe integers, max cap, strategies%s\n' "$C_BLU" "$C_NC"

# Capture both stdout and stderr; a bash arithmetic error (the bug) prints to stderr.
rcd() {  # <args...> -> echoes "value|stderr"
  local out err rc
  err="$TMP_ROOT/rcd.err"
  out="$("$ENGINE_BASH" -c '
      set -uo pipefail
      STATE_DIR="'"$TMP_ROOT"'/rcd-state"; SCRIPT_DIR="'"$TMP_ROOT"'/rcd-sd"
      source "'"$ROUTING_LIB"'"
      retry-calculate-delay "$@"
    ' _ "$@" 2>"$err")"
  rc=$?
  printf '%s|%s|%s' "$out" "$(cat "$err" 2>/dev/null)" "$rc"
}

check_delay() {  # <label> <expected> <args...>
  local label="$1" expected="$2"; shift 2
  local r v e rc
  r="$(rcd "$@")"; v="${r%%|*}"; rc="${r##*|}"; e="${r#*|}"; e="${e%|*}"
  if [[ -n "$e" ]]; then
    fail "$label: stderr present (arithmetic error?) -> [$e]"
  elif [[ ! "$v" =~ ^[0-9]+$ ]]; then
    fail "$label: non-integer output [$v]"
  elif [[ "$v" -ne "$expected" ]]; then
    fail "$label: got $v, want $expected"
  else
    pass "$label = $v"
  fi
}

# exponential with multiplier 1.5 (bc -> floats like 7.5, 11.25). truncate toward 0.
check_delay "exp mult=1.5 attempt=1 (5*1.5=7.5->7)"   7   1 exponential 5 300 1.5
check_delay "exp mult=1.5 attempt=2 (5*2.25=11.25->11)" 11 2 exponential 5 300 1.5
check_delay "exp mult=1.5 attempt=0 (5*1=5)"          5   0 exponential 5 300 1.5
# exponential default multiplier 2.0
check_delay "exp mult=2.0 attempt=3 (5*8=40)"         40  3 exponential 5 300 2.0
# max cap: 5 * 2^10 = 5120, capped to 300
check_delay "exp attempt=10 capped at max=300"        300 10 exponential 5 300 2.0
# fractional multiplier that yields a fraction < 1 increment but never crashes
check_delay "exp mult=1.25 attempt=4 (5*2.4414->12)"  12  4 exponential 5 300 1.25
# fixed / linear / default strategies unaffected by the float path
check_delay "fixed delay=7"                           7   3 fixed 7 300 2.0
check_delay "linear attempt=2 (5*(2+1)=15)"           15  2 linear 5 300 2.0
check_delay "linear attempt=0 (5*(0+1)=5)"            5   0 linear 5 300 2.0
check_delay "unknown strategy -> initial_delay"       5   4 weird 5 300 2.0
# linear cap still applies
check_delay "linear attempt=100 capped at max=50"     50  100 linear 5 50 2.0
echo

# =====================================================================
hr
printf 'routing e2e results: %s%d passed%s, %s%d failed%s\n' "$C_GREEN" "$PASS" "$C_NC" "$C_RED" "$FAIL" "$C_NC"
hr
[[ "$FAIL" -gt 0 ]] && exit 1
exit 0
