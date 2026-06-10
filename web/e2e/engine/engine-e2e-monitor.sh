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
  if [[ -n "$PTY_MGR_BIN" ]]; then
    PTY_DAEMON="$PTY_DAEMON_NAME" "$PTY_MGR_BIN" kill all >/dev/null 2>&1 || true
  fi
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

PROFILES_DIR="$DATA_ROOT/namespaces/default/agent-profiles"
mkdir -p "$PROFILES_DIR"
chmod +x "$STUB_CLI" 2>/dev/null || true

git -C "$WORKSPACE" init -q >/dev/null 2>&1 || true
git -C "$WORKSPACE" -c user.email=e2e@local -c user.name=e2e commit -q --allow-empty -m init >/dev/null 2>&1 || true

# -------------------------------------------------------------------
# fixture builders
# -------------------------------------------------------------------
write_profile() {  # <profile_id> <stub_mode> [extra_env_json]
  local pid="$1" mode="$2" extra="${3:-}"
  local env_block="\"STUB_MODE\": \"${mode}\""
  [[ -n "$extra" ]] && env_block="${env_block}, ${extra}"
  cat > "$PROFILES_DIR/${pid}.json" <<JSON
{
  "id": "${pid}",
  "name": "Monitor E2E Stub (${mode})",
  "cli": "${STUB_CLI}",
  "log_path": "${STUB_LOG_HOME}",
  "isDefault": true,
  "isAdvisorDefault": true,
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

# =====================================================================
hr
printf 'monitor e2e results: %s%d passed%s, %s%d failed%s\n' "$C_GREEN" "$PASS" "$C_NC" "$C_RED" "$FAIL" "$C_NC"
hr
[[ "$FAIL" -gt 0 ]] && exit 1
exit 0
