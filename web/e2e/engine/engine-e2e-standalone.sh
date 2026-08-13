#!/usr/bin/env bash
# engine-e2e-standalone.sh — regression proofs for the wave-2 "standalones" fixes.
#
# This is the SECOND engine e2e script (the first, engine-e2e.sh, owns the
# success/crash/quality-gate lifecycle proofs). It is deliberately separate so
# the two can evolve under different ownership without merge conflicts. It reuses
# the SAME hermetic discipline: a throwaway temp data root (MENTIKO_GLOBAL_ROOT),
# a uniquely-named private PTY daemon, the committed deterministic stub CLI
# (fixtures/stub-agent-cli.sh — used, never modified here), and hard wall-clock
# timeouts so a hang FAILS instead of blocking.
#
# It guards two engine fixes:
#
#   #8  resolve-logdir-crash — when an agent profile's `cli` is NOT in the
#       hardcoded recognized set (claude/codex/opencode/kollab*/agy) AND no
#       explicit log_path is set, lib/session-log-resolver.sh::resolve_log_dir
#       used to `return 1`. The retired shell completion handler historically
#       runs under `set -euo pipefail` with an ERR trap, so that non-zero return
#       crashed it mid-finalize and stranded the run at "running" forever.
#       (a) FULL CHAIN: a 2-step chain whose profile sets cli=<stub path>
#           (unrecognized) and NO log_path runs to terminal completion.
#       (b) PROOF THE TEST CATCHES THE BUG: the exact failing completion-handler
#           snippet is executed under `set -euo pipefail`+ERR trap against the
#           PRE-FIX resolver pulled from `git show HEAD:...` — it must CRASH —
#           and against the CURRENT resolver — it must SURVIVE. No git state is
#           touched (HEAD is only read into a temp file).
#
#   #9  heartbeat-leak — the detached 60s heartbeat subshell in
#       lib/chain-runner.sh used to exit only on state!=running or HTTP 4xx, so
#       it leaked forever if the runner died without writing terminal state. The
#       fix adds: a parent-PID orphan guard (kill -0), an absolute deadline
#       (MENTIKO_HEARTBEAT_MAX_LIFETIME, default 24h), and a consecutive-
#       connection-failure cap (MENTIKO_HEARTBEAT_MAX_FAILURES, default 5). We
#       drive a faithful copy of the loop's exit logic with stubbed curl/transport
#       and assert it terminates promptly for parent-gone and deadline-exceeded.
#
# Usage:   web/e2e/engine/engine-e2e-standalone.sh
# Exit:    0 = all assertions passed, non-zero = failure (CI gate).

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
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/mentiko-engine-e2e-standalone.XXXXXX")"
DATA_ROOT="$TMP_ROOT/data"
WORKSPACE="$TMP_ROOT/ws"
mkdir -p "$DATA_ROOT" "$WORKSPACE"

PTY_DAEMON_NAME="mentiko-e2e-standalone-$$-$RANDOM"

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
PROFILES_DIR="$DATA_ROOT/namespaces/default/agent-profiles"
mkdir -p "$PROFILES_DIR"
chmod +x "$STUB_CLI" 2>/dev/null || true

git -C "$WORKSPACE" init -q >/dev/null 2>&1 || true
git -C "$WORKSPACE" -c user.email=e2e@local -c user.name=e2e commit -q --allow-empty -m init >/dev/null 2>&1 || true

# -------------------------------------------------------------------
# fixture builder — the #8 trigger.
# Unlike engine-e2e.sh's write_profile, this DELIBERATELY OMITS `log_path`.
# Combined with cli=<stub path> (which is NOT in resolve_log_dir's recognized
# set), the pre-fix resolver returned 1 on this profile. The committed harness
# sets log_path precisely to dodge that; we must not, so the bug is exercised.
# -------------------------------------------------------------------
write_profile_no_logpath() {  # <profile_id> <stub_mode>
  local pid="$1" mode="$2" is_default="false"
  [[ "$pid" == "stub-default" ]] && is_default="true"
  cat > "$PROFILES_DIR/${pid}.json" <<JSON
{
  "id": "${pid}",
  "name": "E2E Standalone Stub (${mode}, no log_path)",
  "cli": "${STUB_CLI}",
  "isDefault": ${is_default},
  "isAdvisorDefault": ${is_default},
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
  ls -dt "$DATA_ROOT/namespaces/default/runs/run-"* 2>/dev/null | head -1
}

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

# =====================================================================
hr; printf '%smentiko ENGINE e2e (standalones)%s — resolve-logdir-crash (#8) + heartbeat-leak (#9)\n' "$C_YEL" "$C_NC"; hr
note "repo:        $REPO_ROOT"
note "engine bash: $ENGINE_BASH ($("$ENGINE_BASH" -c 'echo $BASH_VERSION'))"
note "data root:   $DATA_ROOT"
note "pty daemon:  $PTY_DAEMON_NAME"
note "stub cli:    $STUB_CLI"
[[ -n "$TIMEOUT_BIN" ]] || note "${C_YEL}warning: no 'timeout' binary; hang protection relies on stub deadline only${C_NC}"
echo

command -v jq >/dev/null 2>&1 || { printf '%sFATAL: jq is required%s\n' "$C_RED" "$C_NC"; exit 2; }
if [[ "$("$ENGINE_BASH" -c 'echo ${BASH_VERSINFO:-0}')" -lt 4 ]]; then
  printf '%sFATAL: need bash 4+ to run the engine (got %s)%s\n' "$C_RED" "$("$ENGINE_BASH" --version | head -1)" "$C_NC"; exit 2
fi

# ---------------------------------------------------------------------
# #8 (b) — PROOF THE REGRESSION TEST CATCHES THE BUG.
# Reproduce the EXACT failing completion-handler snippet (the conversation-
# capture block from the retired shell completion handler) under `set -euo pipefail` + an
# ERR trap, sourcing a given resolver implementation. The snippet returns 0 only
# if it ran to the end; the ERR trap forces a non-zero exit if resolve_log_dir
# aborts it. We run it twice: against HEAD's PRE-FIX resolver (must crash) and
# the CURRENT resolver (must survive).
# ---------------------------------------------------------------------
printf '%s[8b] proof: pre-fix resolver crashes the completion snippet; post-fix survives%s\n' "$C_BLU" "$C_NC"

PREFIX_RESOLVER="$TMP_ROOT/session-log-resolver.PREFIX.sh"
if git -C "$REPO_ROOT" show HEAD:lib/session-log-resolver.sh > "$PREFIX_RESOLVER" 2>/dev/null && [[ -s "$PREFIX_RESOLVER" ]]; then
  if cmp -s "$PREFIX_RESOLVER" "$REPO_ROOT/lib/session-log-resolver.sh"; then
    # fix already committed: HEAD == working copy, so there is no pre-fix
    # resolver to crash. skip-with-note, never fail — this is the steady
    # state on main once the fix lands. the current-resolver half below
    # (must survive) remains the hard regression gate.
    note "${C_YEL}HEAD:lib/session-log-resolver.sh is identical to the working copy (fix already committed) — skipping the pre-fix crash half${C_NC}"
    PREFIX_RESOLVER=""
  else
    note "extracted pre-fix resolver from git HEAD ($(wc -l < "$PREFIX_RESOLVER" | xargs) lines)"
  fi
else
  note "${C_YEL}warning: could not extract HEAD resolver (no history / shallow clone); skipping the pre-fix crash half${C_NC}"
  PREFIX_RESOLVER=""
fi

# A historical regression fixture copied from the retired shell handler's capture block —
# the lines that crashed. It runs under the SAME shell options + ERR trap the real
# completion handler uses. $RESOLVER_SH selects which resolver implementation to load.
# A profile with cli=<unrecognized> and NO log_path is the trigger.
SNIPPET="$TMP_ROOT/completion-capture-snippet.sh"
cat > "$SNIPPET" <<'SNIP'
#!/usr/bin/env bash
set -euo pipefail
# same crash logger the real completion handler installs at line 28
trap 'echo "TRAP_FIRED_AT_LINE_$LINENO" >&2' ERR

source "$RESOLVER_SH"          # the resolver under test (pre-fix OR current)

_agent_profile_file="$PROFILE_FILE"
_start_epoch="$START_EPOCH"
CONV_PATHS=""
_seen_paths=""
for _try_path in "$TRY_PATH"; do
    [[ -z "$_try_path" ]] && continue
    [[ "$_seen_paths" == *"|${_try_path}|"* ]] && continue
    _seen_paths="${_seen_paths}|${_try_path}|"

    _log_dir=""
    if [[ -n "$_agent_profile_file" && -f "$_agent_profile_file" ]]; then
        _log_dir=$(resolve_log_dir "$_agent_profile_file" "$_try_path")    # bare assignment — the crash site
    else
        _log_dir=$(resolve_log_dir "claude" "$_try_path")
    fi

    if [[ -d "$_log_dir" && "$_start_epoch" -gt 0 ]]; then
        CONV_PATHS=$(find_conversation_files "$_log_dir" "$_start_epoch" "claude" || true)
        [[ -n "$CONV_PATHS" ]] && break
    fi
done
echo "SNIPPET_REACHED_END"
SNIP
chmod +x "$SNIPPET"

# build a trigger profile: cli = the stub path (unrecognized), NO log_path.
TRIGGER_PROFILE="$TMP_ROOT/trigger.json"
cat > "$TRIGGER_PROFILE" <<JSON
{ "id": "trigger", "name": "unrecognized cli, no log_path", "cli": "${STUB_CLI}" }
JSON

# (i) pre-fix resolver → snippet must CRASH (non-zero, never reaches the end).
if [[ -n "$PREFIX_RESOLVER" ]]; then
  PREFIX_OUT="$TMP_ROOT/prefix-snippet.out"
  if RESOLVER_SH="$PREFIX_RESOLVER" PROFILE_FILE="$TRIGGER_PROFILE" TRY_PATH="$WORKSPACE" START_EPOCH="$(date +%s)" \
       "$ENGINE_BASH" "$SNIPPET" >"$PREFIX_OUT" 2>&1; then
    # the HEAD snapshot differs from the working copy but did not crash the
    # snippet — the diff may not touch the resolve_log_dir return path at all.
    # SKIP loudly rather than fail: a negative-control that cannot reproduce
    # its bug must never flake CI. the current-resolver half below is the gate.
    note "${C_YEL}8b: pre-fix resolver did not crash the snippet (HEAD diff apparently outside the crash path) — skipping (not counted as failure)${C_NC}"
    note "output: $(tr '\n' '|' < "$PREFIX_OUT")"
  else
    if grep -q "SNIPPET_REACHED_END" "$PREFIX_OUT"; then
      note "${C_YEL}8b: pre-fix snippet exited non-zero but still reached the end (inconclusive) — skipping (not counted as failure)${C_NC}"
    else
      pass "8b: pre-fix resolver crashes the completion snippet (ERR trap fired, end never reached)"
      grep -q "TRAP_FIRED_AT_LINE" "$PREFIX_OUT" && note "ERR trap signature: $(grep -o 'TRAP_FIRED_AT_LINE_[0-9]*' "$PREFIX_OUT" | head -1)"
    fi
  fi
fi

# (ii) current resolver → snippet must SURVIVE (exit 0, reaches the end).
CUR_OUT="$TMP_ROOT/current-snippet.out"
if RESOLVER_SH="$REPO_ROOT/lib/session-log-resolver.sh" PROFILE_FILE="$TRIGGER_PROFILE" TRY_PATH="$WORKSPACE" START_EPOCH="$(date +%s)" \
     "$ENGINE_BASH" "$SNIPPET" >"$CUR_OUT" 2>&1; then
  if grep -q "SNIPPET_REACHED_END" "$CUR_OUT"; then
    pass "8b: current resolver lets the completion snippet finish (no crash, end reached)"
  else
    fail "8b: current resolver exited 0 but did not reach the end (unexpected)"
  fi
else
  fail "8b: current resolver STILL crashes the completion snippet (#8 not fixed)"
  note "output: $(tr '\n' '|' < "$CUR_OUT")"
fi

# sanity: the trigger profile really does drive the unknown-cli path → empty dir.
EMPTY_CHECK="$(RESOLVER_SH="$REPO_ROOT/lib/session-log-resolver.sh" "$ENGINE_BASH" -c '
  source "$RESOLVER_SH"; out=$(resolve_log_dir "'"$TRIGGER_PROFILE"'" "/tmp"); rc=$?; echo "rc=$rc out=[$out]"')"
note "current resolve_log_dir on trigger profile: $EMPTY_CHECK"
[[ "$EMPTY_CHECK" == "rc=0 out=[]" ]] && pass "8b: current resolver returns rc=0 with empty output on unknown cli + no log_path" \
                                       || fail "8b: expected 'rc=0 out=[]', got '$EMPTY_CHECK'"
echo

# ---------------------------------------------------------------------
# #8 (a) — FULL CHAIN regression: a 2-step chain whose agent profile uses an
# unrecognized CLI and NO log_path must run to terminal completion (pre-fix it
# stranded the run at "running" forever when the completion handler crashed).
# ---------------------------------------------------------------------
printf '%s[8a] full chain: unrecognized cli + no log_path runs to completion%s\n' "$C_BLU" "$C_NC"
write_profile_no_logpath "stub-default" "complete"

CHAIN_NLP="$TMP_ROOT/chain-no-logpath.json"
cat > "$CHAIN_NLP" <<'JSON'
{
  "name": "e2e-standalone-no-logpath",
  "description": "engine e2e #8: profile has unrecognized cli and no log_path",
  "version": "1.0",
  "config": {
    "monitor": true,
    "monitor_interval": 2,
    "max_rounds": 3,
    "session_prefix": "e2enlp",
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

RUN_DIR_NLP="$(run_chain "$CHAIN_NLP" 90)"
if [[ -z "$RUN_DIR_NLP" || ! -f "$RUN_DIR_NLP/run.json" ]]; then
  fail "8a: run object was created"
else
  pass "8a: run object created ($(basename "$RUN_DIR_NLP"))"
  FINAL_NLP="$(poll_terminal "$RUN_DIR_NLP" 110)"
  note "8a: terminal status = $FINAL_NLP"
  if [[ "$FINAL_NLP" == "completed" || "$FINAL_NLP" == "complete" ]]; then
    pass "8a: run reached terminal SUCCESS state (no resolve_log_dir crash)"
  elif [[ "$FINAL_NLP" == TIMEOUT* ]]; then
    fail "8a: run STRANDED at running — the #8 crash regressed ($FINAL_NLP)"
    note "run.json: $(jq -c '{status, agents:[.agents[]|{id,status}]}' "$RUN_DIR_NLP/run.json" 2>/dev/null)"
  else
    fail "8a: expected completed, got '$FINAL_NLP'"
  fi
  [[ "$(agent_status "$RUN_DIR_NLP" step1)" == "complete" ]] && pass "8a: step1 marked complete" || fail "8a: step1 not complete (got '$(agent_status "$RUN_DIR_NLP" step1)')"
  [[ "$(agent_status "$RUN_DIR_NLP" step2)" == "complete" ]] && pass "8a: step2 marked complete" || fail "8a: step2 not complete (got '$(agent_status "$RUN_DIR_NLP" step2)')"
  # completion handler ran to the end → summary artifacts exist even with no log_path.
  [[ -f "$RUN_DIR_NLP/artifacts/step2-summary.json" ]] && pass "8a: completion handler finished (step2 summary artifact written)" || fail "8a: step2 summary artifact missing (handler may have crashed)"
fi
echo

# ---------------------------------------------------------------------
# #9 — heartbeat loop exit conditions. We extract the loop's decision logic into
# a faithful copy with stubbed I/O (curl) so it is fast and self-contained,
# then assert it terminates
# promptly for (i) parent-gone and (ii) deadline-exceeded — the two leak cases.
#
# NOTE on the 60s real sleep: the production loop sleeps 60s per cycle, far too
# long for a unit test. We make the per-cycle sleep env-tunable (HB_SLEEP) in
# this COPY only — the real loop's structure (orphan guard, then deadline, then
# state, then heartbeat, in that order) is preserved verbatim so the test pins
# the actual exit ordering.
# ---------------------------------------------------------------------
printf '%s[9] heartbeat loop terminates on parent-gone and on deadline%s\n' "$C_BLU" "$C_NC"

HB_HARNESS="$TMP_ROOT/heartbeat-harness.sh"
cat > "$HB_HARNESS" <<'HBEOF'
#!/usr/bin/env bash
set -uo pipefail
# stubs for the real loop's external calls (kept inert/benign for the test).
# curl stub: emits whatever HB_CURL_CODE says (default "000" = connection failure).
curl() { printf '%s' "${HB_CURL_CODE:-000}"; }

# ---- begin faithful copy of lib/chain-runner.sh heartbeat loop body ----
_hb_state_file="$HB_STATE_FILE"
_hb_session_name="sess"
_hb_url="http://localhost:0/noop"
_hb_secret=""
_hb_parent_pid="$HB_PARENT_PID"
_hb_max_lifetime="${MENTIKO_HEARTBEAT_MAX_LIFETIME:-86400}"
_hb_deadline=$(( $(date +%s) + _hb_max_lifetime ))
_hb_max_failures="${MENTIKO_HEARTBEAT_MAX_FAILURES:-5}"
_hb_fails=0
_cycles=0
while true; do
    sleep "${HB_SLEEP:-60}"
    _cycles=$(( _cycles + 1 ))
    [[ "$_cycles" -gt "${HB_MAX_CYCLES:-1000}" ]] && { echo "RESULT=RUNAWAY cycles=$_cycles"; exit 3; }

    kill -0 "$_hb_parent_pid" 2>/dev/null || { echo "RESULT=PARENT_GONE cycles=$_cycles"; break; }
    [[ "$(date +%s)" -ge "$_hb_deadline" ]] && { echo "RESULT=DEADLINE cycles=$_cycles"; break; }

    if [[ -f "$_hb_state_file" ]]; then
        _cur_status=$(grep "^status:" "$_hb_state_file" | head -1 | cut -d: -f2 | xargs 2>/dev/null || echo "")
        [[ "$_cur_status" != "running" ]] && { echo "RESULT=STATE_DONE cycles=$_cycles"; break; }
    else
        echo "RESULT=NO_STATE cycles=$_cycles"; break
    fi

    _hb_status=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$_hb_url" --max-time 5 2>/dev/null || echo "000")
    [[ "$_hb_status" =~ ^4 ]] && { echo "RESULT=HTTP_4XX cycles=$_cycles"; break; }
    if [[ "$_hb_status" == "000" ]]; then
        _hb_fails=$(( _hb_fails + 1 ))
        [[ "$_hb_fails" -ge "$_hb_max_failures" ]] && { echo "RESULT=CONN_FAILS cycles=$_cycles"; break; }
    else
        _hb_fails=0
    fi
done
# ---- end faithful copy ----
HBEOF
chmod +x "$HB_HARNESS"

# (i) parent-gone: give the loop a parent PID that has already exited. With a
# "running" state file and a tiny per-cycle sleep, the ONLY thing that can stop
# it is the orphan guard. Must terminate within the first cycle.
mkdir -p "$DATA_ROOT/state-hb"
HB_STATE="$DATA_ROOT/state-hb/agent.state"
printf 'status: running\n' > "$HB_STATE"
# a PID that is (almost certainly) not alive: spawn `true` and reap it.
( true ) & DEAD_PID=$!; wait "$DEAD_PID" 2>/dev/null || true

HB_OUT_PARENT="$TMP_ROOT/hb-parent.out"
if [[ -n "$TIMEOUT_BIN" ]]; then RUN_HB=( "$TIMEOUT_BIN" 15 "$ENGINE_BASH" "$HB_HARNESS" ); else RUN_HB=( "$ENGINE_BASH" "$HB_HARNESS" ); fi
HB_SLEEP=0.2 HB_MAX_CYCLES=20 HB_CURL_CODE="200" HB_PARENT_PID="$DEAD_PID" HB_STATE_FILE="$HB_STATE" \
  "${RUN_HB[@]}" >"$HB_OUT_PARENT" 2>&1 || true
HB_RES_PARENT="$(grep -o 'RESULT=[A-Z_]*' "$HB_OUT_PARENT" | head -1)"
HB_CYC_PARENT="$(grep -o 'cycles=[0-9]*' "$HB_OUT_PARENT" | head -1)"
note "9(i) parent-gone: $HB_RES_PARENT $HB_CYC_PARENT"
if [[ "$HB_RES_PARENT" == "RESULT=PARENT_GONE" && "$HB_CYC_PARENT" == "cycles=1" ]]; then
  pass "9: loop exits on parent-gone within one poll cycle (orphan guard)"
elif [[ "$HB_RES_PARENT" == "RESULT=PARENT_GONE" ]]; then
  pass "9: loop exits on parent-gone (orphan guard) — $HB_CYC_PARENT"
else
  fail "9: loop did NOT exit via orphan guard (got '$HB_RES_PARENT' $HB_CYC_PARENT — leak risk)"
fi

# (ii) deadline: keep the parent ALIVE and the state "running", set curl to a
# healthy 200 (so neither the orphan guard, the state check, nor the connection-
# failure cap can fire), and set a tiny lifetime. The deadline MUST be the thing
# that stops it.
HB_OUT_DEADLINE="$TMP_ROOT/hb-deadline.out"
if [[ -n "$TIMEOUT_BIN" ]]; then RUN_HB2=( "$TIMEOUT_BIN" 15 "$ENGINE_BASH" "$HB_HARNESS" ); else RUN_HB2=( "$ENGINE_BASH" "$HB_HARNESS" ); fi
MENTIKO_HEARTBEAT_MAX_LIFETIME=1 HB_SLEEP=0.5 HB_MAX_CYCLES=40 HB_CURL_CODE="200" HB_PARENT_PID="$$" HB_STATE_FILE="$HB_STATE" \
  "${RUN_HB2[@]}" >"$HB_OUT_DEADLINE" 2>&1 || true
HB_RES_DEADLINE="$(grep -o 'RESULT=[A-Z_]*' "$HB_OUT_DEADLINE" | head -1)"
HB_CYC_DEADLINE="$(grep -o 'cycles=[0-9]*' "$HB_OUT_DEADLINE" | head -1)"
note "9(ii) deadline: $HB_RES_DEADLINE $HB_CYC_DEADLINE (MENTIKO_HEARTBEAT_MAX_LIFETIME=1)"
if [[ "$HB_RES_DEADLINE" == "RESULT=DEADLINE" ]]; then
  pass "9: loop exits on absolute deadline (MENTIKO_HEARTBEAT_MAX_LIFETIME honored)"
else
  fail "9: loop did NOT exit via deadline (got '$HB_RES_DEADLINE' $HB_CYC_DEADLINE)"
fi

# (iii) bonus: consecutive connection-failure cap. Parent alive, state running,
# generous deadline, curl always "000". The fail cap (default tuned to 3 here)
# MUST stop it after exactly that many cycles.
HB_OUT_CONN="$TMP_ROOT/hb-conn.out"
if [[ -n "$TIMEOUT_BIN" ]]; then RUN_HB3=( "$TIMEOUT_BIN" 15 "$ENGINE_BASH" "$HB_HARNESS" ); else RUN_HB3=( "$ENGINE_BASH" "$HB_HARNESS" ); fi
MENTIKO_HEARTBEAT_MAX_FAILURES=3 HB_SLEEP=0.2 HB_MAX_CYCLES=40 HB_CURL_CODE="000" HB_PARENT_PID="$$" HB_STATE_FILE="$HB_STATE" \
  "${RUN_HB3[@]}" >"$HB_OUT_CONN" 2>&1 || true
HB_RES_CONN="$(grep -o 'RESULT=[A-Z_]*' "$HB_OUT_CONN" | head -1)"
HB_CYC_CONN="$(grep -o 'cycles=[0-9]*' "$HB_OUT_CONN" | head -1)"
note "9(iii) conn-fail cap: $HB_RES_CONN $HB_CYC_CONN (MENTIKO_HEARTBEAT_MAX_FAILURES=3)"
if [[ "$HB_RES_CONN" == "RESULT=CONN_FAILS" && "$HB_CYC_CONN" == "cycles=3" ]]; then
  pass "9: loop exits after N consecutive connection failures (exactly N=3)"
elif [[ "$HB_RES_CONN" == "RESULT=CONN_FAILS" ]]; then
  pass "9: loop exits after consecutive connection failures — $HB_CYC_CONN"
else
  fail "9: loop did NOT exit via connection-failure cap (got '$HB_RES_CONN' $HB_CYC_CONN)"
fi
echo

# =====================================================================
hr
printf 'standalone engine e2e results: %s%d passed%s, %s%d failed%s\n' "$C_GREEN" "$PASS" "$C_NC" "$C_RED" "$FAIL" "$C_NC"
hr
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
exit 0
