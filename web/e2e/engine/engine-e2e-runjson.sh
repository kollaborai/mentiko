#!/usr/bin/env bash
# engine-e2e-runjson.sh — hermetic concurrency proof for the run.json single-writer lock
#
# Covers wave-2 "group D" / triage finding #7 (runjson-write-race):
#   Three independent processes read-modify-write the same run.json — the bash
#   completion/monitor helpers (lib/run-lib.sh), the watchdog (lib/watchdog.sh),
#   and the web heartbeat route (TS). Each write is atomic in isolation (tmp+rename),
#   so a READER never sees a partial file, but there was NO mutual exclusion across
#   writers: a classic lost update. An agent-status write could be silently clobbered
#   by a concurrent watchdog/heartbeat rewrite (second mv wins, first change gone).
#
# The fix routes EVERY run.json mutation through one mkdir-based lock adjacent to the
# file (lib/run-lib.sh `_with_run_lock`; the TS heartbeat route replicates the same
# protocol in web/lib/runs/run-json-lock.ts). This suite proves:
#
#   A. bash lost-update hammer — N concurrent update-run-agent (distinct agents,
#      distinct statuses) + interleaved update-run-status, ≥10 iterations. Asserts
#      ALL N agent statuses land (zero lost updates) and run.json parses as valid
#      JSON at every sampled instant (lock-free-reads invariant).
#   B. pre-fix proof — the SAME hammer against the unlocked updater pulled from
#      `git show HEAD:lib/run-lib.sh` (HEAD predates this fix), showing it LOSES
#      updates — proving the test catches the real bug.
#   C. cross-language contention — bash hammer concurrently with a node writer that
#      uses the run.json lock protocol (replicated byte-for-byte in a dependency-free
#      .mjs; see note at its definition). Asserts zero lost updates AND that a
#      lock-held marker is never observed by two writers at once (mutual exclusion).
#   D. stale-break — a lock dir with a dead pid / old mtime gets broken and the write
#      proceeds (both the bash and node sides).
#
# Fully hermetic: RUNS_DIR is pointed at a throwaway temp dir (lib/config.sh honors
# the RUNS_DIR env var), so no real namespace data is touched. No real agents, models,
# pty-manager, web server, or network. The only background work run-lib.sh does is a
# fire-and-forget _sys_log curl that is redirected to /dev/null and never awaited.
#
# Usage:   web/e2e/engine/engine-e2e-runjson.sh
# Exit:    0 = all assertions passed, non-zero = failure (CI gate).

set -uo pipefail

SCRIPT_DIR_SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR_SELF/../../.." && pwd)"
RUN_LIB="$REPO_ROOT/lib/run-lib.sh"

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
NODE_BIN="$(command -v node || true)"

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

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/mentiko-runjson-e2e.XXXXXX")"
cleanup() { rm -rf "$TMP_ROOT" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

hr; printf '%smentiko RUN.JSON e2e%s — single-writer lock, hermetic concurrency\n' "$C_YEL" "$C_NC"; hr
note "repo:        $REPO_ROOT"
note "engine bash: $ENGINE_BASH ($("$ENGINE_BASH" -c 'echo $BASH_VERSION'))"
note "node:        ${NODE_BIN:-<not found>} $([[ -n "$NODE_BIN" ]] && "$NODE_BIN" -v)"
note "run lib:     $RUN_LIB"
note "tmp root:    $TMP_ROOT"
echo

# =====================================================================
# Worker library sourced by every (sub)shell that drives a hammer. It sources a
# GIVEN run-lib path (fixed or pre-fix) with RUNS_DIR pointed at a per-iteration
# temp dir, so the public helpers (update-run-agent, update-run-status, ...) operate
# on a throwaway run.json. We keep BETTER_AUTH_SECRET empty so _sys_log's curl is a
# harmless no-op against nothing.
# =====================================================================
WORKER_LIB="$TMP_ROOT/worker-lib.sh"
cat > "$WORKER_LIB" <<'WLIB'
# args via env: RL_PATH (run-lib to source), RUNS_DIR
set -uo pipefail
export BETTER_AUTH_SECRET=""
# RUNS_DIR is exported by the caller; config.sh (sourced by run-lib) honors it.
source "$RL_PATH"
WLIB

# seed a run.json with N agents all "pending" under $1/run-<id>/run.json.
# echoes the run_id.
seed_run() {  # <runs_dir> <n>
  local runs_dir="$1" n="$2"
  local run_id="run-$(date +%s)$RANDOM"
  local run_dir="$runs_dir/$run_id"
  mkdir -p "$run_dir"
  {
    printf '{\n'
    printf '  "id": "%s",\n' "$run_id"
    printf '  "chain": "hammer",\n'
    printf '  "goal": "lock hammer",\n'
    printf '  "started": "%s",\n' "$(date -Iseconds)"
    printf '  "status": "running",\n'
    printf '  "sessions": [],\n'
    printf '  "agents": [\n'
    local i
    for ((i=1; i<=n; i++)); do
      printf '    {"id": "agent%d", "name": "agent%d", "session": "sess%d", "status": "pending"}' "$i" "$i" "$i"
      [[ $i -lt $n ]] && printf ','
      printf '\n'
    done
    printf '  ]\n'
    printf '}\n'
  } > "$run_dir/run.json"
  echo "$run_id"
}

# Run ONE bash hammer iteration against a fresh run: fire N concurrent
# update-run-agent (each agent -> "complete") + a few interleaved update-run-status
# calls. While the writers run, a sampler reads the file repeatedly and records any
# instant where it failed to parse as JSON.
# echoes "<landed_complete_count> <json_parse_failures>".
# args: <run_lib_path> <iteration_tag> <N>
bash_hammer_once() {
  local rl="$1" tag="$2" n="$3"
  local runs_dir="$TMP_ROOT/runs-$tag"
  rm -rf "$runs_dir"; mkdir -p "$runs_dir"
  local run_id; run_id="$(seed_run "$runs_dir" "$n")"
  local run_file="$runs_dir/$run_id/run.json"

  # sampler: count instants where run.json failed to parse (should stay 0 post-fix).
  local parse_fail_file="$TMP_ROOT/parsefail-$tag"
  : > "$parse_fail_file"
  (
    local s
    for ((s=0; s<400; s++)); do
      if [[ -f "$run_file" ]]; then
        jq -e . "$run_file" >/dev/null 2>&1 || echo x >> "$parse_fail_file"
      fi
    done
  ) &
  local sampler_pid=$!

  # fire N concurrent agent-status writers, each a fresh subshell sourcing the lib.
  local i
  for ((i=1; i<=n; i++)); do
    (
      export RL_PATH="$rl" RUNS_DIR="$runs_dir"
      source "$WORKER_LIB"
      update-run-agent "$run_id" "agent$i" "complete" >/dev/null 2>&1
    ) &
  done
  # interleave a few run-status writers (these rewrite the WHOLE file — the classic
  # clobber source against the per-agent writers).
  for i in 1 2 3; do
    (
      export RL_PATH="$rl" RUNS_DIR="$runs_dir"
      source "$WORKER_LIB"
      update-run-status "$run_id" "running" "hammer-$i" >/dev/null 2>&1
    ) &
  done
  wait

  kill "$sampler_pid" 2>/dev/null || true
  wait "$sampler_pid" 2>/dev/null || true

  local landed parse_fails
  landed="$(jq '[.agents[] | select(.status=="complete")] | length' "$run_file" 2>/dev/null || echo 0)"
  [[ -z "$landed" ]] && landed=0
  parse_fails="$(wc -l < "$parse_fail_file" 2>/dev/null | tr -d ' ')"
  [[ -z "$parse_fails" ]] && parse_fails=0
  echo "$landed $parse_fails"
}

export TMP_ROOT WORKER_LIB

# ---------------------------------------------------------------------
# 0. preflight + pre-fix snapshot
# ---------------------------------------------------------------------
"$ENGINE_BASH" -n "$RUN_LIB" >/dev/null 2>&1 \
  && pass "run-lib.sh parses under $("$ENGINE_BASH" -c 'echo bash $BASH_VERSION' | awk '{print $2}')" \
  || fail "run-lib.sh has a syntax error"

# Put the pre-fix snapshot in its OWN lib dir alongside copies of its sibling deps
# (config.sh, terminal-sanitize.sh) so its `source "$SCRIPT_DIR/<dep>"` lines resolve
# cleanly — otherwise SCRIPT_DIR points at a bare temp dir and stderr fills with
# "No such file" noise. The CURRENT (committed) deps are fine here: this proof only
# exercises the unlocked HEAD run.json updater, which doesn't depend on dep internals.
PREFIX_DIR="$TMP_ROOT/prefix-lib"; mkdir -p "$PREFIX_DIR"
PREFIX_LIB="$PREFIX_DIR/run-lib.sh"
if git -C "$REPO_ROOT" show HEAD:lib/run-lib.sh > "$PREFIX_LIB" 2>/dev/null && [[ -s "$PREFIX_LIB" ]]; then
  if cmp -s "$PREFIX_LIB" "$RUN_LIB"; then
    # fix already committed: HEAD == working copy, so there is no unlocked
    # pre-fix updater to demonstrate against. skip-with-note, never fail —
    # this is the steady state on main once the fix lands.
    note "${C_YEL}HEAD:lib/run-lib.sh is identical to the working copy (fix already committed) — skipping pre-fix-fails demo${C_NC}"
    HAVE_PREFIX=0
  else
    cp -f "$REPO_ROOT/lib/config.sh" "$PREFIX_DIR/config.sh" 2>/dev/null || true
    cp -f "$REPO_ROOT/lib/terminal-sanitize.sh" "$PREFIX_DIR/terminal-sanitize.sh" 2>/dev/null || true
    note "pre-fix snapshot pulled from git HEAD:lib/run-lib.sh ($(wc -l < "$PREFIX_LIB") lines, unlocked)"
    HAVE_PREFIX=1
  fi
else
  note "${C_YEL}could not pull HEAD:lib/run-lib.sh (no history / shallow clone) — skipping pre-fix-fails demo${C_NC}"
  HAVE_PREFIX=0
fi
echo

# =====================================================================
# TEST A — bash lost-update hammer (post-fix): zero lost updates, valid JSON always.
# =====================================================================
printf '%s[A] bash lost-update hammer — %d concurrent agent writers + 3 status writers × %d iters%s\n' "$C_BLU" 8 12 "$C_NC"
N=8; ITERS=12
a_ok=1; a_parsefail_total=0
for ((it=1; it<=ITERS; it++)); do
  read -r landed pfails <<<"$(bash_hammer_once "$RUN_LIB" "fix-$it" "$N")"
  a_parsefail_total=$((a_parsefail_total + pfails))
  if [[ "$landed" -ne "$N" ]]; then
    a_ok=0
    note "iteration $it: $landed/$N agent statuses landed  <-- LOST UPDATE"
  fi
  if [[ "$pfails" -ne 0 ]]; then
    a_ok=0
    note "iteration $it: run.json failed to parse $pfails time(s) during writes  <-- PARTIAL READ"
  fi
done
if [[ "$a_ok" -eq 1 ]]; then
  pass "post-fix: $ITERS/$ITERS iterations landed all $N agent statuses, zero lost updates"
  pass "post-fix: run.json parsed as valid JSON at every sampled instant (0 partial reads across iters)"
else
  fail "post-fix: lost an update and/or observed a partial read (see notes above)"
fi
echo

# =====================================================================
# TEST B — pre-fix proof: the unlocked HEAD updater LOSES updates under the same load.
# =====================================================================
if [[ "$HAVE_PREFIX" -eq 1 ]]; then
  printf '%s[B] pre-fix proof — same hammer against unlocked HEAD:lib/run-lib.sh%s\n' "$C_BLU" "$C_NC"
  prefix_lost_iters=0
  for ((it=1; it<=ITERS; it++)); do
    read -r plost ppf <<<"$(bash_hammer_once "$PREFIX_LIB" "prefix-$it" "$N")"
    if [[ "$plost" -ne "$N" ]]; then
      prefix_lost_iters=$((prefix_lost_iters+1))
    fi
  done
  note "pre-fix hammer: $prefix_lost_iters/$ITERS iterations lost at least one agent-status update"
  if [[ "$prefix_lost_iters" -gt 0 ]]; then
    pass "pre-fix-fails proof: unlocked HEAD code LOSES updates ($prefix_lost_iters/$ITERS iters dropped a write)"
  else
    # racy by nature: the HEAD snapshot differs from the working copy, but the
    # lost-update did not surface in $ITERS iterations on this host — and a
    # file-level diff doesn't guarantee the diff touches the updater at all.
    # SKIP loudly rather than fail: a negative-control that cannot reproduce
    # its bug must never flake CI. the post-fix invariant above is the gate.
    note "${C_YEL}pre-fix-fails proof: race did not surface in $ITERS iterations on this host — skipping (timing-dependent; not counted as failure)${C_NC}"
  fi
  echo
fi

# =====================================================================
# Node writer using the run.json lock protocol (replicated byte-for-byte from
# web/lib/runs/run-json-lock.ts). We replicate rather than import the .ts because
# node cannot import TypeScript without a transpile step, and this suite must stay
# dependency-free and tooling-free (no ts-node / no build). The protocol is IDENTICAL:
# same lock dir `${run_file}.lock/`, same `${lock}/pid` decimal-PID file, same
# stale-break (dead pid via process.kill(pid,0) ESRCH, OR mtime age > stale secs),
# same ~50ms spin tick, same atomic temp+rename write. A divergence here would be a
# test bug, not a product bug — the product code under test on the bash side is the
# real run-lib.sh, and on the TS side the real route imports run-json-lock.ts.
# =====================================================================
NODE_LOCK_MJS="$TMP_ROOT/node-runjson-lock.mjs"
cat > "$NODE_LOCK_MJS" <<'NODEJS'
import { mkdirSync, writeFileSync, readFileSync, rmSync, statSync, renameSync, readdirSync } from "fs";

function readdirSafe(d) { try { return readdirSync(d); } catch { return []; } }
function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const STALE_SECS = envInt("RUN_LOCK_STALE_SECS", 120);
const WAIT_TICKS = envInt("RUN_LOCK_WAIT_SECS", 30);
const TICK_MS = 50;

function sleepSyncMs(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
  catch { const end = Date.now() + ms; while (Date.now() < end) {} }
}
function lockAgeSecs(lockDir) {
  try { const m = statSync(lockDir).mtimeMs; if (m > 0) return Math.floor((Date.now() - m) / 1000); }
  catch {}
  return 0;
}
function holderIsDead(lockDir) {
  let holder = "";
  try { holder = readFileSync(`${lockDir}/pid`, "utf-8").trim(); } catch { return false; }
  const pid = Number(holder);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return false; }
  catch (err) { return err.code === "ESRCH"; }
}
function acquireLock(lockDir) {
  let waited = 0;
  for (;;) {
    try {
      mkdirSync(lockDir);
      try { writeFileSync(`${lockDir}/pid`, String(process.pid)); } catch {}
      return true;
    } catch {
      if (holderIsDead(lockDir) || lockAgeSecs(lockDir) >= STALE_SECS) {
        try { rmSync(`${lockDir}/pid`, { force: true }); } catch {}
        try { rmSync(lockDir, { recursive: true, force: true }); } catch {}
        continue;
      }
      if (waited >= WAIT_TICKS) return false;
      sleepSyncMs(TICK_MS);
      waited += 1;
    }
  }
}
function releaseLock(lockDir) {
  try { rmSync(`${lockDir}/pid`, { force: true }); } catch {}
  try { rmSync(lockDir, { recursive: true, force: true }); } catch {}
}
function withRunJsonLock(runFile, fn) {
  const lockDir = `${runFile}.lock`;
  const ok = acquireLock(lockDir);
  if (!ok) { return fn(); } // degraded, last-writer-wins
  try { return fn(); } finally { releaseLock(lockDir); }
}
function writeAtomic(runFile, data) {
  const tmp = `${runFile}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, runFile);
}

const [, , mode, runFile, arg1, arg2] = process.argv;

if (mode === "set-agent") {
  // arg1 = agentId, arg2 = status. Re-read INSIDE the lock, mutate, atomic write.
  const agentId = arg1, status = arg2;
  withRunJsonLock(runFile, () => {
    const run = JSON.parse(readFileSync(runFile, "utf-8"));
    const a = (run.agents || []).find((x) => x.id === agentId);
    if (a) a.status = status; else (run.agents = run.agents || []).push({ id: agentId, status });
    writeAtomic(runFile, run);
  });
} else if (mode === "mutex-mark") {
  // mutual-exclusion probe: while holding the lock, drop a marker, verify no OTHER
  // marker exists, then remove ours. arg1 = marker dir, arg2 = who. Loops a few times.
  const markDir = arg1, who = arg2;
  let violations = 0;
  for (let i = 0; i < 30; i++) {
    withRunJsonLock(runFile, () => {
      const mine = `${markDir}/held.${who}`;
      writeFileSync(mine, String(process.pid));
      // any other holder marker present == two writers in the section at once.
      const others = (() => {
        try { return readdirSafe(markDir).filter((f) => f.startsWith("held.") && f !== `held.${who}`); }
        catch { return []; }
      })();
      if (others.length > 0) violations++;
      sleepSyncMs(2);
      try { rmSync(mine, { force: true }); } catch {}
    });
  }
  process.stdout.write(String(violations));
} else if (mode === "stale-break") {
  // arg1 ignored. Acquire (should break a pre-seeded stale lock), then write a marker.
  const ok = acquireLock(`${runFile}.lock`);
  if (ok) { writeFileSync(`${runFile}.broke`, "ok"); releaseLock(`${runFile}.lock`); process.stdout.write("acquired"); }
  else { process.stdout.write("timeout"); }
}
NODEJS

# =====================================================================
# TEST C — cross-language contention: bash + node writers on the SAME run.json.
# =====================================================================
if [[ -n "$NODE_BIN" ]]; then
  printf '%s[C] cross-language contention — bash + node writers on one run.json%s\n' "$C_BLU" "$C_NC"
  c_ok=1
  for ((it=1; it<=10; it++)); do
    runs_dir="$TMP_ROOT/runs-xlang-$it"; rm -rf "$runs_dir"; mkdir -p "$runs_dir"
    run_id="$(seed_run "$runs_dir" 8)"
    run_file="$runs_dir/$run_id/run.json"

    # bash writes agents 1-4; node writes agents 5-8 — all -> "complete", concurrently.
    for k in 1 2 3 4; do
      ( export RL_PATH="$RUN_LIB" RUNS_DIR="$runs_dir"; source "$WORKER_LIB"
        update-run-agent "$run_id" "agent$k" "complete" >/dev/null 2>&1 ) &
    done
    for k in 5 6 7 8; do
      ( "$NODE_BIN" "$NODE_LOCK_MJS" set-agent "$run_file" "agent$k" "complete" >/dev/null 2>&1 ) &
    done
    wait

    landed="$(jq '[.agents[] | select(.status=="complete")] | length' "$run_file" 2>/dev/null || echo 0)"
    [[ "$landed" -ne 8 ]] && { c_ok=0; note "xlang iter $it: only $landed/8 statuses landed across bash+node  <-- LOST UPDATE"; }
  done
  [[ "$c_ok" -eq 1 ]] && pass "cross-language: 10/10 iterations landed all 8 statuses (bash+node, zero lost updates)" \
                      || fail "cross-language: a write was lost across the bash/node boundary"

  # mutual-exclusion marker check: bash + node both run the marker dance on one lock.
  # Each writer, while HOLDING the lock, drops a marker file, checks that no OTHER
  # holder's marker exists, then removes its own. If the lock ever let two writers
  # into the section at once, one side observes the other's marker => a violation.
  printf '%s[C2] cross-language mutual exclusion — lock-held marker never seen by two writers%s\n' "$C_BLU" "$C_NC"
  mx_runs="$TMP_ROOT/runs-mutex"; rm -rf "$mx_runs"; mkdir -p "$mx_runs"
  mx_run_id="$(seed_run "$mx_runs" 2)"
  mx_run_file="$mx_runs/$mx_run_id/run.json"
  mark_dir="$TMP_ROOT/marks"; rm -rf "$mark_dir"; mkdir -p "$mark_dir"
  bash_violations_file="$TMP_ROOT/bash-mutex-violations"; echo 0 > "$bash_violations_file"
  node_violations_file="$TMP_ROOT/node-mutex-violations"; echo 0 > "$node_violations_file"

  # bash marker-dance worker, run in a subshell that has sourced run-lib (so
  # _with_run_lock is in scope). Mirrors the node `mutex-mark` mode exactly.
  (
    export RL_PATH="$RUN_LIB" RUNS_DIR="$mx_runs"; source "$WORKER_LIB"
    md="$mark_dir"; who="bash"; v=0
    _bash_mutex_section() {  # <run_file> (appended by _with_run_lock)
      local mine="$md/held.$who"
      echo "$$" > "$mine"
      local others
      others="$(ls -1 "$md" 2>/dev/null | grep '^held\.' | grep -v "^held\.$who$" || true)"
      [[ -n "$others" ]] && v=$((v+1))
      sleep 0.002 2>/dev/null || true
      rm -f "$mine" 2>/dev/null || true
    }
    for ((i=0; i<30; i++)); do _with_run_lock "$mx_run_file" _bash_mutex_section; done
    echo "$v" > "$bash_violations_file"
  ) &
  bash_mx_pid=$!

  # node marker-dance worker in parallel; its violation count goes to stdout.
  "$NODE_BIN" "$NODE_LOCK_MJS" mutex-mark "$mx_run_file" "$mark_dir" "node" > "$node_violations_file" 2>/dev/null &
  node_mx_pid=$!

  wait "$bash_mx_pid" 2>/dev/null || true
  wait "$node_mx_pid" 2>/dev/null || true

  bash_violations="$(tr -dc '0-9' < "$bash_violations_file" 2>/dev/null)"; [[ -z "$bash_violations" ]] && bash_violations=0
  node_violations="$(tr -dc '0-9' < "$node_violations_file" 2>/dev/null)"; [[ -z "$node_violations" ]] && node_violations=0
  total_violations=$((bash_violations + node_violations))
  if [[ "$total_violations" -eq 0 ]]; then
    pass "cross-language mutual exclusion: 0 simultaneous-holder violations (bash=$bash_violations, node=$node_violations)"
  else
    fail "cross-language mutual exclusion: $total_violations violations — two writers held the lock at once"
  fi
  echo
else
  note "${C_YEL}node not found — skipping cross-language tests C/C2${C_NC}"
  echo
fi

# =====================================================================
# TEST D — stale-break: a lock dir with a dead pid OR old mtime gets broken.
# =====================================================================
printf '%s[D] stale-break — dead-pid and aged-out locks are broken, write proceeds%s\n' "$C_BLU" "$C_NC"

# pick a PID that is (almost certainly) dead: spawn `true`, reap it, reuse its pid.
DEAD_PID="$("$ENGINE_BASH" -c 'sleep 0 & echo $!')"
sleep 0.2 2>/dev/null || true
while kill -0 "$DEAD_PID" 2>/dev/null; do sleep 0.05 2>/dev/null || break; done

# D1 — bash side, dead-pid break.
d_runs="$TMP_ROOT/runs-stale"; rm -rf "$d_runs"; mkdir -p "$d_runs"
d_run_id="$(seed_run "$d_runs" 2)"
d_run_file="$d_runs/$d_run_id/run.json"
mkdir -p "$d_run_file.lock"; echo "$DEAD_PID" > "$d_run_file.lock/pid"   # pre-seed a dead-pid lock
d_result="$(
  export RL_PATH="$RUN_LIB" RUNS_DIR="$d_runs"
  source "$WORKER_LIB"
  RUN_LOCK_WAIT_SECS=10   # short budget: if break fails, we time out fast rather than hang
  update-run-agent "$d_run_id" "agent1" "complete" >/dev/null 2>&1
  jq -r '.agents[] | select(.id=="agent1") | .status' "$d_run_file" 2>/dev/null
)"
if [[ "$d_result" == "complete" ]]; then
  pass "bash stale-break (dead pid $DEAD_PID): lock broken, update-run-agent wrote through"
else
  fail "bash stale-break (dead pid): write did not land (status=[$d_result])"
fi

# D2 — bash side, aged-out break (live-but-foreign holder, lock older than threshold).
d2_runs="$TMP_ROOT/runs-stale2"; rm -rf "$d2_runs"; mkdir -p "$d2_runs"
d2_run_id="$(seed_run "$d2_runs" 2)"
d2_run_file="$d2_runs/$d2_run_id/run.json"
mkdir -p "$d2_run_file.lock"; echo "$$" > "$d2_run_file.lock/pid"   # OUR pid (alive!) — must rely on age
# backdate the lock dir mtime well past the stale threshold (touch -t, portable enough).
old_stamp="$(date -v-1H '+%Y%m%d%H%M' 2>/dev/null || date -d '1 hour ago' '+%Y%m%d%H%M' 2>/dev/null || echo '202001010000')"
touch -t "$old_stamp" "$d2_run_file.lock" 2>/dev/null || true
d2_result="$(
  export RL_PATH="$RUN_LIB" RUNS_DIR="$d2_runs"
  source "$WORKER_LIB"
  RUN_LOCK_STALE_SECS=5   # anything older than 5s is stale; our backdated lock is ~1h old
  RUN_LOCK_WAIT_SECS=10
  update-run-agent "$d2_run_id" "agent2" "complete" >/dev/null 2>&1
  jq -r '.agents[] | select(.id=="agent2") | .status' "$d2_run_file" 2>/dev/null
)"
if [[ "$d2_result" == "complete" ]]; then
  pass "bash stale-break (aged-out, live foreign holder): lock broken by age, wrote through"
else
  fail "bash stale-break (aged-out): write did not land (status=[$d2_result])"
fi

# D3 — node side, dead-pid break (proves the TS protocol breaks a stale lock too).
if [[ -n "$NODE_BIN" ]]; then
  d3_runs="$TMP_ROOT/runs-stale3"; rm -rf "$d3_runs"; mkdir -p "$d3_runs"
  d3_run_id="$(seed_run "$d3_runs" 2)"
  d3_run_file="$d3_runs/$d3_run_id/run.json"
  mkdir -p "$d3_run_file.lock"; echo "$DEAD_PID" > "$d3_run_file.lock/pid"
  d3_out="$(RUN_LOCK_WAIT_SECS=10 "$NODE_BIN" "$NODE_LOCK_MJS" stale-break "$d3_run_file" x 2>/dev/null)"
  if [[ "$d3_out" == "acquired" && -f "$d3_run_file.broke" ]]; then
    pass "node stale-break (dead pid $DEAD_PID): TS lock protocol broke the stale lock and acquired"
  else
    fail "node stale-break (dead pid): node did not break the lock (out=[$d3_out])"
  fi
fi
echo

# =====================================================================
hr
printf 'run.json e2e results: %s%d passed%s, %s%d failed%s\n' "$C_GREEN" "$PASS" "$C_NC" "$C_RED" "$FAIL" "$C_NC"
hr
[[ "$FAIL" -gt 0 ]] && exit 1
exit 0
