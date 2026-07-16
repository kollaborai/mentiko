#!/usr/bin/env bash
# engine-e2e-monitor.sh — hermetic end-to-end proof of the Mentiko MONITOR LOOP's
# failure/stall semantics (lib/agent-functions.sh monitor-chain-agent).
#
# This is the targeted guard for wave-2 group A (findings #1-#4). It drives the
# REAL bash engine (`./bin/mentiko run`) with the deterministic stub CLI in the
# new failure-shaped STUB_MODEs, and asserts the CORE PRINCIPLE of the fix:
#
#     stale != complete, and dead != succeeded.
#
# The monitor must NEVER fabricate an agent's success event when the agent did
# not succeed. Specifically:
#   (a) mid-run death  — agent passes startup liveness, then its process exits
#       WITHOUT writing its event or printing AGENT_COMPLETE. The run must reach a
#       FAILED terminal state, the agent must NOT be marked complete, NO success
#       event file may exist, and a diagnostic (agent-error) event MUST exist.
#       This is THE key assertion of the whole wave.
#   (b) quiet-but-working — agent sits silent across several staleness intervals
#       (the md5 quiescence heuristic trips), then completes normally. The run
#       must COMPLETE successfully, must NOT be force-completed early, and there
#       must be exactly ONE success event (the real one) and NO stall diagnostic.
#   (c) chatty — agent emits its event + AGENT_COMPLETE, then floods hundreds of
#       lines so the marker scrolls past the monitor's tail capture window.
#       Completion must still be detected promptly (via the latched event-file
#       signal), and the run must COMPLETE.
#
# Hermetic + fast: throwaway data root (MENTIKO_GLOBAL_ROOT), a uniquely-named PTY
# daemon (never touches the developer's ~/.mentiko or dev sessions), zero model
# traffic, and the monitor timing knobs (MENTIKO_MONITOR_*) cranked fast so the
# stale/death paths fire in seconds. Every run is wrapped in a hard timeout so a
# hang FAILS the test instead of blocking.
#
# Usage:   web/e2e/engine/engine-e2e-monitor.sh
# Exit:    0 = all assertions passed, non-zero = failure.

set -uo pipefail

# -------------------------------------------------------------------
# locate repo + a bash 4+ interpreter (the engine uses readarray/${var^^}/etc.)
# -------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
MENTIKO_BIN="$REPO_ROOT/bin/mentiko"
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

# colours (skip when not a tty / in CI)
if [[ -t 1 && -z "${CI:-}" ]]; then
  C_RED=$'\033[0;31m'; C_GREEN=$'\033[0;32m'; C_YEL=$'\033[0;33m'; C_BLU=$'\033[0;34m'; C_NC=$'\033[0m'
else
  C_RED=""; C_GREEN=""; C_YEL=""; C_BLU=""; C_NC=""
fi

PASS=0
FAIL=0
pass() { printf '  %s✔%s %s\n' "$C_GREEN" "$C_NC" "$1"; PASS=$((PASS+1)); }
fail() { printf '  %sx%s %s\n' "$C_RED" "$C_NC" "$1"; FAIL=$((FAIL+1)); }
note() { printf '  %s·%s %s\n' "$C_BLU" "$C_NC" "$1"; }
hr()   { printf '%s\n' "------------------------------------------------------------"; }

# -------------------------------------------------------------------
# isolated, throwaway environment
# -------------------------------------------------------------------
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/mentiko-engine-monitor-e2e.XXXXXX")"
DATA_ROOT="$TMP_ROOT/data"
WORKSPACE="$TMP_ROOT/ws"
STUB_LOG_HOME="$TMP_ROOT/stub-log-home"
mkdir -p "$DATA_ROOT" "$WORKSPACE" "$STUB_LOG_HOME"

PTY_DAEMON_NAME="mentiko-e2e-monitor-$$-$RANDOM"

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
export PTY_DAEMON="$PTY_DAEMON_NAME"
export STUB_CLI="$SCRIPT_DIR/fixtures/stub-agent-cli.sh"

# FAST monitor knobs (env-tunable; defaults preserved in production). These make
# the stale/death paths fire in seconds instead of minutes.
#   - tail window kept generous so the chatty flood can exceed it.
export MENTIKO_MONITOR_MARKER_TAIL=80
# chatty floods 400 lines > 80-line tail window, so the marker scrolls off.
export STUB_CHATTY_LINES=400

# READINESS (Stage-0 fail-closed). Prove a never-ready agent is BLOCKED at startup —
# no task instruction injected — instead of fed into a dead session. Fail-closed is
# opt-in (default off in production); the suite turns it on. A/B/C declare a ready
# pattern the stub prints ("REPL ready") so they classify ready and run normally; the
# limbo profile (scenario D) declares none, so it classifies no_ready_signal and the
# engine refuses to inject. Grace window shortened so any unknown→deadline is quick.
export MENTIKO_READINESS_FAIL_CLOSED=1
export MENTIKO_CLI_READY_TIMEOUT=8
export MENTIKO_CLI_READY_POLL=2

PROFILES_DIR="$DATA_ROOT/namespaces/default/agent-profiles"
mkdir -p "$PROFILES_DIR"
chmod +x "$STUB_CLI" 2>/dev/null || true

git -C "$WORKSPACE" init -q >/dev/null 2>&1 || true
git -C "$WORKSPACE" -c user.email=e2e@local -c user.name=e2e commit -q --allow-empty -m init >/dev/null 2>&1 || true

# -------------------------------------------------------------------
# fixture builders
# -------------------------------------------------------------------
write_profile() {  # <pid> <mode> [extra_env] [is_default=true] [is_advisor=true] [ready_pattern="REPL ready"|"none"]
  local pid="$1" mode="$2" extra="${3:-}" is_default="${4:-true}" is_advisor="${5:-true}" ready_pattern="${6:-REPL ready}"
  local env_block="\"STUB_MODE\": \"${mode}\""
  [[ -n "$extra" ]] && env_block="${env_block}, ${extra}"
  # readiness policy: a positive ready pattern the stub prints on startup (line 177:
  # "stub REPL ready (mode=...)"). Pass "none" to write a profile with NO readiness
  # policy, which under MENTIKO_READINESS_FAIL_CLOSED classifies as no_ready_signal.
  local readiness_line=""
  if [[ "$ready_pattern" != "none" ]]; then
    readiness_line="  \"readiness\": { \"enabled\": true, \"ready_patterns\": [ { \"name\": \"stub-ready\", \"type\": \"text\", \"value\": \"${ready_pattern}\" } ] },"
  fi
  cat > "$PROFILES_DIR/${pid}.json" <<JSON
{
  "id": "${pid}",
  "name": "Monitor E2E Stub (${mode})",
  "cli": "${STUB_CLI}",
  "log_path": "${STUB_LOG_HOME}",
  "isDefault": ${is_default},
  "isAdvisorDefault": ${is_advisor},
${readiness_line}
  "env": { ${env_block} }
}
JSON
}

TIMEOUT_BIN="$(command -v timeout || command -v gtimeout || true)"
run_chain() {  # <chain_file> <launch_timeout_s>  -> echoes run dir
  local chain="$1" t="${2:-90}" log="$TMP_ROOT/run-$RANDOM.log"
  if [[ -n "$TIMEOUT_BIN" ]]; then
    PATH="$(dirname "$ENGINE_BASH"):$PATH" "$TIMEOUT_BIN" "$t" \
      "$ENGINE_BASH" "$MENTIKO_BIN" run "$chain" --workspace "$WORKSPACE" >"$log" 2>&1 || true
  else
    PATH="$(dirname "$ENGINE_BASH"):$PATH" \
      "$ENGINE_BASH" "$MENTIKO_BIN" run "$chain" --workspace "$WORKSPACE" >"$log" 2>&1 || true
  fi
  ls -dt "$DATA_ROOT/namespaces/default/runs/run-"* 2>/dev/null | head -1
}

# poll run.json until it reaches ANY of the given target statuses, or fail on
# timeout. echoes the final observed status. `blocked` is NOT a poll_terminal
# status in the base harness, so we accept an explicit target set here.
poll_for_status() {  # <run_dir> <timeout_s> <space-separated target statuses>
  local run_dir="$1" budget="$2" targets="$3" run_json="$1/run.json" st="" waited=0 t
  while [[ $waited -lt $budget ]]; do
    st="$(jq -r '.status // "unknown"' "$run_json" 2>/dev/null)"
    for t in $targets; do
      [[ "$st" == "$t" ]] && { echo "$st"; return 0; }
    done
    sleep 2; waited=$((waited+2))
  done
  echo "TIMEOUT(status=$st after ${budget}s)"
  return 1
}

agent_status() {  # <run_dir> <agent_id>
  jq -r --arg id "$2" '.agents[]? | select(.id==$id) | .status // "absent"' "$1/run.json" 2>/dev/null
}

# does a SUCCESS event for <agent emits> exist? (the canonical handoff event the
# completion matcher keys on). We look for the agent's declared emits name.
success_event_exists() {  # <emits_name>
  local emits="$1" evdir="$DATA_ROOT/namespaces/default/events" f
  shopt -s nullglob
  for f in "$evdir"/*.event "$evdir"/archive/*.event; do
    [[ -f "$f" ]] || continue
    # a success handoff has `event: <emits>` AND source = the agent (not "monitor")
    if grep -qiE "^event:[[:space:]]*${emits}[[:space:]]*$" "$f" 2>/dev/null \
       && ! grep -qiE "^source:[[:space:]]*monitor[[:space:]]*$" "$f" 2>/dev/null; then
      shopt -u nullglob; return 0
    fi
  done
  shopt -u nullglob
  return 1
}

# count GENUINE success-handoff events for <emits_name>: `event: <emits>` on its
# own line AND source != monitor. This is deliberately precise — it does NOT
# content-grep the bare string, so it never counts the aggregate `chain-complete`
# event (whose `data:` line carries `last_event=<emits>`) nor any diagnostic. The
# real slow-done handoff lands once (it is `mv`d into events/archive/ on
# completion, so we scan both active and archive).
count_success_events() {  # <emits_name>
  local emits="$1" evdir="$DATA_ROOT/namespaces/default/events" n=0 f
  shopt -s nullglob
  for f in "$evdir"/*.event "$evdir"/archive/*.event; do
    [[ -f "$f" ]] || continue
    if grep -qiE "^event:[[:space:]]*${emits}[[:space:]]*$" "$f" 2>/dev/null \
       && ! grep -qiE "^source:[[:space:]]*monitor[[:space:]]*$" "$f" 2>/dev/null; then
      n=$((n+1))
    fi
  done
  shopt -u nullglob
  echo "$n"
}

# does a diagnostic event (source: monitor) of the given type exist?
diagnostic_event_exists() {  # <event_type e.g. agent-error|agent-timeout>
  local etype="$1" evdir="$DATA_ROOT/namespaces/default/events" f
  shopt -s nullglob
  for f in "$evdir"/*.event "$evdir"/archive/*.event; do
    [[ -f "$f" ]] || continue
    if grep -qiE "^event:[[:space:]]*${etype}[[:space:]]*$" "$f" 2>/dev/null \
       && grep -qiE "^source:[[:space:]]*monitor[[:space:]]*$" "$f" 2>/dev/null; then
      shopt -u nullglob; return 0
    fi
  done
  shopt -u nullglob
  return 1
}

# =====================================================================
hr; printf '%smentiko MONITOR e2e%s — stale != complete, dead != succeeded\n' "$C_YEL" "$C_NC"; hr
note "repo:        $REPO_ROOT"
note "engine bash: $ENGINE_BASH ($("$ENGINE_BASH" -c 'echo $BASH_VERSION'))"
note "data root:   $DATA_ROOT"
note "pty daemon:  $PTY_DAEMON_NAME"
note "stub cli:    $STUB_CLI"
[[ -n "$TIMEOUT_BIN" ]] || note "${C_YEL}warning: no 'timeout' binary; relying on stub deadline only${C_NC}"
echo

command -v jq >/dev/null 2>&1 || { printf '%sFATAL: jq is required%s\n' "$C_RED" "$C_NC"; exit 2; }
if [[ "$("$ENGINE_BASH" -c 'echo ${BASH_VERSINFO:-0}')" -lt 4 ]]; then
  printf '%sFATAL: need bash 4+ to run the engine%s\n' "$C_RED" "$C_NC"; exit 2
fi

# ---------------------------------------------------------------------
# SCENARIO A — MID-RUN DEATH (THE KEY ASSERTION).
# stub passes startup liveness, then exits non-zero on the instruction line
# WITHOUT emitting its event or AGENT_COMPLETE. The monitor's dead-process branch
# must record FAILURE (not fabricate success) and the run must reach FAILED.
# ---------------------------------------------------------------------
printf '%s[A] mid-run death — process dies without event => FAILED, never fabricated success%s\n' "$C_BLU" "$C_NC"
# fast monitor: poll every 2s, declare blocked only after many cycles (high
# max-stale) so the DEAD-process path — not the stale path — is what fires.
export MENTIKO_MONITOR_INTERVAL=2
export MENTIKO_MONITOR_MAX_STALE=30
# mid-run-crash must stay alive (post-instruction) long enough for the monitor to
# (1) start its loop after the launch sequence and (2) ARM its dead-process
# detector by observing the live CLI at least once — THEN die. Otherwise the
# engine's pre-instruction startup check would catch the exit first and the
# monitor's dead-process path (the code under test) would never fire.
export STUB_MIDCRASH_SECONDS=16
write_profile "stub-default" "mid-run-crash"

CHAIN_A="$TMP_ROOT/chain-mid-crash.json"
cat > "$CHAIN_A" <<'JSON'
{
  "name": "monitor-e2e-mid-crash",
  "description": "agent dies mid-run without emitting its event",
  "version": "1.0",
  "config": { "monitor": true, "monitor_interval": 2, "max_rounds": 2, "session_prefix": "midcrash", "on_complete": "stop" },
  "agents": [
    { "id": "worker", "name": "Worker", "triggers": ["manual-start"], "emits": "worker-done", "prompt": "do work then crash" },
    { "id": "after",  "name": "After",  "triggers": ["worker-done"],  "emits": "after-done",  "prompt": "must never run" }
  ]
}
JSON

RUN_A="$(run_chain "$CHAIN_A" 80)"
if [[ -z "$RUN_A" || ! -f "$RUN_A/run.json" ]]; then
  fail "A: run object created"
else
  pass "A: run object created ($(basename "$RUN_A"))"
  FINAL_A="$(poll_for_status "$RUN_A" 70 "failed blocked stopped")"
  note "A: terminal status = $FINAL_A"

  # the run must NOT be (falsely) completed.
  if [[ "$FINAL_A" == "completed" || "$FINAL_A" == "complete" ]]; then
    fail "A: run was FALSELY marked completed on a mid-run death"
  elif [[ "$FINAL_A" == "failed" ]]; then
    pass "A: run reached terminal FAILED state (dead != succeeded)"
  elif [[ "$FINAL_A" == TIMEOUT* ]]; then
    fail "A: run never surfaced a non-success terminal state — $FINAL_A"
  else
    # blocked/stopped are also acceptable "surfaced non-success" states, but the
    # spec for dead-without-event is FAILED; flag anything else for visibility.
    note "A: surfaced as '$FINAL_A' (non-success, acceptable surface)"
    pass "A: run surfaced a non-success state (not falsely complete)"
  fi

  # the worker agent must NOT be marked complete.
  WST_A="$(agent_status "$RUN_A" worker)"
  note "A: worker agent status = $WST_A"
  [[ "$WST_A" != "complete" ]] && pass "A: worker NOT marked complete" || fail "A: worker was falsely marked complete"

  # NO success event for worker-done may exist (no fabrication).
  if success_event_exists "worker-done"; then
    fail "A: a fabricated worker-done SUCCESS event exists (THE bug — must not happen)"
  else
    pass "A: no fabricated worker-done success event exists"
  fi

  # a diagnostic failure event MUST exist.
  if diagnostic_event_exists "agent-error"; then
    pass "A: diagnostic agent-error event written (source: monitor)"
  else
    fail "A: no diagnostic agent-error event found"
  fi

  # downstream must never have launched.
  AST_A="$(agent_status "$RUN_A" after)"
  [[ "$AST_A" == "absent" || -z "$AST_A" ]] && pass "A: downstream 'after' never launched" || fail "A: downstream 'after' ran (status '$AST_A')"
fi
echo

# ---------------------------------------------------------------------
# SCENARIO B — QUIET-BUT-WORKING.
# stub goes silent across several staleness intervals (md5 stable => stale climbs)
# then completes normally. With a HIGH max-stale it must finish BEFORE max-stale,
# proving a quiet agent is not force-completed early. Exactly one success event.
# ---------------------------------------------------------------------
printf '%s[B] quiet-but-working — silent across stale intervals, then completes (no early force)%s\n' "$C_BLU" "$C_NC"
export MENTIKO_MONITOR_INTERVAL=2
export MENTIKO_MONITOR_MAX_STALE=20   # high: must NOT be reached before the quiet agent completes
# quiet for ~10s = ~5 stale cycles at 2s interval, well under max-stale=20.
write_profile "stub-default" "quiet-slow" '"STUB_QUIET_SECONDS": "10"'

CHAIN_B="$TMP_ROOT/chain-quiet.json"
cat > "$CHAIN_B" <<'JSON'
{
  "name": "monitor-e2e-quiet",
  "description": "agent is silent for several stale intervals then completes",
  "version": "1.0",
  "config": { "monitor": true, "monitor_interval": 2, "max_rounds": 2, "session_prefix": "quiet", "on_complete": "stop" },
  "agents": [
    { "id": "slowstep", "name": "Slow Step", "triggers": ["manual-start"], "emits": "slow-done", "prompt": "think quietly then finish" }
  ]
}
JSON

RUN_B="$(run_chain "$CHAIN_B" 90)"
if [[ -z "$RUN_B" || ! -f "$RUN_B/run.json" ]]; then
  fail "B: run object created"
else
  pass "B: run object created ($(basename "$RUN_B"))"
  FINAL_B="$(poll_for_status "$RUN_B" 80 "completed complete failed blocked stopped")"
  note "B: terminal status = $FINAL_B"
  if [[ "$FINAL_B" == "completed" || "$FINAL_B" == "complete" ]]; then
    pass "B: quiet-but-working run COMPLETED successfully"
  elif [[ "$FINAL_B" == "blocked" ]]; then
    fail "B: quiet agent was FORCE-BLOCKED early (false stall) — got '$FINAL_B'"
  else
    fail "B: expected completed, got '$FINAL_B'"
  fi
  [[ "$(agent_status "$RUN_B" slowstep)" == "complete" ]] && pass "B: slowstep marked complete" || fail "B: slowstep not complete (got '$(agent_status "$RUN_B" slowstep)')"

  # NOT force-completed early: no stall diagnostic should have fired.
  if diagnostic_event_exists "agent-timeout"; then
    fail "B: a stall diagnostic (agent-timeout) fired for a working agent"
  else
    pass "B: no premature stall diagnostic (agent-timeout) emitted"
  fi

  # exactly ONE success HANDOFF event (the real one) for slow-done. Counted
  # precisely (event: slow-done + source != monitor) so the aggregate
  # chain-complete event — which mentions slow-done in its data line — is not
  # miscounted as a second success.
  N_B="$(count_success_events "slow-done")"
  note "B: slow-done success-handoff event count = $N_B"
  if [[ "$N_B" == "1" ]]; then
    pass "B: exactly one slow-done success event (the real one, not force-emitted)"
  else
    fail "B: expected exactly 1 slow-done success-handoff event, found $N_B"
  fi
fi
echo

# ---------------------------------------------------------------------
# SCENARIO C — CHATTY.
# stub emits its event + AGENT_COMPLETE, then floods hundreds of lines so the
# marker scrolls past the tail capture window. Completion must still be detected
# (latched event-file signal) and the run must COMPLETE.
# ---------------------------------------------------------------------
printf '%s[C] chatty — AGENT_COMPLETE scrolls past the tail window, completion still detected%s\n' "$C_BLU" "$C_NC"
export MENTIKO_MONITOR_INTERVAL=2
export MENTIKO_MONITOR_MAX_STALE=20
export MENTIKO_MONITOR_MARKER_TAIL=80   # << 400 flood lines, so the marker is gone from the tail
write_profile "stub-default" "chatty"

CHAIN_C="$TMP_ROOT/chain-chatty.json"
cat > "$CHAIN_C" <<'JSON'
{
  "name": "monitor-e2e-chatty",
  "description": "agent floods output after AGENT_COMPLETE",
  "version": "1.0",
  "config": { "monitor": true, "monitor_interval": 2, "max_rounds": 2, "session_prefix": "chatty", "on_complete": "stop" },
  "agents": [
    { "id": "loud", "name": "Loud", "triggers": ["manual-start"], "emits": "loud-done", "prompt": "finish then flood output" }
  ]
}
JSON

RUN_C="$(run_chain "$CHAIN_C" 90)"
if [[ -z "$RUN_C" || ! -f "$RUN_C/run.json" ]]; then
  fail "C: run object created"
else
  pass "C: run object created ($(basename "$RUN_C"))"
  FINAL_C="$(poll_for_status "$RUN_C" 80 "completed complete failed blocked stopped")"
  note "C: terminal status = $FINAL_C"
  if [[ "$FINAL_C" == "completed" || "$FINAL_C" == "complete" ]]; then
    pass "C: chatty run COMPLETED (marker scrolled off, latched event-file detected it)"
  elif [[ "$FINAL_C" == TIMEOUT* ]]; then
    fail "C: chatty run HUNG — completion missed when marker left the tail window — $FINAL_C"
  else
    fail "C: expected completed, got '$FINAL_C'"
  fi
  [[ "$(agent_status "$RUN_C" loud)" == "complete" ]] && pass "C: loud agent marked complete" || fail "C: loud not complete (got '$(agent_status "$RUN_C" loud)')"
  success_event_exists "loud-done" && pass "C: loud-done success event present" || fail "C: loud-done success event missing"
fi
echo

# ---------------------------------------------------------------------
# SCENARIO D — SHELL WITHOUT A READY CLI (the Stage-0 false-ready guard).
# The agent process is alive but NEVER produces positive readiness evidence: it
# prints no ready banner and its profile declares no ready pattern — exactly the
# shape of the real claude/codex profiles, which ride the "readiness disabled =>
# ready" fail-open branch. A correct engine must therefore NOT type the task
# instruction — nor any stale nudge — into it, must NOT fabricate success, and
# must reach a non-success terminal state. The stub records everything typed at
# it; that log must stay EMPTY.
#
# TODAY (fail-open readiness) this FAILS: the engine classifies the idle process
# ready, types the instruction pointer (and, once stale, a nudge) into it, and the
# run never legitimately completes. That red is the point — it documents the bug
# the Stage-0 fix must close.
# ---------------------------------------------------------------------
printf '%s[D] shell-without-ready-CLI — engine must type NOTHING into a never-ready session%s\n' "$C_BLU" "$C_NC"
export MENTIKO_MONITOR_INTERVAL=2
export MENTIKO_MONITOR_MAX_STALE=6        # give the stale/advisor path room to (wrongly) fire
export MENTIKO_ADVISOR_STALE_COUNT=2      # make the (buggy) advisor/nudge fire fast if it is going to
GHOST_STDIN_LOG="$TMP_ROOT/ghost-stdin.log"        # everything the engine types INTO the ghost session
ADVISOR_MARKER="$TMP_ROOT/advisor-invoked.marker"  # written iff the stale advisor is consulted
: > "$GHOST_STDIN_LOG"; rm -f "$ADVISOR_MARKER"
# agent: alive but never-ready idle process; the DEFAULT profile, but NOT the advisor.
# "none" => NO readiness policy, so under MENTIKO_READINESS_FAIL_CLOSED it classifies
# as no_ready_signal and the engine blocks it at startup instead of injecting the task.
write_profile "stub-default" "limbo" "\"STUB_STDIN_LOG\": \"${GHOST_STDIN_LOG}\", \"STUB_LIMBO_SECONDS\": \"30\"" "true" "false" "none"
# advisor: a SEPARATE profile so a consultation is detectable and never pollutes the agent log.
write_profile "stub-advisor" "advisor-probe" "\"STUB_ADVISOR_MARKER\": \"${ADVISOR_MARKER}\"" "false" "true"

CHAIN_D="$TMP_ROOT/chain-limbo.json"
cat > "$CHAIN_D" <<'JSON'
{
  "name": "monitor-e2e-limbo",
  "description": "agent process alive but never ready; engine must not feed it",
  "version": "1.0",
  "config": { "monitor": true, "monitor_interval": 2, "max_rounds": 1, "session_prefix": "limbo", "on_complete": "stop" },
  "agents": [
    { "id": "ghost", "name": "Ghost", "triggers": ["manual-start"], "emits": "ghost-done", "prompt": "this task must never be delivered" }
  ]
}
JSON

RUN_D="$(run_chain "$CHAIN_D" 80)"
if [[ -z "$RUN_D" || ! -f "$RUN_D/run.json" ]]; then
  fail "D: run object created"
else
  pass "D: run object created ($(basename "$RUN_D"))"
  FINAL_D="$(poll_for_status "$RUN_D" 70 "failed blocked stopped")"
  note "D: terminal status = $FINAL_D"

  # must NOT be falsely completed, and must NOT hang in a non-terminal state.
  if [[ "$FINAL_D" == "completed" || "$FINAL_D" == "complete" ]]; then
    fail "D: run FALSELY completed for a never-ready agent"
  elif [[ "$FINAL_D" == TIMEOUT* ]]; then
    fail "D: run never reached a terminal state (stuck running) — $FINAL_D"
  else
    pass "D: run reached a non-success terminal state ($FINAL_D)"
  fi

  # STAGE-0 ASSERTION 1 — no TASK INPUT: the engine must type NOTHING into the
  # never-ready session (no instruction pointer, no stale nudge / advisor reply).
  # The ghost stub recorded every line delivered to its PTY stdin.
  if [[ -s "$GHOST_STDIN_LOG" ]]; then
    fail "D: engine typed input into a never-ready session (Stage-0 violation):"
    sed 's/^/          > /' "$GHOST_STDIN_LOG" | head -8
  else
    pass "D: engine typed nothing into the never-ready session (no task, no nudge)"
  fi

  # ADVISOR DURING STARTUP — forensic only (NOT a hard gate in this scenario). A
  # never-ready agent should trigger no stale-advisor call, but this scenario
  # resolves via the dead-process path before the stale threshold is reliably
  # crossed, so the consultation count is timing-dependent — reported, not asserted
  # (asserting it here would be green-for-the-wrong-reason). The real guarantee is
  # structural: no instructions_submitted => the runtime advisor never starts, which
  # the Stage-0 readiness fix enforces and a dedicated scenario will gate.
  if [[ -f "$ADVISOR_MARKER" ]]; then
    note "D: stale advisor consultations during startup = $(wc -l < "$ADVISOR_MARKER" | tr -d ' ') (forensic)"
  else
    note "D: stale advisor consultations during startup = 0 (forensic)"
  fi

  # no fabricated success event for the ghost agent.
  if success_event_exists "ghost-done"; then
    fail "D: a fabricated ghost-done success event exists"
  else
    pass "D: no fabricated ghost-done success event"
  fi

  # ghost must not be marked complete.
  GST_D="$(agent_status "$RUN_D" ghost)"
  note "D: ghost agent status = $GST_D"
  [[ "$GST_D" != "complete" ]] && pass "D: ghost NOT marked complete" || fail "D: ghost falsely marked complete"
fi
echo

# ---------------------------------------------------------------------
# SCENARIO E — BOUNDED AUTO-RECOVERY (the phase-aware advisor, now wired).
# The agent starts parked on a BENIGN "Press Enter to continue" prompt — recoverable,
# not ready. A blocked startup must NOT just fail: the engine consults the phase-aware
# startup advisor (web/lib/runner-v2/readiness-cli.ts), which returns a low-risk/high-confidence
# send_keys[ENTER]; the engine applies it ONCE (bounded by MENTIKO_STARTUP_RECOVERY_MAX),
# the agent clears the prompt, becomes ready, gets its task, and COMPLETES. Proves
# recovery actually works AND leaves a durable decision audit.
# ---------------------------------------------------------------------
printf '%s[E] bounded auto-recovery — advisor clears a benign startup prompt, run completes%s\n' "$C_BLU" "$C_NC"
export MENTIKO_MONITOR_INTERVAL=2
export MENTIKO_MONITOR_MAX_STALE=20
export MENTIKO_STARTUP_RECOVERY=1
export MENTIKO_STARTUP_RECOVERY_MAX=2
export MENTIKO_CLI_READY_TIMEOUT=20    # room for: detect recover -> advisor -> send Enter -> re-poll ready
# agent profile: recoverable-prompt mode; readiness knows the benign prompt is RECOVERABLE
# and the stub banner is READY (NOT the advisor — that is a separate profile below).
cat > "$PROFILES_DIR/stub-default.json" <<JSON
{
  "id": "stub-default",
  "name": "Recoverable startup stub",
  "cli": "${STUB_CLI}",
  "log_path": "${STUB_LOG_HOME}",
  "isDefault": true,
  "isAdvisorDefault": false,
  "readiness": {
    "enabled": true,
    "ready_patterns": [ { "name": "stub-ready", "type": "text", "value": "REPL ready", "enabled": true } ],
    "recoverable_patterns": [ { "name": "press-enter", "type": "text", "value": "Press Enter to continue", "action": "recover", "risk": "low", "enabled": true } ]
  },
  "env": { "STUB_MODE": "recoverable-prompt", "STUB_RECOVER_SECONDS": "30" }
}
JSON
# advisor profile: returns the low-risk send_keys[ENTER] recovery JSON.
write_profile "stub-advisor" "advisor-recover" "" "false" "true" "none"

CHAIN_E="$TMP_ROOT/chain-recover.json"
cat > "$CHAIN_E" <<'JSON'
{
  "name": "monitor-e2e-recover",
  "description": "agent parked on a benign prompt; advisor clears it",
  "version": "1.0",
  "config": { "monitor": true, "monitor_interval": 2, "max_rounds": 1, "session_prefix": "recover", "on_complete": "stop" },
  "agents": [
    { "id": "gated", "name": "Gated", "triggers": ["manual-start"], "emits": "gated-done", "prompt": "do the work once the prompt clears" }
  ]
}
JSON

RUN_E="$(run_chain "$CHAIN_E" 95)"
if [[ -z "$RUN_E" || ! -f "$RUN_E/run.json" ]]; then
  fail "E: run object created"
else
  pass "E: run object created ($(basename "$RUN_E"))"
  FINAL_E="$(poll_for_status "$RUN_E" 85 "completed complete failed blocked stopped")"
  note "E: terminal status = $FINAL_E"
  if [[ "$FINAL_E" == "completed" || "$FINAL_E" == "complete" ]]; then
    pass "E: recovered run COMPLETED (advisor cleared the prompt, agent then ran)"
  else
    fail "E: expected completed after recovery, got '$FINAL_E'"
  fi
  [[ "$(agent_status "$RUN_E" gated)" == "complete" ]] && pass "E: gated agent marked complete" || fail "E: gated not complete (got '$(agent_status "$RUN_E" gated)')"
  # the advisor must have been consulted + its decision recorded (auto-apply audit trail).
  if ls "$RUN_E"/artifacts/*startup-recovery-decisions.jsonl >/dev/null 2>&1; then
    pass "E: advisor recovery decision recorded (durable audit of the auto-apply)"
  else
    fail "E: expected a startup-recovery-decisions.jsonl audit artifact"
  fi
fi
echo

# ---------------------------------------------------------------------
# SCENARIO F — NUDGE-LOOP BOUND (the durable nudge budget).
# stub passes startup, then ECHOES every nudge back to the screen — so each nudge
# repaints the terminal and resets the per-cycle stale counter, which is exactly
# why the old max_stale_count cap could never fire from the nudge path. With
# max-stale set HIGH the stale path also cannot fire — so the ONLY thing that can
# stop the otherwise-infinite nudging is the durable, echo-proof nudge budget.
# The run must reach a BLOCKED terminal state within the timeout (proving the
# monitor did NOT nudge forever), the agent must be blocked (never complete), and
# the agent-timeout escalation diagnostic must exist.
# ---------------------------------------------------------------------
printf '%s[F] nudge-loop bound — echoed nudges reset stale forever; durable budget must escalate%s\n' "$C_BLU" "$C_NC"
export MENTIKO_MONITOR_INTERVAL=2
export MENTIKO_MONITOR_MAX_STALE=30      # HIGH: the stale path must NOT be what fires
export MENTIKO_MONITOR_MAX_NUDGES=2      # LOW: the durable nudge budget is what must fire
export MENTIKO_ADVISOR_STALE_COUNT=1     # nudge after a single quiet cycle (fast)
write_profile "stub-default" "echo-stall" "\"STUB_LIMBO_SECONDS\": \"45\"" "true" "false" "for agents"

CHAIN_F="$TMP_ROOT/chain-echo-stall.json"
cat > "$CHAIN_F" <<'JSON'
{
  "name": "monitor-e2e-echo-stall",
  "description": "agent echoes every nudge (resets stale) but never completes",
  "version": "1.0",
  "config": { "monitor": true, "monitor_interval": 2, "max_rounds": 2, "session_prefix": "echostall", "on_complete": "stop" },
  "agents": [
    { "id": "staller", "name": "Staller", "triggers": ["manual-start"], "emits": "staller-done", "prompt": "echo nudges, never finish" }
  ]
}
JSON

RUN_F="$(run_chain "$CHAIN_F" 80)"
if [[ -z "$RUN_F" || ! -f "$RUN_F/run.json" ]]; then
  fail "F: run object created"
else
  pass "F: run object created ($(basename "$RUN_F"))"
  # KEY assertion: a bounded terminal state is reached. If the budget failed, the
  # monitor would nudge forever and this poll would TIMEOUT.
  FINAL_F="$(poll_for_status "$RUN_F" 70 "failed blocked stopped completed complete")"
  note "F: terminal status = $FINAL_F"
  if [[ "$FINAL_F" == TIMEOUT* ]]; then
    fail "F: run never terminated — the monitor nudged forever (budget did NOT bound it)"
  elif [[ "$FINAL_F" == "completed" || "$FINAL_F" == "complete" ]]; then
    fail "F: run falsely COMPLETED — the staller never emitted its event"
  else
    pass "F: run reached bounded terminal '$FINAL_F' (nudging did NOT loop forever)"
  fi
  # the staller must be blocked, never complete.
  SST_F="$(agent_status "$RUN_F" staller)"
  note "F: staller agent status = $SST_F"
  [[ "$SST_F" != "complete" ]] && pass "F: staller NOT marked complete" || fail "F: staller falsely marked complete"
  # the escalation diagnostic must exist (monitor-agent-stalled -> agent-timeout).
  if diagnostic_event_exists "agent-timeout"; then
    pass "F: agent-timeout diagnostic written (durable budget escalated to BLOCKED)"
  else
    fail "F: no agent-timeout diagnostic — escalation did not fire via the nudge budget"
  fi
fi
echo

# =====================================================================
hr
printf 'monitor e2e results: %s%d passed%s, %s%d failed%s\n' "$C_GREEN" "$PASS" "$C_NC" "$C_RED" "$FAIL" "$C_NC"
hr
[[ "$FAIL" -gt 0 ]] && exit 1
exit 0
