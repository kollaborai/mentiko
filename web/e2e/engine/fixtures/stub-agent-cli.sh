#!/usr/bin/env bash
# stub-agent-cli.sh — deterministic, hermetic stand-in for a real agent CLI
# (claude / codex / aider). Used by the engine-level e2e to drive the REAL bash
# orchestration engine (lib/chain-runner.sh + monitor + typed completion)
# without any model provider, API key, network call, or paid inference.
#
# WHY THIS IS FAITHFUL TO THE CONTRACT
# ------------------------------------
# The engine launches an agent by spawning a PTY session, sending a start command
# that execs the profile's `cli` binary, then — after a startup liveness check —
# sending a short "instruction pointer" line (text + Enter) into that PTY. A real
# CLI is a long-lived interactive REPL: it stays alive at a prompt, receives the
# instruction line on stdin, does work, optionally writes files, and finishes by
# printing AGENT_COMPLETE on its own final line. The monitor (lib/agent-functions.sh
# monitor-chain-agent) watches the rendered PTY output for that marker and only then
# fires the completion handler.
#
# This stub reproduces exactly that lifecycle:
#   1. It prints a ready banner and BLOCKS reading stdin (so it survives the
#      engine's `session_has_active_command` startup check at chain-runner.sh:1871 —
#      a stub that exits too early is (correctly) treated as a crashed CLI).
#   2. On the first instruction line it recognises, it does its work:
#        - reads upstream agents' output markers (proves step->step propagation),
#        - writes the COMPLETION CONTRACT summary artifacts the engine expects
#          ($ARTIFACTS_DIR/<id>-summary.json),
#        - runs `mentiko emit <event>` via $MENTIKO_BIN — the canonical event
#          writer the engine's completion matcher keys on,
#        - prints the SUMMARY/ARTIFACTS/NEXT block and AGENT_COMPLETE last.
#   3. It then exits 0.
#
# All inputs come from the environment the engine itself exports for every agent
# (agent_run_context_export_command in chain-runner.sh): MENTIKO_AGENT_ID,
# MENTIKO_AGENT_EMITS, MENTIKO_RUN_ID, EVENTS_DIR, ARTIFACTS_DIR, MENTIKO_BIN, PATH.
# The stub invents nothing the engine doesn't already provide to a real CLI.
#
# BEHAVIOUR MODES (selected per-agent via the STUB_MODE env var, injected through
# the agent profile's `env` block so different agents in one chain can differ):
#   complete       (default) — succeed: emit event, write complete summary, AGENT_COMPLETE.
#   fail-summary             — emit event + AGENT_COMPLETE, but write a summary with
#                              status "failed" so the completion quality-gate fails the run.
#   crash                    — exit non-zero immediately, before instructions, like a
#                              CLI that dies on startup (drives the fast failure path).
#   mid-run-crash            — start cleanly (PASSES the startup liveness check by
#                              blocking on stdin), then on the instruction line print a
#                              little work and exit NON-ZERO without ever emitting its
#                              event or AGENT_COMPLETE — a CLI that dies mid-task. Drives
#                              the monitor's dead-process-without-event FAILURE path.
#   quiet-slow               — start cleanly, then sit SILENT (no new output, so the
#                              monitor's md5 hash is stable and stale-count climbs) for
#                              STUB_QUIET_SECONDS, THEN complete normally. Proves a
#                              quiet-but-working agent is NOT force-completed early.
#   chatty                   — emit event + AGENT_COMPLETE, then FLOOD hundreds of extra
#                              lines so AGENT_COMPLETE scrolls past the monitor's tail
#                              capture window. Proves completion is still detected
#                              (via the latched event-file signal).
#   limbo                    — simulate a process that is ALIVE but is NOT a ready
#                              agent: a bare shell left after the CLI failed to
#                              launch, or a CLI parked on an auth/trust prompt. It
#                              prints NO ready banner (no positive readiness
#                              evidence), stays alive blocking on stdin (so it
#                              passes the engine's any-child liveness check), and
#                              RECORDS every line the engine types at it to
#                              $STUB_STDIN_LOG — but NEVER recognises an
#                              instruction, NEVER emits its event, NEVER prints
#                              AGENT_COMPLETE, and has NO auto-complete fallback.
#                              Proves the Stage-0 property: the engine must type
#                              NOTHING (no task pointer, no stale nudge) into a
#                              session that never produced positive readiness.
#
# Extra env knobs (defaults keep the stub fast + hang-proof):
#   STUB_QUIET_SECONDS     quiet-slow silent duration (default 8)
#   STUB_CHATTY_LINES      chatty post-complete flood line count (default 400)
#   STUB_MIDCRASH_SECONDS  mid-run-crash: seconds alive before dying (default 6)
#   STUB_LIMBO_SECONDS     limbo: seconds alive (recording stdin) before exit (default 35)
#   STUB_STDIN_LOG         limbo: file the stub appends every received stdin line to
#
# This file is a TEST FIXTURE. It is never shipped and never executed in production.

set -u

STUB_MODE="${STUB_MODE:-complete}"
STUB_QUIET_SECONDS="${STUB_QUIET_SECONDS:-8}"
STUB_CHATTY_LINES="${STUB_CHATTY_LINES:-400}"
STUB_MIDCRASH_SECONDS="${STUB_MIDCRASH_SECONDS:-6}"
STUB_LIMBO_SECONDS="${STUB_LIMBO_SECONDS:-35}"
STUB_RECOVER_SECONDS="${STUB_RECOVER_SECONDS:-30}"

log() { printf '[stub:%s] %s\n' "${MENTIKO_AGENT_ID:-?}" "$*"; }

# crash mode: behave like a CLI that dies on startup. The engine's startup
# liveness check marks the agent (and run) failed without ever sending
# instructions. Deterministic and fast — no hang.
if [[ "$STUB_MODE" == "crash" ]]; then
  log "simulating a crashing agent CLI (exit 7)" >&2
  echo "ERROR: stub intentional startup failure" >&2
  exit 7
fi

# limbo mode: a process that is ALIVE but is NOT a ready agent (bare shell after a
# failed CLI launch, or a CLI parked on an auth/trust prompt). Prints NO ready
# banner, stays alive blocking on stdin (passes the engine's any-child liveness
# check), and RECORDS every line the engine types at it — but NEVER recognises an
# instruction, NEVER emits its event, NEVER prints AGENT_COMPLETE, and has NO
# auto-complete fallback. Bounded so it cannot hang. The Stage-0 guard: a correct
# engine must type NOTHING (no task pointer, no stale nudge) into this session.
if [[ "$STUB_MODE" == "limbo" ]]; then
  : > "${STUB_STDIN_LOG:-/dev/null}"
  log "limbo: live non-agent; recording stdin; will not finish" >&2
  _limbo_deadline=$(( $(date +%s) + STUB_LIMBO_SECONDS ))
  while [[ "$(date +%s)" -lt "$_limbo_deadline" ]]; do
    if IFS= read -r -t 3 _line; then
      [[ -n "$_line" ]] && printf '%s\n' "$_line" >> "${STUB_STDIN_LOG:-/dev/null}"
    fi
  done
  exit 0
fi

# echo-stall mode: reproduces the NUDGE-LOOP DEFEAT. Passes startup (prints a ready
# banner, blocks on stdin), then ECHOES every line it receives back to stdout — so
# each monitor nudge repaints the screen and resets the per-cycle stale counter,
# which is exactly why the old max_stale_count cap could never fire from the nudge
# path. It NEVER emits its event or prints AGENT_COMPLETE. Without a DURABLE nudge
# budget the monitor types at it forever; with the budget it must stop after
# MENTIKO_MONITOR_MAX_NUDGES keystrokes and escalate (monitor-agent-stalled →
# BLOCKED). Stays alive well past the expected escalation (so it is the STALL path,
# not the dead-process path, that catches it), bounded so it cannot hang.
if [[ "$STUB_MODE" == "echo-stall" ]]; then
  echo "stub echo-stall ready (for agents)"
  log "echo-stall: ready; will echo every nudge but never complete" >&2
  _es_deadline=$(( $(date +%s) + STUB_LIMBO_SECONDS ))
  while [[ "$(date +%s)" -lt "$_es_deadline" ]]; do
    if IFS= read -r -t 2 _es_line; then
      # repaint the screen on EVERY received line (instruction pointer + each nudge)
      [[ -n "$_es_line" ]] && printf 'echo> %s\n' "${_es_line:0:60}"
    fi
  done
  exit 0
fi

# advisor-probe mode: stand in for the stale-advisor CLI. When the monitor invokes
# the advisor (typed agent-profile command compiler on the isAdvisorDefault profile, prompt piped
# on stdin), this records that a consultation HAPPENED — appends to
# $STUB_ADVISOR_MARKER — then exits without a reply. Kept as a SEPARATE profile from
# the agent so its invocation is detectable and never pollutes the agent's stdin
# log. Used to assert a never-ready agent triggers NO advisor call during startup.
if [[ "$STUB_MODE" == "advisor-probe" ]]; then
  printf '%s advisor-invoked\n' "$(date +%s)" >> "${STUB_ADVISOR_MARKER:-/dev/null}"
  exit 0
fi

# advisor-recover mode: stand in for the PHASE-AWARE startup advisor. Ignores stdin
# (the recovery prompt) and returns a single low-risk, high-confidence send_keys[ENTER]
# JSON action — the advisor-recovery.sh contract. Used to prove the engine consults the
# advisor on a recoverable startup, auto-applies the key, and the agent then proceeds.
if [[ "$STUB_MODE" == "advisor-recover" ]]; then
  printf '%s\n' '{"action":"send_keys","confidence":0.95,"risk":"low","reason":"benign continue prompt","evidence":"Press Enter to continue","keys":["ENTER"],"retry_after_seconds":0}'
  exit 0
fi

# recoverable-prompt mode: a CLI parked on a BENIGN prompt at startup ("Press Enter to
# continue") — NOT ready yet, but recoverable by a single Enter. It prints the prompt,
# waits for an Enter (an empty stdin line = the engine's recovery send_keys), then
# becomes a normal ready agent (falls through to the banner + REPL). If no Enter ever
# arrives it exits non-zero. Proves bounded auto-recovery end to end.
if [[ "$STUB_MODE" == "recoverable-prompt" ]]; then
  # Drain stray startup input (the launch keystrokes / double-Enter) for a few seconds so
  # ONLY a deliberate recovery Enter from the advisor clears the prompt below. Otherwise the
  # launch's own Enter answers it and the advisor path is never exercised — which is itself
  # the "extra Enter accepts a default" hazard, but here it would mask the test.
  _drain_until=$(( $(date +%s) + 3 ))
  while [[ "$(date +%s)" -lt "$_drain_until" ]]; do IFS= read -r -t 1 _drain || true; done
  echo "Press Enter to continue"
  _rp_deadline=$(( $(date +%s) + STUB_RECOVER_SECONDS ))
  _rp_recovered=0
  while [[ "$(date +%s)" -lt "$_rp_deadline" ]]; do
    if IFS= read -r -t 3 _rp_line; then
      [[ -z "$_rp_line" ]] && { _rp_recovered=1; break; }   # empty line = Enter pressed
    fi
  done
  if [[ "$_rp_recovered" != "1" ]]; then
    echo "ERROR: stub recoverable-prompt got no Enter to clear the prompt" >&2
    exit 1
  fi
  log "recovered via Enter; becoming a ready agent" >&2
  printf '\033[2J\033[3J\033[H'   # redraw: clear screen+scrollback so the cleared prompt is
                                  # gone from the readiness capture (a real CLI redraws too)
  STUB_MODE="complete"   # fall through to the ready banner + REPL below
fi

# mid-run-crash: handled INSIDE the REPL below (do_mid_run_crash), NOT as an early
# exit. It must survive the engine's startup liveness check (chain-runner.sh
# session_has_active_command) AND actually receive the instruction line, THEN die
# non-zero without emitting its event or AGENT_COMPLETE — so it is the MONITOR's
# dead-process detection (monitor-chain-agent -> monitor-agent-died) that catches
# it, not the pre-instruction startup check. An early time-based exit raced the
# startup check and was caught there instead, never exercising the monitor path.

# collect upstream output markers written by earlier agents in this run.
# proves cross-step output propagation when present.
collect_upstream() {
  local upstream="" f
  for f in "${ARTIFACTS_DIR:-/nonexistent}"/*-output-marker.txt; do
    [[ -e "$f" ]] || continue
    [[ "$f" == *"${MENTIKO_AGENT_ID}-output-marker.txt" ]] && continue
    upstream="$upstream $(cat "$f" 2>/dev/null)"
  done
  printf '%s' "$upstream"
}

do_work_and_complete() {
  local upstream summary_status
  upstream="$(collect_upstream)"

  case "$STUB_MODE" in
    fail-summary) summary_status="failed" ;;
    *)            summary_status="complete" ;;
  esac

  log "working: emits=${MENTIKO_AGENT_EMITS:-?} mode=$STUB_MODE upstream:${upstream}"
  mkdir -p "${ARTIFACTS_DIR:-/tmp}" 2>/dev/null || true

  # COMPLETION CONTRACT artifact (shape from chain-runner.sh build_completion_contract).
  cat > "${ARTIFACTS_DIR}/${MENTIKO_AGENT_ID}-summary.json" <<JSON
{
  "status": "${summary_status}",
  "executiveSummary": "stub agent ${MENTIKO_AGENT_ID} (${STUB_MODE}); upstream:${upstream}",
  "workCompleted": ["stub step ${MENTIKO_AGENT_ID}"],
  "artifactsProduced": ["${MENTIKO_AGENT_ID}-summary.json"],
  "codeChanges": [],
  "findings": [],
  "risks": [],
  "nextAgentHints": []
}
JSON

  # marker the downstream agent reads — output propagation signal.
  echo "stub-output-from-${MENTIKO_AGENT_ID}" > "${ARTIFACTS_DIR}/${MENTIKO_AGENT_ID}-output-marker.txt"

  # emit the completion event via the canonical writer (reads RUN_ID,
  # MENTIKO_AGENT_ID, EVENTS_DIR from env). This is the event the engine's
  # completion matcher recognises.
  if [[ -n "${MENTIKO_BIN:-}" && -x "${MENTIKO_BIN}" ]]; then
    "${MENTIKO_BIN}" emit "${MENTIKO_AGENT_EMITS}" >/dev/null 2>&1 || log "warn: emit failed" >&2
  else
    log "warn: MENTIKO_BIN not set/executable; cannot emit" >&2
  fi

  # final terminal response — order matters; AGENT_COMPLETE must be the last
  # non-empty line and on its own line (monitor matches ^\s*AGENT_COMPLETE\s*$).
  echo "SUMMARY:"
  echo "- stub agent ${MENTIKO_AGENT_ID} finished (${STUB_MODE})"
  echo "ARTIFACTS:"
  echo "- ${MENTIKO_AGENT_ID}-summary.json"
  echo "NEXT:"
  echo "- none"
  echo "AGENT_COMPLETE"

  # chatty mode: AFTER printing AGENT_COMPLETE and emitting the event, flood the
  # terminal so the marker scrolls far past the monitor's tail capture window.
  # The monitor must still detect completion via the latched event-file signal.
  if [[ "$STUB_MODE" == "chatty" ]]; then
    local i
    for (( i=0; i<STUB_CHATTY_LINES; i++ )); do
      echo "chatty-noise line ${i} lorem ipsum dolor sit amet consectetur ${MENTIKO_AGENT_ID}"
    done
  fi
}

# do_mid_run_crash: called from the REPL once the instruction line has been
# received (so startup liveness already passed). Prints a little work, stays alive
# briefly as a real foreground process — long enough for the monitor's first
# poll(s) to observe a live CLI and ARM its dead-process detector — then exits
# NON-ZERO WITHOUT emitting its event or printing AGENT_COMPLETE. The monitor's
# "agent CLI no longer running" branch (monitor-agent-died) must then record
# FAILURE, never fabricate success. Bounded sleep guarantees no hang.
do_mid_run_crash() {
  log "received task; working ${STUB_MIDCRASH_SECONDS}s then dying mid-task (no event, no AGENT_COMPLETE)" >&2
  echo "thinking about the task..."
  echo "starting step 1 of 3"
  sleep "$STUB_MIDCRASH_SECONDS"
  echo "ERROR: stub intentional mid-run failure" >&2
  exit 9
}

log "stub REPL ready (mode=$STUB_MODE); waiting for instructions"

# Mimic an interactive REPL: stay alive reading stdin until the engine delivers
# the instruction pointer line, then do the work. A bounded deadline guarantees
# the stub never hangs the test even if the instruction text changes shape.
deadline=$(( $(date +%s) + 45 ))
while true; do
  if IFS= read -r -t 5 line; then
    [[ -z "$line" ]] && continue
    log "recv: ${line:0:70}"
    # The instruction pointer (build-instruction-pointer) names the agent id and
    # the words "Mentiko"/"instructions". Trigger on any of those.
    if [[ "$line" == *"${MENTIKO_AGENT_ID}"* || "$line" == *nstruction* || "$line" == *Mentiko* ]]; then
      case "$STUB_MODE" in
        mid-run-crash)
          do_mid_run_crash   # works briefly post-instruction, then exits non-zero
          ;;
        quiet-slow)
          # sit silent so the monitor's last-20-lines md5 stays stable and the
          # stale counter climbs, THEN complete normally. The test sets a high
          # MENTIKO_MONITOR_MAX_STALE so this completes before max-stale fires.
          log "going quiet for ${STUB_QUIET_SECONDS}s (no output) then completing" >&2
          sleep "$STUB_QUIET_SECONDS"
          do_work_and_complete
          sleep 2
          exit 0
          ;;
        *)
          do_work_and_complete
          sleep 2   # let the monitor capture the marker before the process exits
          exit 0
          ;;
      esac
    fi
  else
    # read timed out (no input this cycle). Fall back to completing once the
    # deadline passes so a missed/altered instruction line can't hang the run.
    if [[ "$(date +%s)" -ge "$deadline" ]]; then
      log "deadline reached without recognised instruction; completing anyway"
      do_work_and_complete
      sleep 2
      exit 0
    fi
  fi
done
