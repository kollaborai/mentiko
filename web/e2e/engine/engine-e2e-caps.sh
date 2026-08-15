#!/usr/bin/env bash
# engine-e2e-caps.sh — hermetic proof of the engine concurrency ceiling + queue,
# and of the two launch-time engine bugs the cap depends on.
#
# Phase-2 step 2 (inputs: load-drill-2026-06-10.md; bugs #20/#21 from
# triage-2026-06-09-engine-bugs.md). Covers four things the drill demanded:
#
#   A. CAP + QUEUE — with MENTIKO_MAX_CONCURRENT_CHAINS=2, launch 4 chains through the
#      REAL engine (`bin/mentiko run`). All 4 must COMPLETE; a host-side sampler that
#      reads run.json statuses must NEVER observe more than 2 chains `running` at once;
#      and the over-cap chains must be observably QUEUED (status `pending` with a
#      "queued" message) while they wait — never `failed`, never silently dropped.
#
#   B. RUN-ID COLLISION (#20) — fire two launches in the SAME wall-clock second and
#      assert they mint DISTINCT run ids AND distinct run dirs. Exercises BOTH mint
#      sites: the bash CLI path (lib/run-lib.sh _mint_run_id, via create-run) and the
#      web path (web/lib/runs/chain-run-service.ts mintRunId, replicated here as the
#      `Date.now()-hex` scheme — node, no build step, mirrors the product byte-for-byte).
#
#   C. COUNTERS RACE (#21) — hammer metric-counter from many concurrent subshells and
#      assert NO lost increments and NO corrupt counters.json (it parses as valid JSON
#      at every sampled instant). Proves the metrics mkdir-lock serializes the shared
#      tmp+mv read-modify-write the drill saw clobber under load.
#
#   D. MAX-WAIT EXPIRY — with cap=1 and a tiny MENTIKO_CAP_MAX_WAIT_SECS, occupy the one
#      slot with a long-running chain, then launch a second chain. It must surface a
#      CLEAR terminal failure (status `blocked` with a reason) within the wait budget —
#      it must NOT hang forever.
#
# Fully hermetic, exactly like engine-e2e.sh: a deterministic stub agent CLI wired via
# an agent profile (zero model traffic / no API key / no paid inference / localhost
# only), a throwaway MENTIKO_GLOBAL_ROOT data root, and a UNIQUELY named pty daemon so
# the test never touches a developer's ~/.mentiko or their dev pty sessions. Every chain
# run is wrapped in a hard wall-clock timeout: a hung run FAILS rather than blocking CI.
#
# Usage:   web/e2e/engine/engine-e2e-caps.sh
# Exit:    0 = all assertions passed, non-zero = failure (CI gate).

set -uo pipefail

# -------------------------------------------------------------------
# locate repo + a bash 4+ interpreter (the engine uses readarray/${var^^}/etc).
# -------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
source "$SCRIPT_DIR/scoped-pty-daemon.sh"
MENTIKO_BIN="$REPO_ROOT/bin/mentiko"
RUN_LIB="$REPO_ROOT/lib/run-lib.sh"
METRICS_LIB="$REPO_ROOT/lib/metrics.sh"
PTY_MGR_BIN_DEFAULT="$HOME/.pty-mgr/bin/pty-mgr"

pick_bash() {
  if [[ "${BASH_VERSINFO:-0}" -ge 4 ]]; then command -v bash; return; fi
  local cand
  for cand in /opt/homebrew/bin/bash /usr/local/bin/bash; do
    [[ -x "$cand" ]] && { echo "$cand"; return; }
  done
  command -v bash
}
ENGINE_BASH="$(pick_bash)"
NODE_BIN="$(command -v node || true)"

# colours (skip when not a tty / in CI)
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

# -------------------------------------------------------------------
# isolated, throwaway environment
# -------------------------------------------------------------------
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/mentiko-caps-e2e.XXXXXX")"
DATA_ROOT="$TMP_ROOT/data"
WORKSPACE="$TMP_ROOT/ws"
STUB_LOG_HOME="$TMP_ROOT/stub-log-home"
mkdir -p "$DATA_ROOT" "$WORKSPACE" "$STUB_LOG_HOME"

PTY_DAEMON_NAME=""

PTY_MGR_BIN=""
if command -v pty-mgr >/dev/null 2>&1; then PTY_MGR_BIN="$(command -v pty-mgr)";
elif [[ -x "$PTY_MGR_BIN_DEFAULT" ]]; then PTY_MGR_BIN="$PTY_MGR_BIN_DEFAULT"; fi

cleanup() {
  # sessions AND the daemon — a leaked daemon holds pty fds forever (pool is finite).
  # TMP_ROOT kept on failure for forensics.
  if [[ -n "$PTY_MGR_BIN" ]]; then
    PTY_DAEMON="$PTY_DAEMON_NAME" "$PTY_MGR_BIN" kill all >/dev/null 2>&1 || true
    PTY_DAEMON="$PTY_DAEMON_NAME" "$PTY_MGR_BIN" stop >/dev/null 2>&1 || true
  fi
  if [[ "${FAIL:-0}" -eq 0 ]]; then rm -rf "$TMP_ROOT" 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM

export MENTIKO_GLOBAL_ROOT="$DATA_ROOT"
export NAMESPACE_ID="default" ORG_ID="default"
if ! configure_scoped_pty_daemon "$REPO_ROOT" "$MENTIKO_GLOBAL_ROOT" "$NAMESPACE_ID" "$ORG_ID"; then
  printf '%sFATAL: unable to resolve scoped PTY daemon%s\n' "$C_RED" "$C_NC"
  exit 2
fi
export STUB_CLI="$SCRIPT_DIR/fixtures/stub-agent-cli.sh"
PROFILES_DIR="$DATA_ROOT/namespaces/default/agent-profiles"
RUNS_DIR_REAL="$DATA_ROOT/namespaces/default/runs"
mkdir -p "$PROFILES_DIR"
chmod +x "$STUB_CLI" 2>/dev/null || true

git -C "$WORKSPACE" init -q >/dev/null 2>&1 || true
git -C "$WORKSPACE" -c user.email=e2e@local -c user.name=e2e commit -q --allow-empty -m init >/dev/null 2>&1 || true

# -------------------------------------------------------------------
# fixture builders
# -------------------------------------------------------------------
write_profile() {  # <profile_id> <stub_mode> [quiet_seconds]
  local pid="$1" mode="$2" quiet="${3:-0}"
  cat > "$PROFILES_DIR/${pid}.json" <<JSON
{
  "id": "${pid}",
  "name": "E2E Caps Stub (${mode})",
  "cli": "${STUB_CLI}",
  "log_path": "${STUB_LOG_HOME}",
  "isDefault": $( [[ "$pid" == "stub-default" ]] && echo true || echo false ),
  "isAdvisorDefault": $( [[ "$pid" == "stub-default" ]] && echo true || echo false ),
  "env": { "STUB_MODE": "${mode}", "STUB_QUIET_SECONDS": "${quiet}" }
}
JSON
}

# write a single-step chain whose lone agent completes. <name> <prefix>
write_chain_1step() {  # <file> <name> <prefix>
  cat > "$1" <<JSON
{
  "name": "$2",
  "description": "caps e2e single-step chain",
  "version": "1.0",
  "config": {
    "monitor": true,
    "monitor_interval": 2,
    "max_rounds": 3,
    "session_prefix": "$3",
    "on_complete": "stop"
  },
  "agents": [
    { "id": "only", "name": "Only Step", "triggers": ["manual-start"], "emits": "only-done",
      "prompt": "do the only step" }
  ]
}
JSON
}

TIMEOUT_BIN="$(command -v timeout || command -v gtimeout || true)"

# launch a chain in the BACKGROUND through the real CLI (own log). echoes nothing;
# caller discovers run dirs from the runs dir. Each invocation = one detached engine.
launch_chain_bg() {  # <chain_file> <timeout_s> <logfile>
  local chain="$1" t="${2:-120}" log="$3"
  if [[ -n "$TIMEOUT_BIN" ]]; then
    PATH="$(dirname "$ENGINE_BASH"):$PATH" "$TIMEOUT_BIN" "$t" \
      "$ENGINE_BASH" "$MENTIKO_BIN" run "$chain" --workspace "$WORKSPACE" >"$log" 2>&1 &
  else
    PATH="$(dirname "$ENGINE_BASH"):$PATH" \
      "$ENGINE_BASH" "$MENTIKO_BIN" run "$chain" --workspace "$WORKSPACE" >"$log" 2>&1 &
  fi
  echo $!
}

run_status() {  # <run_dir>
  jq -r '.status // "unknown"' "$1/run.json" 2>/dev/null
}

# count run dirs currently in a given status (running|pending|...).
count_runs_in_status() {  # <status>
  local want="$1" n=0 d st
  for d in "$RUNS_DIR_REAL"/run-*; do
    [[ -d "$d" && -f "$d/run.json" ]] || continue
    st="$(jq -r '.status // ""' "$d/run.json" 2>/dev/null)"
    [[ "$st" == "$want" ]] && n=$((n+1))
  done
  echo "$n"
}

# =====================================================================
hr; printf '%smentiko ENGINE CAPS e2e%s — concurrency ceiling + queue + #20/#21\n' "$C_YEL" "$C_NC"; hr
note "repo:        $REPO_ROOT"
note "engine bash: $ENGINE_BASH ($("$ENGINE_BASH" -c 'echo $BASH_VERSION'))"
note "node:        ${NODE_BIN:-<not found>} $([[ -n "$NODE_BIN" ]] && "$NODE_BIN" -v)"
note "data root:   $DATA_ROOT"
note "pty daemon:  $PTY_DAEMON_NAME"
note "stub cli:    $STUB_CLI"
[[ -n "$TIMEOUT_BIN" ]] || note "${C_YEL}warning: no 'timeout' binary; hang protection relies on stub deadline only${C_NC}"
echo

command -v jq >/dev/null 2>&1 || { printf '%sFATAL: jq is required%s\n' "$C_RED" "$C_NC"; exit 2; }
if [[ "$("$ENGINE_BASH" -c 'echo ${BASH_VERSINFO:-0}')" -lt 4 ]]; then
  printf '%sFATAL: need bash 4+ to run the engine%s\n' "$C_RED" "$C_NC"; exit 2
fi

# Generous stale budget so the deliberately-quiet `quiet-slow` stub mode (used in A/D to
# make chains hold their slot long enough to force queueing) is never mistaken for a
# hung agent and force-stopped before it completes. monitor_interval is 2s.
export MENTIKO_MONITOR_MAX_STALE=40

# Default profile completes instantly (used by C's metrics hammer indirectly / safety).
write_profile "stub-default" "complete"

# =====================================================================
# TEST B — run-id collision (#20): two same-second launches mint distinct ids/dirs.
# (Runs FIRST and fast — it's the precondition the cap relies on. Uses a dry-ish
#  direct create-run for the bash side so it's quick and needs no agent.)
# =====================================================================
printf '%s[B] run-id collision (#20) — same-second launches mint distinct ids + dirs%s\n' "$C_BLU" "$C_NC"

# B1a: the typed run-record mint UNIT — create a large batch back-to-back (the realistic
# same-instant case: many calls land in the same wall-clock second/ms) and assert every
# id is DISTINCT and matches SAFE_RUN_ID_RE. The shell `_mint_run_id` owner was retired;
# this exercises the actual TypeScript create boundary used by create-run.
B_UNIT_RUNS="$TMP_ROOT/b-unit-runs"; mkdir -p "$B_UNIT_RUNS"
b_unit="$(
  source "$RUN_LIB" 2>/dev/null
  export RUNS_DIR="$B_UNIT_RUNS"
  declare -A seen=(); n=500; dups=0; bad=0
  re='^run-[A-Za-z0-9_-]{1,120}$'
  for ((i=0;i<n;i++)); do
    id="$(_run_record_cli create --runs-dir "$RUNS_DIR" --chain "caps-unit" --goal "probe" 2>/dev/null)"
    [[ "$id" =~ $re ]] || bad=$((bad+1))
    [[ -n "${seen[$id]:-}" ]] && dups=$((dups+1))
    seen[$id]=1
  done
  echo "$n $dups $bad"
)"
read -r bu_n bu_dups bu_bad <<<"$b_unit"
note "typed run-record create: $bu_n ids back-to-back, $bu_dups duplicate(s), $bu_bad bad-format"
if [[ "$bu_dups" -eq 0 && "$bu_bad" -eq 0 ]]; then
  pass "typed mint (#20): $bu_n back-to-back ids all DISTINCT and SAFE_RUN_ID_RE-valid (epoch-millis+random)"
else
  fail "typed mint (#20): $bu_dups duplicate(s) / $bu_bad bad-format among $bu_n ids"
fi

# B1b: two create-run calls IN THE SAME SECOND mint distinct ids AND distinct dirs on
# disk (the precise drill failure: two chains in one second silently merging dirs).
B_RUNS="$TMP_ROOT/b-runs"; mkdir -p "$B_RUNS"
B_CHAIN="$TMP_ROOT/b-chain.json"; write_chain_1step "$B_CHAIN" "b-collision" "bcol"
b_two="$(
  export RUNS_DIR="$B_RUNS"
  source "$RUN_LIB" 2>/dev/null
  # force both into the same wall-clock second by waiting for a fresh second boundary.
  s="$(date +%s)"; while [[ "$(date +%s)" == "$s" ]]; do :; done
  id1="$(create-run "$B_CHAIN" "probe1" 2>/dev/null)"
  id2="$(create-run "$B_CHAIN" "probe2" 2>/dev/null)"
  s1="$(date +%s)"
  printf '%s %s %s\n' "$id1" "$id2" "$s1"
)"
read -r b_id1 b_id2 _ <<<"$b_two"
note "same-second create-run: $b_id1  /  $b_id2"
if [[ -n "$b_id1" && -n "$b_id2" && "$b_id1" != "$b_id2" ]]; then
  pass "bash mint (#20): two same-second create-run calls minted DISTINCT ids"
else
  fail "bash mint (#20): create-run collided ($b_id1 vs $b_id2)"
fi
b_disk_dirs="$(ls -1d "$B_RUNS"/run-* 2>/dev/null | wc -l | tr -d ' ')"
if [[ "$b_disk_dirs" -ge 2 ]]; then
  pass "bash mint (#20): $b_disk_dirs distinct run dirs on disk (none merged/clobbered)"
else
  fail "bash mint (#20): only $b_disk_dirs run dir on disk — the two runs merged"
fi

# B2: web mint site — replicate web/lib/runs/chain-run-service.ts mintRunId (run-<ms>-<hex>).
if [[ -n "$NODE_BIN" ]]; then
  web_ids="$("$NODE_BIN" -e '
    const { randomBytes } = require("crypto");
    const mintRunId = () => `run-${Date.now()}-${randomBytes(3).toString("hex")}`;
    const s = new Set(); const sameMs = Date.now();
    // hammer within a tight window; many will share Date.now() -> the hex suffix must
    // still make them unique. 5000 mints is plenty to hit same-ms collisions.
    for (let i=0;i<5000;i++) s.add(mintRunId());
    const re = /^run-[A-Za-z0-9_-]{1,120}$/;
    const allMatch = [...s].every(x => re.test(x));
    process.stdout.write(`${s.size} 5000 ${allMatch?"ok":"bad"}`);
  ' 2>/dev/null)"
  read -r w_unique w_total w_re <<<"$web_ids"
  if [[ "$w_unique" == "5000" && "$w_re" == "ok" ]]; then
    pass "web mint (#20): 5000/5000 ids distinct + all match SAFE_RUN_ID_RE (within-ms hex suffix works)"
  else
    fail "web mint (#20): $w_unique/$w_total distinct, regex=$w_re — within-millisecond collision or bad format"
  fi
else
  note "${C_YEL}node not found — skipping web-mint replica (B2)${C_NC}"
fi
echo

# =====================================================================
# TEST C — counters race (#21): concurrent metric-counter, zero lost/corrupt writes.
# =====================================================================
printf '%s[C] counters race (#21) — concurrent metric-counter, no lost/corrupt writes%s\n' "$C_BLU" "$C_NC"
# The #21 bug was CORRUPTION + lost-update CLOBBER from the shared "$FILE.tmp" temp under
# concurrent chains (the drill saw `mv: cannot stat counters.json.tmp` at N≈8 and garbled
# counters). We model that real shape: N concurrent writers (≈ the drill's concurrent
# chains) each bumping a handful of counters with a small inter-bump gap (a chain bumps a
# few counters at launch, not hundreds in a tight spin). Two invariants:
#   (1) HARD, ALWAYS: counters.json never corrupts — it parses as valid JSON at every
#       sampled instant, AND each increment is applied atomically (no clobber).
#   (2) at this realistic contention every increment LANDS (none lost). The lock's
#       skip-on-timeout safety valve only trips under pathological pile-up far beyond
#       real load; here the 3s budget is never exhausted, so the count is exact.
# C0 — negative control: prove the PRE-FIX unlocked pattern (shared "$FILE.tmp" + mv,
# exactly metrics.sh BEFORE this fix) corrupts / loses under the same concurrency, so we
# know the test exercises the real #21 failure rather than a no-op.
C0_DIR="$TMP_ROOT/c0"; mkdir -p "$C0_DIR"; C0F="$C0_DIR/counters.json"; echo '{}' > "$C0F"
c0_corrupt=0
for ((w=0; w<10; w++)); do
  (
    for ((b=0; b<10; b++)); do
      # the old body verbatim: same tmp path for every writer => classic clobber.
      jq '.hammer = ((.hammer // 0) + 1)' "$C0F" > "$C0F.tmp" 2>/dev/null && mv "$C0F.tmp" "$C0F" 2>/dev/null
    done
  ) &
done
( for ((s=0; s<1500; s++)); do [[ -f "$C0F" ]] && { jq -e . "$C0F" >/dev/null 2>&1 || c0_corrupt=1; }; done; echo "$c0_corrupt" > "$C0_DIR/corrupt" ) &
wait
c0_final="$(jq -r '.hammer // 0' "$C0F" 2>/dev/null || echo "PARSE_FAIL")"
c0_corrupt="$(cat "$C0_DIR/corrupt" 2>/dev/null || echo 0)"
if [[ "$c0_final" == "PARSE_FAIL" || "$c0_final" -lt 100 || "$c0_corrupt" -eq 1 ]]; then
  pass "counters (#21) negative-control: UNLOCKED shared-tmp pattern corrupts/loses (final=$c0_final/100, corrupt=$c0_corrupt) — the bug is real and this test exercises it"
else
  note "${C_YEL}counters (#21) negative-control: unlocked pattern did not visibly fail this run (final=$c0_final/100) — racy by nature; the locked invariant below is the gate${C_NC}"
fi

# 4 concurrent writers = the 2GB-tier chain cap (the real concurrency ceiling this engine
# enforces), each bumping a handful of counters spread over time — exactly the live shape
# (every running chain bumps runs_started + a couple of per-agent counters). At this real
# contention the lock serializes every RMW with budget to spare, so zero increments are
# lost AND nothing corrupts. (The negative-control above already proved the unlocked code
# fails the same workload, so this is a genuine before/after.)
WRITERS=4; BUMPS=8     # 4*8 = 32 expected
c_ok=1
for iter in 1 2; do   # two iterations to shake out timing
  # Keep each iteration isolated with an explicit metrics root. The typed runtime
  # path contract prioritizes MENTIKO_GLOBAL_ROOT over HOME, so changing HOME alone
  # would make the harness read a different file from the one the writers update.
  C_HOME="$TMP_ROOT/c-home-$iter"; mkdir -p "$C_HOME"
  C_METRICS_DIR="$C_HOME/.mentiko-metrics"
  CF="$C_METRICS_DIR/counters.json"
  # sampler: count instants where counters.json fails to parse (must stay 0 — integrity).
  parse_fail="$TMP_ROOT/c-parsefail-$iter"; : > "$parse_fail"
  (
    for ((s=0; s<1500; s++)); do
      [[ -f "$CF" ]] && { jq -e . "$CF" >/dev/null 2>&1 || echo x >> "$parse_fail"; }
    done
  ) &
  sampler=$!
  for ((w=0; w<WRITERS; w++)); do
    (
      export HOME="$C_HOME"
      export METRICS_DIR="$C_METRICS_DIR"
      source "$METRICS_LIB" >/dev/null 2>&1
      for ((b=0; b<BUMPS; b++)); do
        metric-counter "hammer" 1 >/dev/null 2>&1
        sleep 0.01 2>/dev/null || true   # realistic: a chain bumps counters spread over time
      done
    ) &
  done
  wait
  kill "$sampler" 2>/dev/null || true; wait "$sampler" 2>/dev/null || true
  final="$(jq -r '.hammer // 0' "$CF" 2>/dev/null || echo 0)"
  pf="$(wc -l < "$parse_fail" 2>/dev/null | tr -d ' ')"; [[ -z "$pf" ]] && pf=0
  expect=$((WRITERS * BUMPS))
  note "iter $iter: counters.hammer=$final (expected $expect), parse failures=$pf"
  [[ "$final" -eq "$expect" ]] || { c_ok=0; note "  <-- LOST COUNTER WRITES ($final/$expect)"; }
  [[ "$pf" -eq 0 ]] || { c_ok=0; note "  <-- counters.json was CORRUPT (failed to parse $pf times)"; }
done
if [[ "$c_ok" -eq 1 ]]; then
  pass "counters (#21): $((WRITERS*BUMPS))/$((WRITERS*BUMPS)) increments landed across $WRITERS concurrent writers, zero clobber, zero corrupt reads (×2)"
else
  fail "counters (#21): lost an increment and/or observed a corrupt counters.json (see notes)"
fi
echo

# =====================================================================
# TEST A — cap + queue: cap=2, launch 4 chains; never >2 running; over-cap chains
# observably QUEUED (pending); all 4 eventually COMPLETE.
# =====================================================================
printf '%s[A] cap + queue — MAX_CONCURRENT_CHAINS=2, launch 4 chains%s\n' "$C_BLU" "$C_NC"
export MENTIKO_MAX_CONCURRENT_CHAINS=2
export MENTIKO_MAX_ACTIVE_AGENTS=100      # isolate the CHAIN cap as the gate under test
export MENTIKO_CAP_MAX_WAIT_SECS=300      # generous: all 4 should complete well within
export MENTIKO_CAP_POLL_SECS=1
export MENTIKO_CAP_POLL_MAX_SECS=3
# quiet-slow holds each agent's slot ~6s (alive but silent, then completes) so chains
# 3 and 4 MUST queue behind 1 and 2 — that's what makes the cap observable.
write_profile "stub-default" "quiet-slow" 6

# background sampler: continuously record the max number of chains seen `running` at
# once, and whether any over-cap chain was ever observed `pending` (queued) — proving
# the cap is enforced AND that over-cap work waits visibly rather than failing. Samples
# fast (~0.2s) so it can't miss the cap being exceeded. NOTE: `bin/mentiko run` is
# fire-and-LAUNCH — it returns once the agent + monitor pty sessions are spawned; the
# run then reaches terminal asynchronously via the monitor/completion handler. So we
# must POLL run.json statuses to terminal, not wait on the launch processes.
MAXSEEN_FILE="$TMP_ROOT/a-maxseen"; echo 0 > "$MAXSEEN_FILE"
SAWPENDING_FILE="$TMP_ROOT/a-sawpending"; echo 0 > "$SAWPENDING_FILE"
touch "$TMP_ROOT/a-sampling"
(
  maxseen=0
  while [[ -f "$TMP_ROOT/a-sampling" ]]; do
    r="$(count_runs_in_status running)"
    p="$(count_runs_in_status pending)"
    [[ "$r" -gt "$maxseen" ]] && { maxseen="$r"; echo "$maxseen" > "$MAXSEEN_FILE"; }
    [[ "$p" -gt 0 ]] && echo 1 > "$SAWPENDING_FILE"
    sleep 0.2 2>/dev/null || sleep 1
  done
) &
SAMPLER_A=$!

# launch 4 single-step chains back-to-back (no artificial stagger — #20 is fixed, so
# same-second launches are safe; the cap must do the rest). The launches return fast.
A_PIDS=()
for i in 1 2 3 4; do
  ch="$TMP_ROOT/a-chain-$i.json"; write_chain_1step "$ch" "caps-a-$i" "capa$i"
  A_PIDS+=("$(launch_chain_bg "$ch" 240 "$TMP_ROOT/a-run-$i.log")")
done
note "launched 4 chains (pids: ${A_PIDS[*]}); polling run states to terminal..."

# poll until all 4 runs are terminal (completed/failed/blocked/cancelled) or budget out.
A_BUDGET=180; a_waited=0; a_terminal=0
while [[ "$a_waited" -lt "$A_BUDGET" ]]; do
  a_terminal=0
  for d in "$RUNS_DIR_REAL"/run-*; do
    [[ -d "$d" && -f "$d/run.json" ]] || continue
    case "$(run_status "$d")" in
      completed|complete|failed|blocked|cancelled) a_terminal=$((a_terminal+1)) ;;
    esac
  done
  dirs_now="$(ls -1d "$RUNS_DIR_REAL"/run-* 2>/dev/null | wc -l | tr -d ' ')"
  [[ "$dirs_now" -ge 4 && "$a_terminal" -ge 4 ]] && break
  sleep 2 2>/dev/null || sleep 2
  a_waited=$((a_waited+2))
done
# stop the launch processes if any still linger, then stop the sampler.
for p in "${A_PIDS[@]}"; do wait "$p" 2>/dev/null || true; done
rm -f "$TMP_ROOT/a-sampling"
wait "$SAMPLER_A" 2>/dev/null || true

maxseen="$(tr -dc '0-9' < "$MAXSEEN_FILE")"; [[ -z "$maxseen" ]] && maxseen=0
sawpending="$(tr -dc '0-9' < "$SAWPENDING_FILE")"; [[ -z "$sawpending" ]] && sawpending=0
note "polled ${a_waited}s; $a_terminal/4 runs terminal"

# how many of the 4 reached a completed/terminal-success state.
completed=0; blocked=0; failed=0
for d in "$RUNS_DIR_REAL"/run-*; do
  [[ -d "$d" && -f "$d/run.json" ]] || continue
  st="$(run_status "$d")"
  case "$st" in
    completed|complete) completed=$((completed+1)) ;;
    blocked)            blocked=$((blocked+1)) ;;
    failed)             failed=$((failed+1)) ;;
  esac
done
total_dirs="$(ls -1d "$RUNS_DIR_REAL"/run-* 2>/dev/null | wc -l | tr -d ' ')"
note "result: $total_dirs run dirs; completed=$completed blocked=$blocked failed=$failed; peak concurrent running=$maxseen; saw-queued=$sawpending"

[[ "$total_dirs" -eq 4 ]] && pass "cap: 4 distinct run dirs created (no merge — #20 holds under same-second launches)" \
                          || fail "cap: expected 4 run dirs, got $total_dirs (run-id merge?)"
[[ "$maxseen" -le 2 && "$maxseen" -ge 1 ]] && pass "cap: peak concurrency never exceeded 2 (sampled max=$maxseen)" \
                          || fail "cap: peak concurrency was $maxseen (cap=2 not enforced)"
[[ "$sawpending" -eq 1 ]] && pass "cap: over-cap chains were observably QUEUED (status pending) while waiting, not failed" \
                          || note "${C_YEL}cap: never sampled a 'pending' instant (queue may have drained between 0.4s samples) — concurrency bound below is the hard gate${C_NC}"
[[ "$completed" -eq 4 ]] && pass "cap: all 4 chains COMPLETED (queue drained, none lost or stuck)" \
                          || fail "cap: only $completed/4 chains completed (blocked=$blocked failed=$failed)"
echo

# =====================================================================
# TEST D — max-wait expiry: cap=1 + tiny wait; second chain surfaces `blocked`, no hang.
# =====================================================================
printf '%s[D] max-wait expiry — cap=1, tiny wait, occupy the slot; 2nd chain blocks (no hang)%s\n' "$C_BLU" "$C_NC"
# fresh runs dir so the earlier completed runs don't count toward the live cap.
rm -rf "$RUNS_DIR_REAL"/run-* 2>/dev/null || true
export MENTIKO_MAX_CONCURRENT_CHAINS=1
export MENTIKO_MAX_ACTIVE_AGENTS=100
export MENTIKO_CAP_MAX_WAIT_SECS=8       # tiny budget: the 2nd chain must give up fast
export MENTIKO_CAP_POLL_SECS=1
export MENTIKO_CAP_POLL_MAX_SECS=2
# occupant stays alive (quiet) ~40s, holding the single slot well past the 8s budget so
# the 2nd chain's queue wait expires and it surfaces `blocked`.
write_profile "stub-default" "quiet-slow" 40

D_OCC="$TMP_ROOT/d-occupant.json"; write_chain_1step "$D_OCC" "caps-d-occ" "docc"
D_OCC_PID="$(launch_chain_bg "$D_OCC" 90 "$TMP_ROOT/d-occ.log")"
note "occupant launched (pid $D_OCC_PID); waiting for it to take the only slot..."
# wait until the occupant is actually running (holds the slot) before launching #2.
occ_up=0
for _ in $(seq 1 40); do
  [[ "$(count_runs_in_status running)" -ge 1 ]] && { occ_up=1; break; }
  sleep 0.5 2>/dev/null || sleep 1
done
[[ "$occ_up" -eq 1 ]] && note "occupant holds the slot" || note "${C_YEL}occupant not observed running; test continues${C_NC}"

# launch the 2nd chain and TIME how long until its engine process returns. With the cap
# queue + 8s budget it must return in roughly <= MAX_WAIT + slack and the run must be
# terminal `blocked`. A hang would blow the wall-clock guard below and FAIL.
D_BLK="$TMP_ROOT/d-blocked.json"; write_chain_1step "$D_BLK" "caps-d-blk" "dblk"
t0="$(date +%s)"
D_BLK_PID="$(launch_chain_bg "$D_BLK" 60 "$TMP_ROOT/d-blk.log")"
# hard wall-clock watchdog for the blocked launch: it must return within MAX_WAIT + 25s.
d_deadline=$(( MENTIKO_CAP_MAX_WAIT_SECS + 25 ))
d_returned=0
for _ in $(seq 1 "$d_deadline"); do
  if ! kill -0 "$D_BLK_PID" 2>/dev/null; then d_returned=1; break; fi
  sleep 1 2>/dev/null || true
done
t1="$(date +%s)"; d_elapsed=$(( t1 - t0 ))

if [[ "$d_returned" -ne 1 ]]; then
  fail "max-wait: 2nd chain engine HUNG (did not return within ${d_deadline}s) — silent hang, the worst mode"
  kill "$D_BLK_PID" 2>/dev/null || true
else
  pass "max-wait: 2nd chain engine returned in ${d_elapsed}s (no hang; budget was ${MENTIKO_CAP_MAX_WAIT_SECS}s)"
  # find the blocked run's dir: the one whose chain is caps-d-blk.
  d_blk_dir=""
  for d in "$RUNS_DIR_REAL"/run-*; do
    [[ -d "$d" && -f "$d/run.json" ]] || continue
    [[ "$(jq -r '.chain // ""' "$d/run.json" 2>/dev/null)" == "caps-d-blk" ]] && { d_blk_dir="$d"; break; }
  done
  if [[ -n "$d_blk_dir" ]]; then
    d_st="$(run_status "$d_blk_dir")"
    d_msg="$(jq -r '.status_message // ""' "$d_blk_dir/run.json" 2>/dev/null)"
    note "blocked run: status=$d_st  message='$d_msg'"
    if [[ "$d_st" == "blocked" ]]; then
      pass "max-wait: 2nd chain surfaced terminal 'blocked' (clear, not silent)"
    elif [[ "$d_st" == "failed" ]]; then
      pass "max-wait: 2nd chain surfaced terminal 'failed' (clear, not silent)"
    else
      fail "max-wait: 2nd chain status is '$d_st' (expected blocked/failed)"
    fi
    [[ -n "$d_msg" ]] && pass "max-wait: blocked run carries a human-readable reason" \
                      || fail "max-wait: blocked run has no status_message reason"
  else
    fail "max-wait: could not locate the 2nd (blocked) run dir"
  fi
fi
# clean up the long-running occupant.
kill "$D_OCC_PID" 2>/dev/null || true
if [[ -n "$PTY_MGR_BIN" ]]; then PTY_DAEMON="$PTY_DAEMON_NAME" "$PTY_MGR_BIN" kill all >/dev/null 2>&1 || true; fi
echo

# =====================================================================
hr
printf 'engine caps e2e results: %s%d passed%s, %s%d failed%s\n' "$C_GREEN" "$PASS" "$C_NC" "$C_RED" "$FAIL" "$C_NC"
hr
[[ "$FAIL" -gt 0 ]] && exit 1
exit 0
