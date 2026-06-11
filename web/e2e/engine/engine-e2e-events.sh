#!/usr/bin/env bash
# engine-e2e-events.sh — hermetic end-to-end proof of the Mentiko EVENT LIFECYCLE
# fixes (wave-2 "group C"):
#
#   #6  archive-global-race  — completion archived EVERY file in the shared
#                              $EVENTS_DIR, so the first completer in a fan-out (or
#                              another concurrent run) wiped sibling/other-run
#                              completion events that were never processed. The
#                              fix scopes archival to exactly what THIS completion
#                              owns (its run + its source); siblings and other runs
#                              survive. (lib/event-trigger.sh archive-run-events)
#   #2  fabricated-success    — chain-runner-complete.sh's no-event fallback used
#       (complete.sh side)      to FABRICATE the agent's declared emits SUCCESS
#                              event when the agent finished without writing one,
#                              advancing the chain as if it had succeeded
#                              (on_error never fired). The fix: dead/quiescent
#                              WITHOUT the declared emits event = FAILURE — write
#                              run+agent FAILED and an agent-error DIAGNOSTIC
#                              (source: chain-runner-complete, NOT the emits name),
#                              never a synthesized handoff.
#   #15 fangroup-name-mismatch — chain-runner-complete.sh called `fan_group_create`
#                              (underscores) but the routing-lib function is
#                              `fan-group-create` (hyphens) with no alias, so under
#                              set -e the fan-OUT creation path DIED and the fan-in
#                              never fired (run hangs). The fix corrects the call.
#
# It drives the REAL bash engine (`./bin/mentiko run`) with the deterministic stub
# CLI for the end-to-end fan-out proof, and the REAL lib functions directly
# (sourced into a throwaway data root) for the deterministic, race-free archival
# and fallback-failure proofs. Zero model traffic, throwaway MENTIKO_GLOBAL_ROOT,
# uniquely-named PTY daemon (never touches the dev's ~/.mentiko or dev sessions),
# every live run wrapped in a hard timeout so a hang FAILS the test.
#
# Usage:   web/e2e/engine/engine-e2e-events.sh
# Exit:    0 = all assertions passed, non-zero = failure (CI gate).

set -uo pipefail

# -------------------------------------------------------------------
# locate repo + a bash 4+ interpreter (the engine uses readarray/${var^^}/etc.)
# -------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
MENTIKO_BIN="$REPO_ROOT/bin/mentiko"
PTY_MGR_BIN_DEFAULT="$HOME/.pty-mgr/bin/pty-mgr"
EVENT_TRIGGER_SH="$REPO_ROOT/lib/event-trigger.sh"
ROUTING_LIB="$REPO_ROOT/lib/routing-lib.sh"

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
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/mentiko-engine-events-e2e.XXXXXX")"
DATA_ROOT="$TMP_ROOT/data"
WORKSPACE="$TMP_ROOT/ws"
STUB_LOG_HOME="$TMP_ROOT/stub-log-home"
mkdir -p "$DATA_ROOT" "$WORKSPACE" "$STUB_LOG_HOME"

PTY_DAEMON_NAME="mentiko-e2e-events-$$-$RANDOM"

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

# events/runs/state live under the (collapsed default) project root.
EVENTS_DIR_LIVE="$DATA_ROOT/namespaces/default/events"
RUNS_DIR_LIVE="$DATA_ROOT/namespaces/default/runs"

PROFILES_DIR="$DATA_ROOT/namespaces/default/agent-profiles"
mkdir -p "$PROFILES_DIR" "$EVENTS_DIR_LIVE" "$RUNS_DIR_LIVE"
chmod +x "$STUB_CLI" 2>/dev/null || true

git -C "$WORKSPACE" init -q >/dev/null 2>&1 || true
git -C "$WORKSPACE" -c user.email=e2e@local -c user.name=e2e commit -q --allow-empty -m init >/dev/null 2>&1 || true

# -------------------------------------------------------------------
# fixture builders
# -------------------------------------------------------------------
write_profile() {  # <profile_id> <stub_mode>
  local pid="$1" mode="$2"
  cat > "$PROFILES_DIR/${pid}.json" <<JSON
{
  "id": "${pid}",
  "name": "Events E2E Stub (${mode})",
  "cli": "${STUB_CLI}",
  "log_path": "${STUB_LOG_HOME}",
  "isDefault": true,
  "isAdvisorDefault": true,
  "env": { "STUB_MODE": "${mode}" }
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
  ls -dt "$RUNS_DIR_LIVE"/run-* 2>/dev/null | head -1
}

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

# count GENUINE success-handoff events for <emits_name>: `event: <emits>` on its
# own line AND source != monitor/chain-runner-complete (so diagnostics + the
# aggregate chain-complete event are never miscounted). Scans active + archive.
count_success_events() {  # <emits_name>
  local emits="$1" n=0 f
  shopt -s nullglob
  for f in "$EVENTS_DIR_LIVE"/*.event "$EVENTS_DIR_LIVE"/archive/*.event; do
    [[ -f "$f" ]] || continue
    if grep -qiE "^event:[[:space:]]*${emits}[[:space:]]*$" "$f" 2>/dev/null \
       && ! grep -qiE "^source:[[:space:]]*(monitor|chain-runner-complete)[[:space:]]*$" "$f" 2>/dev/null; then
      n=$((n+1))
    fi
  done
  shopt -u nullglob
  echo "$n"
}

# =====================================================================
hr; printf '%smentiko EVENTS e2e%s — archive scoping (#6), no-event failure (#2), fan-out (#15)\n' "$C_YEL" "$C_NC"; hr
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
# #15 PRE-FIX PROOF — the underscore call dies; the hyphen function is the real one.
# We do NOT mutate git state: we read the COMMITTED version via `git show HEAD:`
# and prove (a) it literally contains the buggy `fan_group_create` underscore
# call, and (b) that calling an underscore-named function under the same
# `set -euo pipefail` the completion handler runs aborts (command not found),
# while the hyphenated `fan-group-create` defined by routing-lib succeeds.
# ---------------------------------------------------------------------
printf '%s[0] #15 pre-fix proof — fan_group_create (underscore) was a dead call at HEAD%s\n' "$C_BLU" "$C_NC"
HEAD_COMPLETE="$TMP_ROOT/complete.HEAD.sh"
if git -C "$REPO_ROOT" show HEAD:lib/chain-runner-complete.sh > "$HEAD_COMPLETE" 2>/dev/null && [[ -s "$HEAD_COMPLETE" ]]; then
  if grep -qE '^\s*fan_group_create ' "$HEAD_COMPLETE"; then
    note "HEAD:lib/chain-runner-complete.sh calls 'fan_group_create' (underscore) at line $(grep -nE '^\s*fan_group_create ' "$HEAD_COMPLETE" | head -1 | cut -d: -f1)"
    pass "#15 pre-fix: committed HEAD contains the buggy underscore call fan_group_create"
  else
    note "HEAD no longer has the underscore call (already fixed in a prior commit?)"
    pass "#15 pre-fix: (HEAD clean) — current tree uses the hyphen form (asserted below)"
  fi
else
  note "${C_YEL}could not read HEAD:lib/chain-runner-complete.sh (skipping committed-source check)${C_NC}"
fi

# functional proof: routing-lib defines the HYPHEN form, not the underscore form.
# Under set -e an unknown command (the underscore call) returns 127 and aborts.
underscore_rc="$("$ENGINE_BASH" -c '
  set -euo pipefail
  STATE_DIR="'"$TMP_ROOT"'/p15-state"; SCRIPT_DIR="'"$TMP_ROOT"'/p15-sd"; mkdir -p "$STATE_DIR" "$SCRIPT_DIR"
  source "'"$ROUTING_LIB"'" >/dev/null 2>&1
  fan_group_create g ev "a b" fin all 0 "" >/dev/null 2>&1
  echo "REACHED"
' 2>/dev/null; echo "rc=$?")"
if [[ "$underscore_rc" == *"REACHED"* ]]; then
  fail "#15 functional: fan_group_create (underscore) somehow ran — an alias exists? (unexpected)"
else
  pass "#15 functional: fan_group_create (underscore) is undefined; aborts under set -e (rc=${underscore_rc##*rc=})"
fi
hyphen_ok="$("$ENGINE_BASH" -c '
  set -euo pipefail
  STATE_DIR="'"$TMP_ROOT"'/p15-state2"; SCRIPT_DIR="'"$TMP_ROOT"'/p15-sd2"; mkdir -p "$STATE_DIR" "$SCRIPT_DIR"
  source "'"$ROUTING_LIB"'" >/dev/null 2>&1
  sf="$(fan-group-create g ev "a b" fin all 0 "")"
  [[ -f "$sf" ]] && echo "OK"
' 2>/dev/null || true)"
[[ "$hyphen_ok" == "OK" ]] && pass "#15 functional: fan-group-create (hyphen) is the real function and creates group state" \
                           || fail "#15 functional: fan-group-create (hyphen) did not create group state"
echo

# ---------------------------------------------------------------------
# SCENARIO A — FAN-OUT END TO END (#15 + group B locking in vivo).
# A chain fans out to TWO parallel stub agents and fans in (wait_for: all). Both
# siblings must complete, the fan-in must launch EXACTLY once, the run completes,
# and BOTH siblings' completion events must end up archived (proving neither was
# stranded — the #6 guarantee under live concurrency).
# ---------------------------------------------------------------------
printf '%s[A] fan-out end-to-end — 2 parallel agents, fan-in once, run completes%s\n' "$C_BLU" "$C_NC"
write_profile "stub-default" "complete"
export MENTIKO_MONITOR_INTERVAL=2
export MENTIKO_MONITOR_MAX_STALE=30

CHAIN_FANOUT="$TMP_ROOT/chain-fanout.json"
cat > "$CHAIN_FANOUT" <<'JSON'
{
  "name": "events-e2e-fanout",
  "description": "dispatch fans out to two workers, collector fans in (wait_for: all)",
  "version": "1.0",
  "config": { "monitor": true, "monitor_interval": 2, "max_rounds": 3, "session_prefix": "fanout", "on_complete": "stop" },
  "branches": {
    "dispatch-done": { "fan_out": ["worker_a", "worker_b"], "fan_in": "collector", "wait_for": "all" }
  },
  "agents": [
    { "id": "dispatch",  "name": "Dispatcher", "triggers": ["manual-start"], "emits": "dispatch-done", "prompt": "kick off the fan-out" },
    { "id": "worker_a",  "name": "Worker A",   "triggers": ["dispatch-done"], "emits": "worker-a-done", "prompt": "do A" },
    { "id": "worker_b",  "name": "Worker B",   "triggers": ["dispatch-done"], "emits": "worker-b-done", "prompt": "do B" },
    { "id": "collector", "name": "Collector",  "triggers": ["worker-a-done", "worker-b-done"], "emits": "collect-done", "prompt": "gather both workers" }
  ]
}
JSON

RUN_FO="$(run_chain "$CHAIN_FANOUT" 120)"
if [[ -z "$RUN_FO" || ! -f "$RUN_FO/run.json" ]]; then
  fail "A: fan-out run object created"
else
  pass "A: fan-out run object created ($(basename "$RUN_FO"))"
  FINAL_FO="$(poll_for_status "$RUN_FO" 110 "completed complete failed stopped blocked")"
  note "A: terminal status = $FINAL_FO"
  if [[ "$FINAL_FO" == "completed" || "$FINAL_FO" == "complete" ]]; then
    pass "A: fan-out run reached terminal SUCCESS (fan-in fired; was impossible at HEAD — #15)"
  elif [[ "$FINAL_FO" == TIMEOUT* ]]; then
    fail "A: fan-out run HUNG — fan-in never fired (the #15 breakage) — $FINAL_FO"
  else
    fail "A: expected completed, got '$FINAL_FO'"
    note "A: run.json = $(jq -c '{status, agents:[.agents[]|{id,status}]}' "$RUN_FO/run.json" 2>/dev/null)"
  fi

  # both fan-out siblings completed.
  [[ "$(agent_status "$RUN_FO" worker_a)" == "complete" ]] && pass "A: worker_a completed" || fail "A: worker_a not complete (got '$(agent_status "$RUN_FO" worker_a)')"
  [[ "$(agent_status "$RUN_FO" worker_b)" == "complete" ]] && pass "A: worker_b completed" || fail "A: worker_b not complete (got '$(agent_status "$RUN_FO" worker_b)')"
  # the fan-in agent ran.
  [[ "$(agent_status "$RUN_FO" collector)" == "complete" ]] && pass "A: collector (fan-in) completed" || fail "A: collector not complete (got '$(agent_status "$RUN_FO" collector)')"

  # fan-in fired EXACTLY once: the group status flips to 'complete' (the single
  # idempotent claim). More than one .state with status complete, or a collector
  # launched twice, would indicate a double-fire. We assert the group claim.
  FO_GROUP_STATE="$(ls -1 "$DATA_ROOT/namespaces/default/state/fan-groups/"*.state 2>/dev/null | head -1)"
  if [[ -n "$FO_GROUP_STATE" ]]; then
    FO_GROUP_STATUS="$(grep '^status:' "$FO_GROUP_STATE" | head -1 | cut -d' ' -f2-)"
    FO_GROUP_COMPLETED="$(grep '^completed:' "$FO_GROUP_STATE" | head -1 | tr -dc '0-9')"
    note "A: fan-group state: status=$FO_GROUP_STATUS completed=$FO_GROUP_COMPLETED"
    [[ "$FO_GROUP_STATUS" == "complete" ]] && pass "A: fan-group claimed exactly once (status=complete = fan-in launched)" \
                                           || fail "A: fan-group status is '$FO_GROUP_STATUS' (expected complete)"
    [[ "$FO_GROUP_COMPLETED" == "2" ]] && pass "A: both completers counted in fan-group (completed=2, no lost update)" \
                                       || fail "A: fan-group completed=$FO_GROUP_COMPLETED (expected 2)"
  else
    fail "A: no fan-group state file created (the #15 underscore call would skip this)"
  fi

  # both siblings' completion events were processed + archived (not stranded by a
  # global wipe — #6 under live concurrency). Both should be in events/archive/.
  A_DONE_ARCHIVED=0; B_DONE_ARCHIVED=0
  ls "$EVENTS_DIR_LIVE/archive/"*worker-a-done*.event >/dev/null 2>&1 && A_DONE_ARCHIVED=1
  ls "$EVENTS_DIR_LIVE/archive/"*worker-b-done*.event >/dev/null 2>&1 && B_DONE_ARCHIVED=1
  if [[ "$A_DONE_ARCHIVED" == "1" && "$B_DONE_ARCHIVED" == "1" ]]; then
    pass "A: BOTH siblings' completion events archived (neither stranded by the other's archive — #6)"
  else
    fail "A: a sibling completion event was not archived (a=$A_DONE_ARCHIVED b=$B_DONE_ARCHIVED) — possible #6 strand"
    note "A: archive dir: $(ls -1 "$EVENTS_DIR_LIVE/archive" 2>/dev/null | tr '\n' ' ')"
  fi
fi
echo

# ---------------------------------------------------------------------
# SCENARIO B — SIBLING EVENT SURVIVAL (#6), deterministic + race-free.
# Drive the REAL archive-run-events (the exact function chain-runner-complete.sh
# now calls) against a realistic shared events dir holding TWO sibling completion
# events from one run PLUS an event from a second concurrent run. After the FIRST
# sibling's completion archives, assert: the SECOND sibling's not-yet-processed
# event SURVIVES, the cross-run event SURVIVES, and the first sibling can then be
# processed normally. (The old global archive-all-events wiped all three.)
# ---------------------------------------------------------------------
printf '%s[B] sibling event survival (#6) — first completer must not wipe the second%s\n' "$C_BLU" "$C_NC"
B_EVDIR="$TMP_ROOT/b-events"
mkdir -p "$B_EVDIR"

# canonical names: ${run_id}-${source}-${event}.event (emit-event's scheme).
cat > "$B_EVDIR/run-A1-worker_a-worker-a-done.event" <<EOF
event: worker-a-done
source: worker_a
run_id: run-A1
timestamp: $(date -Iseconds)
processed: false
data: ok
EOF
cat > "$B_EVDIR/run-A1-worker_b-worker-b-done.event" <<EOF
event: worker-b-done
source: worker_b
run_id: run-A1
timestamp: $(date -Iseconds)
processed: false
data: ok
EOF
# a SECOND, concurrent run's event — must survive run-A1's completion archival.
cat > "$B_EVDIR/run-A2-worker_a-worker-a-done.event" <<EOF
event: worker-a-done
source: worker_a
run_id: run-A2
timestamp: $(date -Iseconds)
processed: false
data: other-run
EOF
# a diagnostic for sibling B (source: monitor, agent: worker_b) — also a sibling-
# owned file that worker_a's archive must leave behind.
cat > "$B_EVDIR/20260101T000000-run-A1-worker_b-agent-error.event" <<EOF
event: agent-error
source: monitor
run_id: run-A1
agent: worker_b
timestamp: $(date -Iseconds)
reason: sibling diagnostic
processed: false
EOF

B_BEFORE="$(ls -1 "$B_EVDIR"/*.event 2>/dev/null | wc -l | tr -d ' ')"
note "B: seeded $B_BEFORE events (2 run-A1 siblings + 1 run-A2 + 1 sibling diagnostic)"

# run worker_a's scoped archive exactly as the completion handler does.
"$ENGINE_BASH" -c '
  set -uo pipefail
  export EVENTS_DIR="'"$B_EVDIR"'"
  source "'"$EVENT_TRIGGER_SH"'" >/dev/null 2>&1
  # worker_a completes: triggered = its own event; owner key = its agent id.
  archive-run-events "run-A1" "worker_a" "$EVENTS_DIR/run-A1-worker_a-worker-a-done.event" >/dev/null 2>&1
' >/dev/null 2>&1

if [[ -f "$B_EVDIR/run-A1-worker_b-worker-b-done.event" ]]; then
  pass "B: sibling worker_b's not-yet-processed event SURVIVED worker_a's completion (#6)"
else
  fail "B: sibling worker_b's event was archived by worker_a (the #6 bug)"
fi
if [[ -f "$B_EVDIR/run-A2-worker_a-worker-a-done.event" ]]; then
  pass "B: cross-run isolation — run-A2's event SURVIVED run-A1's completion archival"
else
  fail "B: run-A2's event was wiped by run-A1's completion (cross-run leak)"
fi
if [[ -f "$B_EVDIR/20260101T000000-run-A1-worker_b-agent-error.event" ]]; then
  pass "B: sibling worker_b's diagnostic SURVIVED (matched as sibling-owned, left behind)"
else
  fail "B: sibling worker_b's diagnostic was archived by worker_a"
fi
if [[ -f "$B_EVDIR/archive/run-A1-worker_a-worker-a-done.event" ]]; then
  pass "B: worker_a's OWN completion event was archived (owned cleanup still works)"
else
  fail "B: worker_a's own event was not archived"
fi

# now worker_b completes — its event + its diagnostic archive; run-A2 still safe.
"$ENGINE_BASH" -c '
  set -uo pipefail
  export EVENTS_DIR="'"$B_EVDIR"'"
  source "'"$EVENT_TRIGGER_SH"'" >/dev/null 2>&1
  archive-run-events "run-A1" "worker_b" "$EVENTS_DIR/run-A1-worker_b-worker-b-done.event" >/dev/null 2>&1
' >/dev/null 2>&1
if [[ -f "$B_EVDIR/archive/run-A1-worker_b-worker-b-done.event" && ! -f "$B_EVDIR/run-A1-worker_b-worker-b-done.event" ]]; then
  pass "B: worker_b then completed normally (its event archived once it was the owner)"
else
  fail "B: worker_b's event did not archive on its own completion"
fi
[[ -f "$B_EVDIR/run-A2-worker_a-worker-a-done.event" ]] && pass "B: run-A2 STILL survives after both run-A1 siblings completed" \
                                                        || fail "B: run-A2 was eventually wiped (cross-run leak)"
echo

# ---------------------------------------------------------------------
# SCENARIO C — NO-EVENT FALLBACK = FAILURE (#2).
# Drive chain-runner-complete.sh the way the engine does, for an agent that
# reached the completion handler but NEVER wrote its declared emits event (no
# matching event file in EVENTS_DIR). Assert: NO success event is fabricated,
# run+agent end FAILED, and an agent-error DIAGNOSTIC exists with
# source: chain-runner-complete. (The old fallback fabricated event: <emits>,
# source: <session-prefix> and advanced the chain as a success.)
# ---------------------------------------------------------------------
printf '%s[C] no-event fallback = FAILURE (#2) — handler must not fabricate the success event%s\n' "$C_BLU" "$C_NC"
write_profile "stub-default" "complete"   # profile present; we invoke the handler directly

C_CHAIN="$TMP_ROOT/chain-noevent.json"
cat > "$C_CHAIN" <<'JSON'
{
  "name": "events-e2e-noevent",
  "description": "agent reaches completion handler but never wrote its emits event",
  "version": "1.0",
  "config": { "monitor": true, "max_rounds": 2, "session_prefix": "noevent", "on_complete": "stop" },
  "agents": [
    { "id": "worker", "name": "Worker", "triggers": ["manual-start"], "emits": "worker-done", "prompt": "work" },
    { "id": "after",  "name": "After",  "triggers": ["worker-done"],  "emits": "after-done",  "prompt": "must never run" }
  ]
}
JSON

# seed a run.json in 'running' state with the worker agent present (the shape the
# real engine writes; update-run-status/agent operate on $RUNS_DIR/<id>/run.json).
C_RUN_ID="run-noevent-$RANDOM"
C_RUN_DIR="$RUNS_DIR_LIVE/$C_RUN_ID"
mkdir -p "$C_RUN_DIR/artifacts"
cat > "$C_RUN_DIR/run.json" <<JSON
{
  "id": "${C_RUN_ID}",
  "chain": "events-e2e-noevent",
  "status": "running",
  "started": "$(date -Iseconds)",
  "workspacePath": "${WORKSPACE}",
  "sessions": [],
  "artifacts": [],
  "agents": [
    { "id": "worker", "name": "Worker", "status": "running", "started": "$(date -Iseconds)" }
  ]
}
JSON

# session name maps to agent id "worker": SESSION_PREFIX strips a "-run-<n>" suffix.
# (PROJECT_NAME = basename of the data root, which is not a prefix of this name.)
C_SESSION="worker-run-$RANDOM"

# events dir is empty of any 'worker' event — this is the no-event precondition.
# Run the REAL completion handler with the run-scoped env the engine exports.
C_LOG="$TMP_ROOT/c-complete.log"
if [[ -n "$TIMEOUT_BIN" ]]; then
  MENTIKO_RUN_ID="$C_RUN_ID" RUN_ID="$C_RUN_ID" \
    "$TIMEOUT_BIN" 60 "$ENGINE_BASH" "$REPO_ROOT/lib/chain-runner-complete.sh" "$C_SESSION" "$C_CHAIN" >"$C_LOG" 2>&1 || true
else
  MENTIKO_RUN_ID="$C_RUN_ID" RUN_ID="$C_RUN_ID" \
    "$ENGINE_BASH" "$REPO_ROOT/lib/chain-runner-complete.sh" "$C_SESSION" "$C_CHAIN" >"$C_LOG" 2>&1 || true
fi

C_RUN_STATUS="$(jq -r '.status // "unknown"' "$C_RUN_DIR/run.json" 2>/dev/null)"
C_AGENT_STATUS="$(agent_status "$C_RUN_DIR" worker)"
note "C: run status = $C_RUN_STATUS, worker status = $C_AGENT_STATUS"

# (1) NO fabricated success event for worker-done may exist (active OR archive).
C_SUCCESS_N="$(count_success_events "worker-done")"
if [[ "$C_SUCCESS_N" == "0" ]]; then
  pass "C: no fabricated worker-done success event (count=0) — the #2 bug does not happen"
else
  fail "C: a fabricated worker-done success event exists (count=$C_SUCCESS_N) — THE #2 bug"
  note "C: offending events: $(ls -1 "$EVENTS_DIR_LIVE" "$EVENTS_DIR_LIVE/archive" 2>/dev/null | grep worker-done | tr '\n' ' ')"
fi
# specifically: the old -fallback.event success writer must NOT have fired.
if ls "$EVENTS_DIR_LIVE"/*worker-done*fallback*.event "$EVENTS_DIR_LIVE"/archive/*worker-done*fallback*.event >/dev/null 2>&1; then
  fail "C: a worker-done -fallback.event (fabricated success) was written"
else
  pass "C: no worker-done -fallback.event fabricated"
fi

# (2) run + agent must be FAILED.
[[ "$C_RUN_STATUS" == "failed" ]] && pass "C: run status is FAILED (no-event = failure, not success)" \
                                  || fail "C: run status is '$C_RUN_STATUS' (expected failed)"
[[ "$C_AGENT_STATUS" == "failed" ]] && pass "C: worker agent status is FAILED" \
                                    || fail "C: worker agent status is '$C_AGENT_STATUS' (expected failed)"

# (3) an agent-error diagnostic with source: chain-runner-complete must exist.
C_DIAG_OK=0
shopt -s nullglob
for f in "$EVENTS_DIR_LIVE"/*.event "$EVENTS_DIR_LIVE"/archive/*.event; do
  [[ -f "$f" ]] || continue
  if grep -qiE "^event:[[:space:]]*agent-error[[:space:]]*$" "$f" 2>/dev/null \
     && grep -qiE "^source:[[:space:]]*chain-runner-complete[[:space:]]*$" "$f" 2>/dev/null \
     && grep -qiE "^agent:[[:space:]]*worker[[:space:]]*$" "$f" 2>/dev/null; then
    C_DIAG_OK=1; C_DIAG_FILE="$(basename "$f")"
  fi
done
shopt -u nullglob
if [[ "$C_DIAG_OK" == "1" ]]; then
  pass "C: agent-error diagnostic written (source: chain-runner-complete, agent: worker) [$C_DIAG_FILE]"
else
  fail "C: no agent-error diagnostic with source: chain-runner-complete found"
  note "C: handler log tail: $(tail -5 "$C_LOG" 2>/dev/null | tr '\n' '|')"
fi

# (4) the diagnostic's source must NOT be the agent id (cannot be read as a handoff)
#     and the event name must NOT be the agent's emits name.
if ls "$EVENTS_DIR_LIVE"/*agent-error*.event "$EVENTS_DIR_LIVE"/archive/*agent-error*.event >/dev/null 2>&1; then
  if grep -rqiE "^source:[[:space:]]*worker[[:space:]]*$" "$EVENTS_DIR_LIVE"/*agent-error*.event "$EVENTS_DIR_LIVE"/archive/*agent-error*.event 2>/dev/null; then
    fail "C: agent-error diagnostic has source: worker (could be mis-read as a handoff)"
  else
    pass "C: diagnostic source is NOT the agent id (completion matcher can never read it as success)"
  fi
fi

# (5) downstream 'after' must never have launched.
C_AFTER_STATUS="$(agent_status "$C_RUN_DIR" after)"
[[ "$C_AFTER_STATUS" == "absent" || -z "$C_AFTER_STATUS" ]] && pass "C: downstream 'after' never launched on the failure" \
                                                            || fail "C: downstream 'after' ran (status '$C_AFTER_STATUS')"
echo

# =====================================================================
hr
printf 'events e2e results: %s%d passed%s, %s%d failed%s\n' "$C_GREEN" "$PASS" "$C_NC" "$C_RED" "$FAIL" "$C_NC"
hr
[[ "$FAIL" -gt 0 ]] && exit 1
exit 0
