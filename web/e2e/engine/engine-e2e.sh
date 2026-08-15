#!/usr/bin/env bash
# engine-e2e.sh — hermetic end-to-end proof of the Mentiko execution engine.
#
# This is the real thing the product is: it invokes `./bin/mentiko run <chain.json>`
# against the ACTUAL bash orchestration engine (lib/chain-runner.sh spawns a PTY
# agent session, lib/agent-functions.sh monitor-chain-agent watches it for
# AGENT_COMPLETE, typed completion advances/finishes the chain), and
# asserts on the run state, the file-based events, and cross-step output
# propagation — for BOTH a succeeding chain and a failing chain.
#
# It is fully hermetic: agents run a deterministic stub CLI (fixtures/stub-agent-cli.sh)
# wired in via an agent profile, so there is zero model-provider traffic, no API key,
# no paid inference, and no network beyond localhost. The data root is a throwaway
# temp dir (MENTIKO_GLOBAL_ROOT), and the PTY daemon is uniquely named so the test
# never touches a developer's ~/.mentiko or their dev pty sessions.
#
# Every chain run is wrapped in a hard timeout: a hung run FAILS the test rather
# than blocking forever.
#
# Usage:   web/e2e/engine/engine-e2e.sh
# Exit:    0 = all assertions passed, non-zero = failure (CI gate).

set -uo pipefail

# -------------------------------------------------------------------
# locate repo + a bash 4+ interpreter (the engine uses readarray/${var^^}/etc.)
# macOS system bash is 3.2; CI ubuntu bash is 5.x. Pick a 4+ bash for the engine.
# -------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
MENTIKO_BIN="$REPO_ROOT/bin/mentiko"
PTY_MGR_BIN_DEFAULT="$HOME/.pty-mgr/bin/pty-mgr"

pick_bash() {
  # prefer the running bash if it's 4+, else homebrew, else first 4+ on PATH.
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
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/mentiko-engine-e2e.XXXXXX")"
DATA_ROOT="$TMP_ROOT/data"
WORKSPACE="$TMP_ROOT/ws"
LOG_DIR="$TMP_ROOT/logs"
STUB_LOG_HOME="$TMP_ROOT/stub-log-home"   # bogus, non-empty log_path for profiles
RUN_LOG_DIR="$TMP_ROOT/run-logs"
mkdir -p "$DATA_ROOT" "$WORKSPACE" "$LOG_DIR" "$STUB_LOG_HOME" "$RUN_LOG_DIR"

# The PTY daemon is resolved after the isolated data root is exported below.
# It must use the same scoped derivation as typed cleanup; an arbitrary name
# would launch sessions on one daemon and ask completion to remove them from
# another.
PTY_DAEMON_NAME=""

# pty-mgr binary (the symlink bin/p points at it; resolve a usable one for cleanup).
PTY_MGR_BIN=""
if command -v pty-mgr >/dev/null 2>&1; then PTY_MGR_BIN="$(command -v pty-mgr)";
elif [[ -x "$PTY_MGR_BIN_DEFAULT" ]]; then PTY_MGR_BIN="$PTY_MGR_BIN_DEFAULT"; fi

cleanup() {
  # tear down sessions AND the private daemon (never other daemons) — a leaked
  # daemon holds every dead session's pty fds forever; enough leaked runs exhaust
  # the system pty pool. TMP_ROOT is kept on failure so engine logs survive.
  if [[ -n "$PTY_MGR_BIN" ]]; then
    PTY_DAEMON="$PTY_DAEMON_NAME" "$PTY_MGR_BIN" kill all >/dev/null 2>&1 || true
    PTY_DAEMON="$PTY_DAEMON_NAME" "$PTY_MGR_BIN" stop >/dev/null 2>&1 || true
  fi
  if [[ "${FAIL:-0}" -eq 0 ]]; then rm -rf "$TMP_ROOT" 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM

# the engine env every invocation shares. NOTE: we deliberately export
# MENTIKO_GLOBAL_ROOT (the data-root var config.sh honours) at a temp dir.
export MENTIKO_GLOBAL_ROOT="$DATA_ROOT"
export NAMESPACE_ID="default" ORG_ID="default"
PTY_DAEMON_NAME="$(
  env -u PTY_DAEMON \
    MENTIKO_CODE_ROOT="$REPO_ROOT" \
    MENTIKO_GLOBAL_ROOT="$MENTIKO_GLOBAL_ROOT" \
    NAMESPACE_ID="$NAMESPACE_ID" \
    ORG_ID="$ORG_ID" \
    node "$REPO_ROOT/lib/runner-runtime-paths.js" shell-exports \
    | sed -n "s/^export PTY_DAEMON='\([^']*\)'$/\1/p"
)"
if [[ -z "$PTY_DAEMON_NAME" ]]; then
  printf '%sFATAL: unable to resolve scoped PTY daemon%s\n' "$C_RED" "$C_NC"
  exit 2
fi
export PTY_DAEMON="$PTY_DAEMON_NAME"
export STUB_CLI="$SCRIPT_DIR/fixtures/stub-agent-cli.sh"
PROFILES_DIR="$DATA_ROOT/namespaces/default/agent-profiles"
mkdir -p "$PROFILES_DIR"
chmod +x "$STUB_CLI" 2>/dev/null || true

# git init the workspace (chain-runner snapshots git HEAD; a non-repo just warns,
# but a real repo exercises the diff-capture path too).
git -C "$WORKSPACE" init -q >/dev/null 2>&1 || true
git -C "$WORKSPACE" -c user.email=e2e@local -c user.name=e2e commit -q --allow-empty -m init >/dev/null 2>&1 || true

# -------------------------------------------------------------------
# fixture builders
# -------------------------------------------------------------------
# write an agent profile whose `cli` is the stub. log_path is set to a real,
# empty dir so the completion handler's conversation-capture (resolve_log_dir)
# returns a directory rather than a non-zero exit — see "ENGINE ODDITY" in the
# report; this is a harness-side workaround, not an engine change.
write_profile() {  # <profile_id> <stub_mode>
  local pid="$1" mode="$2"
  cat > "$PROFILES_DIR/${pid}.json" <<JSON
{
  "id": "${pid}",
  "name": "E2E Stub (${mode})",
  "cli": "${STUB_CLI}",
  "log_path": "${STUB_LOG_HOME}",
  "isDefault": $( [[ "$pid" == "stub-default" ]] && echo true || echo false ),
  "isAdvisorDefault": $( [[ "$pid" == "stub-default" ]] && echo true || echo false ),
  "env": { "STUB_MODE": "${mode}" }
}
JSON
}

# run a chain file through the REAL CLI, detached from this shell's stdout, with a
# hard wall-clock timeout. Returns the run dir on stdout.
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
  # newest run dir
  ls -dt "$DATA_ROOT/namespaces/default/runs/run-"* 2>/dev/null | head -1
}

# poll run.json until terminal, or fail on timeout. echoes final status.
poll_terminal() {  # <run_dir> <poll_timeout_s>
  local run_dir="$1" budget="${2:-90}" run_json="$1/run.json" st="" waited=0
  while [[ $waited -lt $budget ]]; do
    st="$(jq -r '.status // "unknown"' "$run_json" 2>/dev/null)"
    case "$st" in
      completed|complete|failed|stopped|cancelled) echo "$st"; return 0 ;;
    esac
    sleep 2; waited=$((waited+2))
  done
  echo "TIMEOUT(running after ${budget}s)"
  return 1
}

agent_status() {  # <run_dir> <agent_id>
  jq -r --arg id "$2" '.agents[]? | select(.id==$id) | .status // "absent"' "$1/run.json" 2>/dev/null
}

# look for an emitted event (active dir OR archive — completion archives events).
event_emitted() {  # <event_substring>
  local needle="$1" evdir="$DATA_ROOT/namespaces/default/events"
  if ls "$evdir"/*"$needle"*.event >/dev/null 2>&1; then return 0; fi
  if ls "$evdir"/archive/*"$needle"*.event >/dev/null 2>&1; then return 0; fi
  return 1
}

# =====================================================================
hr; printf '%smentiko ENGINE e2e%s — real bash engine, hermetic stub, isolated data root\n' "$C_YEL" "$C_NC"; hr
note "repo:        $REPO_ROOT"
note "engine bash: $ENGINE_BASH ($("$ENGINE_BASH" -c 'echo $BASH_VERSION'))"
note "data root:   $DATA_ROOT"
note "pty daemon:  $PTY_DAEMON_NAME"
note "stub cli:    $STUB_CLI"
[[ -n "$TIMEOUT_BIN" ]] || note "${C_YEL}warning: no 'timeout' binary found; hang protection relies on stub deadline only${C_NC}"
echo

# preflight: jq + bash version
command -v jq >/dev/null 2>&1 || { printf '%sFATAL: jq is required%s\n' "$C_RED" "$C_NC"; exit 2; }
if [[ "$("$ENGINE_BASH" -c 'echo ${BASH_VERSINFO:-0}')" -lt 4 ]]; then
  printf '%sFATAL: need bash 4+ to run the engine (got %s)%s\n' "$C_RED" "$("$ENGINE_BASH" --version | head -1)" "$C_NC"; exit 2
fi

# ---------------------------------------------------------------------
# SCENARIO 1 — SUCCESS: 2-step chain reaches terminal SUCCESS, events stream,
# step 2 sees step 1's output.
# ---------------------------------------------------------------------
printf '%s[1] success path — 2-step chain runs to completion%s\n' "$C_BLU" "$C_NC"
write_profile "stub-default" "complete"

CHAIN_OK="$TMP_ROOT/chain-success.json"
cat > "$CHAIN_OK" <<'JSON'
{
  "name": "e2e-engine-success",
  "description": "engine e2e success: two stub steps with output handoff",
  "version": "1.0",
  "config": {
    "monitor": true,
    "monitor_interval": 2,
    "max_rounds": 3,
    "session_prefix": "e2eok",
    "on_complete": "stop"
  },
  "agents": [
    { "id": "step1", "name": "Step One", "triggers": ["manual-start"], "emits": "step1-done",
      "prompt": "produce step 1 output" },
    { "id": "step2", "name": "Step Two", "triggers": ["step1-done"], "emits": "step2-done",
      "prompt": "consume step 1 output and finish" }
  ]
}
JSON

RUN_DIR_OK="$(run_chain "$CHAIN_OK" 90)"
if [[ -z "$RUN_DIR_OK" || ! -f "$RUN_DIR_OK/run.json" ]]; then
  fail "success: run object was created"
  printf '%sFATAL: no run.json produced; aborting%s\n' "$C_RED" "$C_NC"
  exit 1
fi
pass "success: run object created ($(basename "$RUN_DIR_OK"))"

FINAL_OK="$(poll_terminal "$RUN_DIR_OK" 110)"
note "success: terminal status = $FINAL_OK"
if [[ "$FINAL_OK" == "completed" || "$FINAL_OK" == "complete" ]]; then
  pass "success: run reached terminal SUCCESS state (completed)"
else
  fail "success: expected completed, got '$FINAL_OK'"
  note "run.json: $(jq -c '{status, agents:[.agents[]|{id,status}]}' "$RUN_DIR_OK/run.json" 2>/dev/null)"
fi

[[ "$(agent_status "$RUN_DIR_OK" step1)" == "complete" ]] && pass "success: step1 marked complete" || fail "success: step1 not complete (got '$(agent_status "$RUN_DIR_OK" step1)')"
[[ "$(agent_status "$RUN_DIR_OK" step2)" == "complete" ]] && pass "success: step2 marked complete" || fail "success: step2 not complete (got '$(agent_status "$RUN_DIR_OK" step2)')"

# events streamed to the data root's events location (one per step).
event_emitted "step1-done" && pass "success: step1-done event written to events dir" || fail "success: step1-done event missing"
event_emitted "step2-done" && pass "success: step2-done event written to events dir" || fail "success: step2-done event missing"

# agent/step lifecycle + completion artifacts present.
[[ -f "$RUN_DIR_OK/artifacts/step1-summary.json" ]] && pass "success: step1 summary artifact written" || fail "success: step1 summary artifact missing"
[[ -f "$RUN_DIR_OK/artifacts/step2-summary.json" ]] && pass "success: step2 summary artifact written" || fail "success: step2 summary artifact missing"

# output propagation: step2's summary references step1's marker output.
if jq -e '.executiveSummary | test("stub-output-from-step1")' "$RUN_DIR_OK/artifacts/step2-summary.json" >/dev/null 2>&1; then
  pass "success: step2 propagated step1 output (upstream marker observed)"
else
  fail "success: step2 did not observe step1 output"
  note "step2 summary: $(jq -rc '.executiveSummary' "$RUN_DIR_OK/artifacts/step2-summary.json" 2>/dev/null)"
fi
echo

# ---------------------------------------------------------------------
# SCENARIO 2 — FAILURE (crash): a step whose CLI exits non-zero before
# instructions. Run must reach terminal FAILED (not hang); downstream agent
# must NOT run.
# ---------------------------------------------------------------------
printf '%s[2] failure path (crashing CLI) — run terminates FAILED, not hung%s\n' "$C_BLU" "$C_NC"
write_profile "stub-default" "crash"   # default profile now crashes

CHAIN_CRASH="$TMP_ROOT/chain-crash.json"
cat > "$CHAIN_CRASH" <<'JSON'
{
  "name": "e2e-engine-fail-crash",
  "description": "engine e2e failure: first step's CLI crashes on startup",
  "version": "1.0",
  "config": {
    "monitor": true,
    "monitor_interval": 2,
    "max_rounds": 3,
    "session_prefix": "e2ecrash",
    "on_complete": "stop"
  },
  "agents": [
    { "id": "boom",  "name": "Boom",  "triggers": ["manual-start"], "emits": "boom-done",  "prompt": "this CLI crashes" },
    { "id": "after", "name": "After", "triggers": ["boom-done"],    "emits": "after-done", "prompt": "must never run" }
  ]
}
JSON

RUN_DIR_CRASH="$(run_chain "$CHAIN_CRASH" 60)"
if [[ -z "$RUN_DIR_CRASH" || ! -f "$RUN_DIR_CRASH/run.json" ]]; then
  fail "crash: run object was created"
else
  pass "crash: run object created ($(basename "$RUN_DIR_CRASH"))"
  FINAL_CRASH="$(poll_terminal "$RUN_DIR_CRASH" 45)"
  note "crash: terminal status = $FINAL_CRASH"
  if [[ "$FINAL_CRASH" == "failed" ]]; then
    pass "crash: run reached terminal FAILED state"
  elif [[ "$FINAL_CRASH" == TIMEOUT* ]]; then
    fail "crash: run HUNG (never reached terminal state) — $FINAL_CRASH"
  else
    fail "crash: expected failed, got '$FINAL_CRASH'"
  fi
  # error recorded
  if jq -e '.status_message // .agents[]?.lastMessage // ""
            | test("exited before instructions|exited before producing its completion event|fail";"i")' "$RUN_DIR_CRASH/run.json" >/dev/null 2>&1; then
    pass "crash: failure reason recorded on run"
  else
    note "crash: run.json = $(jq -c '{status, status_message, agents:[.agents[]|{id,status,lastMessage}]}' "$RUN_DIR_CRASH/run.json" 2>/dev/null)"
    # not fatal — the state file also records it; assert on state file instead
    if grep -qiE 'exited before instructions|exited before producing its completion event|^status: failed' "$DATA_ROOT/namespaces/default/state/"*.state 2>/dev/null; then
      pass "crash: failure reason recorded in state file"
    else
      fail "crash: no failure reason recorded"
    fi
  fi
  # downstream agent must not have launched
  AFTER_ST="$(agent_status "$RUN_DIR_CRASH" after)"
  [[ "$AFTER_ST" == "absent" || -z "$AFTER_ST" ]] && pass "crash: downstream 'after' agent never launched" || fail "crash: downstream 'after' agent ran (status '$AFTER_ST')"
fi
echo

# ---------------------------------------------------------------------
# SCENARIO 3 — FAILURE (quality gate): a step that COMPLETES (emits + AGENT_COMPLETE)
# but reports status "failed" in its summary. The completion handler's quality gate
# must fail the run, emit a failure artifact, and stop before the downstream agent.
# This proves the failure path also exercises the completion handler, not just the
# startup check.
# ---------------------------------------------------------------------
printf '%s[3] failure path (quality gate) — agent completes but reports failure%s\n' "$C_BLU" "$C_NC"
write_profile "stub-default" "fail-summary"

CHAIN_QG="$TMP_ROOT/chain-qg.json"
cat > "$CHAIN_QG" <<'JSON'
{
  "name": "e2e-engine-fail-gate",
  "description": "engine e2e failure: agent emits + completes but summary status is failed",
  "version": "1.0",
  "config": {
    "monitor": true,
    "monitor_interval": 2,
    "max_rounds": 3,
    "session_prefix": "e2eqg",
    "on_complete": "stop"
  },
  "agents": [
    { "id": "verifier", "name": "Verifier", "triggers": ["manual-start"], "emits": "verify-done", "prompt": "verify; reports failed" },
    { "id": "after",    "name": "After",    "triggers": ["verify-done"],  "emits": "after-done",  "prompt": "must never run" }
  ]
}
JSON

RUN_DIR_QG="$(run_chain "$CHAIN_QG" 90)"
if [[ -z "$RUN_DIR_QG" || ! -f "$RUN_DIR_QG/run.json" ]]; then
  fail "gate: run object was created"
else
  pass "gate: run object created ($(basename "$RUN_DIR_QG"))"
  FINAL_QG="$(poll_terminal "$RUN_DIR_QG" 90)"
  note "gate: terminal status = $FINAL_QG"
  if [[ "$FINAL_QG" == "failed" ]]; then
    pass "gate: run reached terminal FAILED state via quality gate"
  elif [[ "$FINAL_QG" == TIMEOUT* ]]; then
    fail "gate: run HUNG (never reached terminal state) — $FINAL_QG"
  else
    fail "gate: expected failed, got '$FINAL_QG'"
  fi
  # the agent DID emit its completion event before the gate failed the run.
  event_emitted "verify-done" && pass "gate: verify-done event emitted before gate failure" || fail "gate: verify-done event missing"
  # a machine-readable failure artifact exists.
  QUALITY_GATE_ARTIFACT="$RUN_DIR_QG/artifacts/triage-result.json"
  if jq -e '
      .schema == "generated-tasks/v1"
      and .event.name == "quality_gate.failed"
      and (.qualityGate.reason | type == "string" and length > 0)
    ' "$QUALITY_GATE_ARTIFACT" >/dev/null 2>&1; then
    pass "gate: quality-gate failure artifact written"
  else
    fail "gate: quality-gate failure artifact missing"
  fi
  # downstream must not run.
  AFTER_QG="$(agent_status "$RUN_DIR_QG" after)"
  [[ "$AFTER_QG" == "absent" || -z "$AFTER_QG" ]] && pass "gate: downstream 'after' agent never launched" || fail "gate: downstream 'after' agent ran (status '$AFTER_QG')"
fi
echo

# =====================================================================
hr
printf 'engine e2e results: %s%d passed%s, %s%d failed%s\n' "$C_GREEN" "$PASS" "$C_NC" "$C_RED" "$FAIL" "$C_NC"
hr
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
exit 0
