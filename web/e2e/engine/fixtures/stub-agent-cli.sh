#!/usr/bin/env bash
# stub-agent-cli.sh — deterministic, hermetic stand-in for a real agent CLI
# (claude / codex / aider). Used by the engine-level e2e to drive the REAL bash
# orchestration engine (lib/chain-runner.sh + monitor + chain-runner-complete.sh)
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
#
# This file is a TEST FIXTURE. It is never shipped and never executed in production.

set -u

STUB_MODE="${STUB_MODE:-complete}"

log() { printf '[stub:%s] %s\n' "${MENTIKO_AGENT_ID:-?}" "$*"; }

# crash mode: behave like a CLI that dies on startup. The engine's startup
# liveness check marks the agent (and run) failed without ever sending
# instructions. Deterministic and fast — no hang.
if [[ "$STUB_MODE" == "crash" ]]; then
  log "simulating a crashing agent CLI (exit 7)" >&2
  echo "ERROR: stub intentional startup failure" >&2
  exit 7
fi

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
      do_work_and_complete
      sleep 2   # let the monitor capture the marker before the process exits
      exit 0
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
