#!/bin/bash
# agent-functions.sh - Core functions for mentiko
# PTY-based AI agent orchestration with file events

# Load session transport (pty-manager for all sessions)
_AF_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$_AF_SCRIPT_DIR/session-transport.sh"
source "$_AF_SCRIPT_DIR/monitor-completion.sh" 2>/dev/null || true
source "$_AF_SCRIPT_DIR/ai-gateway-agent-env.sh" 2>/dev/null || true
source "$_AF_SCRIPT_DIR/agent-state-client.sh"
source "$_AF_SCRIPT_DIR/agent-profile-client.sh"
source "$_AF_SCRIPT_DIR/agent-transcript-client.sh"

if ! transport_init; then
    echo "  mentiko: pty-manager daemon could not start"
    return 1 2>/dev/null || exit 1
fi

# configurable: which CLI to use (claude, glm, codex, aider, etc)
MENTIKO_CLI="${MENTIKO_CLI:-claude}"

if ! command -v "$MENTIKO_CLI" &> /dev/null; then
    echo "  mentiko: $MENTIKO_CLI not found"
    echo "  set MENTIKO_CLI to your claude code binary"
    return 1 2>/dev/null || exit 1
fi

# configurable: monitor check interval
MENTIKO_MONITOR_INTERVAL="${MENTIKO_MONITOR_INTERVAL:-60}"

# configurable monitor timing knobs (env-tunable so tests can run fast).
# defaults preserve historical behavior.
#   MENTIKO_MONITOR_MAX_STALE   - stale cycles before an alive-but-quiet agent is
#                                 surfaced as blocked (see monitor-agent-stalled).
#   MENTIKO_MONITOR_MARKER_TAIL - how many tail lines agent-complete-marker-seen scans.
DEFAULT_MAX_STALE_COUNT="${MENTIKO_MONITOR_MAX_STALE:-${DEFAULT_MAX_STALE_COUNT:-5}}"
MENTIKO_MONITOR_MARKER_TAIL="${MENTIKO_MONITOR_MARKER_TAIL:-100}"

# namespace config
NAMESPACE_ID="${NAMESPACE_ID:-default}"

# -------------------------------------------------------------------
# new_pty_session: create a session via pty-manager transport
# -------------------------------------------------------------------
new_pty_session() {
    transport_new_session "$1"
}

# -------------------------------------------------------------------
# send-message: send text to a session and capture response
# -------------------------------------------------------------------
send-message() {
    transport_send_keys "$1" "$2" \
        && sleep 1 \
        && transport_send_raw "$1" $'\r' \
        && echo "  message sent to $1" \
        && sleep 8 \
        && transport_capture "$1" 40
}

# -------------------------------------------------------------------
# new-agent-session: create a pty session with an AI agent
# -------------------------------------------------------------------
new-agent-session() {
    local session_name="$1"
    local agent_name="$2"
    local task_description="$3"

    if [[ -z "$session_name" || -z "$agent_name" || -z "$task_description" ]]; then
        echo "usage: new-agent-session <session_name> <agent_name> <task>"
        return 1
    fi

    new_pty_session "$session_name" -d

    send-message "$session_name" "$MENTIKO_CLI" && sleep 3

    local hello="Hello"
    local init_msg="$hello, you are agent: $agent_name. Your task is: $task_description. Please begin by outlining your plan, then proceed step by step. Report progress here."

    send-message "$session_name" "$init_msg" && sleep 1
    transport_send_raw "$session_name" $'\r'
    echo "  agent session created: $session_name"
}

# -------------------------------------------------------------------
# new-agent-from-spec: launch agent from a spec file
# -------------------------------------------------------------------
new-agent-from-spec() {
    local spec_file="$1"
    local monitor="${2:-}"

    if [[ -z "$spec_file" || ! -f "$spec_file" ]]; then
        echo "usage: new-agent-from-spec <spec-file> [--monitor]"
        return 1
    fi

    local session_prefix=$(grep -m1 "^session-prefix:" "$spec_file" | sed 's/^session-prefix:[[:space:]]*//' | xargs)
    local agent_name=$(grep -m1 "^name:" "$spec_file" | sed 's/^name:[[:space:]]*//' | xargs)

    if [[ -z "$session_prefix" ]]; then
        echo "error: spec file missing session-prefix"
        return 1
    fi

    # project prefix from git root or cwd
    local project_root
    project_root="${MENTIKO_GLOBAL_ROOT:-$HOME/.mentiko}"
    local project_name=$(basename "$project_root")

    local date_suffix=$(date +%Y%m%d-%H%M)
    local session_name="${project_name}-${session_prefix}-${date_suffix}"

    local task="Read your agent spec at $spec_file. Follow your playbooks and write deliverables to the paths specified in your spec. Read your context files first. Begin now."

    new-agent-session "$session_name" "$agent_name" "$task"

    # update state if available (use config.sh STATE_DIR)
    local state_dir="${STATE_DIR:-${MENTIKO_PROJECT_ROOT:-$project_root}/state}"
    if [[ -d "$state_dir" ]]; then
        _agent_state_cli start \
            --state-dir "$state_dir" \
            --session-prefix "$session_prefix" \
            --session "$session_name" \
            --agent-id "$session_prefix" \
            --workspace "local" \
            >/dev/null
    fi

    if [[ "$monitor" == "--monitor" ]]; then
        local monitor_session="monitor-${session_name}"
        local lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
        local monitor_runtime="${lib_dir}/runner-v2-standalone-monitor.js"
        if [[ ! -f "$monitor_runtime" ]]; then
            echo "error: typed standalone monitor runtime missing: $monitor_runtime" >&2
            return 1
        fi
        new_pty_session "$monitor_session" node "$monitor_runtime" \
            --session "$session_name" \
            --spec "$spec_file" \
            --interval "$MENTIKO_MONITOR_INTERVAL" \
            --workspace "$project_root"
        echo "  monitor started: $monitor_session"
    fi
}

# -------------------------------------------------------------------
# peek-session: view session output
# -------------------------------------------------------------------
peek-session() {
    local session="$1"
    local tail_lines="${2:-}"

    if [[ -z "$session" ]]; then
        echo "usage: peek-session <session-name> [tail-lines]"
        return 1
    fi

    if ! transport_has_session "$session" 2>/dev/null; then
        echo "error: session '$session' does not exist"
        return 1
    fi

    if [[ -n "$tail_lines" ]]; then
        transport_capture "$session" "$tail_lines"
    else
        transport_capture "$session"
    fi
}

agent-complete-marker-seen() {
    local session_name="$1"
    local tail_lines="${2:-${MENTIKO_MONITOR_MARKER_TAIL:-100}}"

    transport_capture "$session_name" "$tail_lines" 2>/dev/null |
        strip-terminal-control |
        sed -E 's/^[[:space:]]*[^[:alnum:]_[:space:]]+[[:space:]]*/ /' |
        grep -Eq '^[[:space:]]*AGENT_COMPLETE[[:space:]]*$'
}

# -------------------------------------------------------------------
# durable completion evidence (BUG-022)
#
# The rendered pty screen is NOT trustworthy for AGENT_COMPLETE. A UI attach
# resizes the pty and re-wraps the instruction echo ("...make the final
# non-empty line exactly AGENT_COMPLETE.") so the marker lands on its own
# rendered line and agent-complete-marker-seen false-latches while the agent is
# still working (2026-07-04 incident, a9b4cbf). Durable evidence cannot be
# re-wrapped: the agent's declared emits event file (signal 2 in the latch), or
# the session transcript JSONL, where every message is stored as one logical
# string. This checks the transcript for a standalone AGENT_COMPLETE line in the
# agent's OWN output. The pasted instruction is a separate (user-role) message
# whose text keeps AGENT_COMPLETE mid-sentence with a trailing period, so the
# standalone-line anchor rejects it regardless of role.
# -------------------------------------------------------------------

# resolve the durable session transcript JSONL for a pty session, cwd-slug and
# CLI independent. Invocation-only: the typed owner
# (web/lib/runner-v2/agent-transcript.ts via lib/runner-agent-transcript.js)
# resolves the transcript root from the agent profile, selects among EVERY UUID
# in the capture, and binds the winner to THIS run attempt's identity. The shell
# forwards the capture on stdin plus primitive identity arguments and nothing
# else — no jq, no find, no fallback.
#
# Emits nothing (degraded, not an error) when unresolvable, so callers fail
# closed to the durable event file. A capture routinely holds MORE than one
# UUID: the CLI status bar carries the real transcript/session UUID, but the
# agent's goal or prompt commonly echoes OTHER UUIDs — a decision_id, a task id —
# that appear EARLIER in the scrollback. Selecting on position alone let a decoy
# answer for the run; the typed owner scores each candidate against the current
# identity and returns nothing when the winner is unproven or tied.
_agent_transcript_jsonl() {
    local session_name="$1"
    _agent_transcript_identity_args
    local args=("${_AGENT_TRANSCRIPT_IDENTITY_ARGS[@]}")

    # The capture is only needed for live resolution; the explicit seam skips it.
    local capture=""
    if [[ -z "${MENTIKO_TRANSCRIPT_JSONL:-}" ]]; then
        capture=$(transport_capture "$session_name" "${MENTIKO_TRANSCRIPT_CAPTURE_LINES:-2000}" 2>/dev/null)
    fi

    printf '%s' "$capture" | _agent_transcript_cli resolve "${args[@]}" 2>/dev/null || return 0
}

# durable standalone AGENT_COMPLETE: the marker on its own line in the agent's
# recorded transcript output. Returns 0 iff durably present; fails closed (1)
# when the transcript is unresolvable, unproven against this run's identity, or
# ambiguous, so completion falls back to the declared event file rather than
# trusting the rendered screen. Invocation-only: identity binding and marker
# validation both live in the typed owner.
agent-complete-marker-durable() {
    local session_name="$1"
    _agent_transcript_identity_args
    local args=("${_AGENT_TRANSCRIPT_IDENTITY_ARGS[@]}")

    local capture=""
    if [[ -z "${MENTIKO_TRANSCRIPT_JSONL:-}" ]]; then
        capture=$(transport_capture "$session_name" "${MENTIKO_TRANSCRIPT_CAPTURE_LINES:-2000}" 2>/dev/null)
    fi

    printf '%s' "$capture" | _agent_transcript_cli durable-marker "${args[@]}" 2>/dev/null
}

# -------------------------------------------------------------------
# agent-completion-latched: authoritative "agent is done" signal.
#
# Completion comes from durable signals, never from re-scanning a fixed
# tail window each poll (a chatty agent scrolls AGENT_COMPLETE past the
# capture window — finding #4). Two authoritative signals, OR-latched:
#
#   1. AGENT_COMPLETE seen at least once. The marker is sticky: once a poll
#      observes it we touch a latch file so later polls still count it even
#      after the line scrolls off. (We do NOT re-derive completion from the
#      live tail alone.)
#   2. The agent's declared `emits` event file exists for THIS run
#      (monitor_completion_event_file) — durable proof the agent produced
#      its handoff, independent of terminal scrollback entirely.
#
# Either one latches completion. Caller passes the latch file path.
# Returns 0 when complete, 1 when no completion signal exists yet, and 2 when
# the typed event lookup itself failed. Callers must stop on 2; it is not a
# normal no-match.
# -------------------------------------------------------------------
agent-completion-latched() {
    local session_name="$1"
    local latch_file="$2"
    local chain_file="${3:-}"
    local events_dir="${4:-${EVENTS_DIR:-}}"
    local agent_id="${5:-${MENTIKO_AGENT_ID:-}}"
    local tail_lines="${6:-${MENTIKO_MONITOR_MARKER_TAIL:-100}}"

    # already latched on a prior poll
    if [[ -n "$latch_file" && -f "$latch_file" ]]; then
        return 0
    fi

    # signal 1: AGENT_COMPLETE marker, DURABLY confirmed. The rendered screen is
    # only a cheap trigger; a pty resize can re-wrap the instruction echo into a
    # standalone marker line (BUG-022), so the latch also requires the marker in
    # the durable session transcript, which cannot be re-wrapped. Fail-closed
    # transcript resolution means we simply keep waiting for the event file
    # (signal 2) instead of latching a still-working agent off the screen.
    if agent-complete-marker-seen "$session_name" "$tail_lines" \
        && agent-complete-marker-durable "$session_name"; then
        [[ -n "$latch_file" ]] && : > "$latch_file" 2>/dev/null || true
        return 0
    fi

    # signal 2: the agent's declared emits event file exists for this run.
    # This is authoritative even if the marker never appears in the capture
    # window (chatty agent) — the durable event file proves handoff.
    if [[ -n "$chain_file" && -f "$chain_file" ]]; then
        if ! declare -f monitor_completion_event_file >/dev/null; then
            echo "error: typed completion-event lookup is unavailable for session '$session_name'; stopping monitor" >&2
            return 2
        fi
        local ev=""
        if ! ev="$(monitor_completion_event_file "$session_name" "$chain_file" "$events_dir" "$agent_id")"; then
            echo "error: completion-event lookup failed for session '$session_name'; stopping monitor" >&2
            return 2
        fi
        if [[ -n "$ev" ]]; then
            [[ -n "$latch_file" ]] && : > "$latch_file" 2>/dev/null || true
            return 0
        fi
    fi

    return 1
}

# -------------------------------------------------------------------
# monitor failure/stall surfacing (findings #1 + #2, agent-functions side)
#
# CORE PRINCIPLE: stale != complete, and dead != succeeded. The monitor must
# NEVER emit the agent's declared success event on a stall or a dead process,
# and must NEVER run the success completion path for those cases. It records a
# non-success status and emits a DIAGNOSTIC event so the run is visibly
# stuck/failed (so on_error handling can engage) instead of falsely complete.
#
# These mirror chain-runner.sh's startup-path semantics:
#   dead process w/o event  -> run+agent status FAILED  (cf. mark_run_agent_failed, :1874)
#                              diagnostic event: agent-error
#   alive but quiescent      -> run+agent status BLOCKED (cf. mark_run_agent_blocked, :1865)
#                              diagnostic event: agent-timeout
# and the typed watchdog's run-stalled surfacing pattern:
# a system/diagnostic event with structured fields, NOT a faked handoff.
#
# DIAGNOSTIC EVENT SHAPE (consumed by hooks/notifications/log, never by the
# completion matcher — source is "monitor", not the agent id, so it can never
# satisfy reconciler's source.includes(agentId) test):
#   event:   agent-timeout | agent-error   (both canonical, in the schema enum)
#   source:  monitor
#   run_id:  <run id>
#   processed: false
#   data:     one-line JSON with agent, reason, and optional detail
#   filename: ${ts}-${run_id}-${agent_id}-${event}.event   (own scheme, like
#             watchdog's ${ts}-run-stalled.event — NOT the canonical
#             ${run_id}-${source}-${event}.event handoff naming)
#
# -------------------------------------------------------------------

# _monitor_agent_process_gone: reliable "the agent CLI is no longer running".
#
# The PTY pane process is a persistent interactive shell; the agent CLI runs as a
# CHILD command inside it (chain-runner.sh launches `bash agent-start-script` ->
# the CLI). So `ps -p <pane_pid>` checks the SHELL, not the CLI — a CLI that
# exits/crashes leaves the shell alive at an idle prompt and `ps -p` never sees
# it. The reliable signal (same one chain-runner's startup check uses,
# session_has_active_command at :754) is whether the pane has an ACTIVE CHILD
# COMMAND: `pgrep -P <pane_pid>`. Non-empty while the CLI runs, empty once it has
# exited and the shell is idle.
#
# To avoid false positives we (1) "arm" once the CLI has been seen running at
# least once (the fast path), and (2) debounce a no-child reading with a short
# re-check (transient fork gaps).
#
# NEVER-ARMED GRACE (containerized-runtime fix): arming must not be a
# precondition the agent's death can starve. On slow runtimes (the shipped
# tenant container: session spawn + monitor bootstrap take many seconds) a CLI
# can die BEFORE the monitor's first observation; requiring a live-child
# sighting then meant death was undetectable forever and the run stranded at
# "running". The honest semantics: a process that died before the monitor ever
# saw it alive is still a dead process. So when never armed, count consecutive
# no-child observations; after MENTIKO_MONITOR_NEVER_ARMED_GRACE of them
# (default 5) with the debounce still empty, report gone. The caller
# (monitor-agent-died) checks for a genuine completion event FIRST, so a
# fast-but-successful agent completes normally — only "process gone + no
# event" becomes a failure. A quiet-but-ALIVE agent always has a pane child,
# arms on the first tick, and is never touched by the grace path.
# args: <session_name> <armed_file>   -> returns 0 if the agent CLI is gone.
_monitor_agent_process_gone() {
    local session_name="$1"
    local armed_file="$2"

    local pane_pid
    pane_pid="$(transport_pid "$session_name" 2>/dev/null || true)"
    [[ -n "$pane_pid" ]] || return 1   # can't tell -> not gone

    if command -v pgrep >/dev/null 2>&1; then
        local grace_file=""
        [[ -n "$armed_file" ]] && grace_file="${armed_file}_grace"
        if pgrep -P "$pane_pid" >/dev/null 2>&1; then
            # CLI (a child command) is running -> arm + alive
            [[ -n "$armed_file" ]] && : > "$armed_file" 2>/dev/null || true
            [[ -n "$grace_file" ]] && rm -f "$grace_file" 2>/dev/null
            return 1
        fi
        if [[ -z "$armed_file" || ! -f "$armed_file" ]]; then
            # NEVER ARMED: the monitor has not yet seen the CLI alive. Do not
            # treat that as "not gone" forever — a CLI that died before our
            # first observation is still dead (see header). Count consecutive
            # no-child observations; only after the grace expires do we fall
            # through to the debounced gone-check below.
            [[ -n "$grace_file" ]] || return 1   # nowhere to count -> stay conservative
            local _grace=0
            [[ -f "$grace_file" ]] && _grace="$(cat "$grace_file" 2>/dev/null || echo 0)"
            [[ "$_grace" =~ ^[0-9]+$ ]] || _grace=0
            _grace=$(( _grace + 1 ))
            echo "$_grace" > "$grace_file" 2>/dev/null || true
            local _grace_max="${MENTIKO_MONITOR_NEVER_ARMED_GRACE:-5}"
            [[ "$_grace_max" =~ ^[0-9]+$ && "$_grace_max" -gt 0 ]] || _grace_max=5
            if (( _grace < _grace_max )); then
                return 1
            fi
        fi
        # debounce: re-check after a beat to avoid a transient fork gap.
        sleep 1
        if pgrep -P "$pane_pid" >/dev/null 2>&1; then
            # the CLI showed up during the debounce: arm and reset the grace.
            [[ -n "$armed_file" ]] && : > "$armed_file" 2>/dev/null || true
            [[ -n "$grace_file" ]] && rm -f "$grace_file" 2>/dev/null
            return 1
        fi
        return 0   # no child twice (armed, or never-armed grace expired) = gone
    fi

    # pgrep unavailable: fall back to the (coarser) pane-process liveness check.
    ps -p "$pane_pid" >/dev/null 2>&1 && return 1 || return 0
}

# lazily make run-lib status helpers available to the monitor. agent-functions.sh
# does not source run-lib.sh directly, so standalone monitor scripts load it only
# when durable status mutation is needed.
_monitor_ensure_run_helpers() {
    if declare -f update-run-agent >/dev/null && declare -f update-run-status >/dev/null; then
        return 0
    fi
    local d
    d="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    # run-lib.sh asserts `set -euo pipefail` at its top level; sourcing it would
    # re-arm errexit/nounset in this monitor shell and abort the handler that
    # called us. Snapshot the current shell options, source, then restore — so
    # the monitor keeps its relaxed semantics regardless of run-lib's prelude.
    local _saved_set_opts
    _saved_set_opts="$(set +o)"
    source "$d/run-lib.sh" 2>/dev/null || true
    eval "$_saved_set_opts" 2>/dev/null || true
    declare -f update-run-agent >/dev/null
}

# resolve the agent id this monitored session belongs to.
_monitor_resolve_agent_id() {
    local session_name="$1"
    local chain_file="${2:-}"
    if [[ -n "${MENTIKO_AGENT_ID:-}" ]]; then
        printf '%s' "$MENTIKO_AGENT_ID"
        return 0
    fi
    if declare -f monitor_agent_id_for_session >/dev/null; then
        monitor_agent_id_for_session "$session_name" "$chain_file" 2>/dev/null || true
    fi
}

# write a diagnostic (non-handoff) event through the typed event owner.
_monitor_emit_diagnostic_event() {
    local event_name="$1"   # agent-stalled | agent-error
    local agent_id="$2"
    local reason="$3"
    local stale_count="${4:-}"

    local run_id="${MENTIKO_RUN_ID:-${RUN_ID:-}}"
    local args=(diagnostic --scope run --event "$event_name" --source "monitor" --run-id "$run_id" --agent "$agent_id" --reason "$reason")
    [[ -n "$stale_count" ]] && args+=(--stale-count "$stale_count")
    node "${MENTIKO_CODE_ROOT:?MENTIKO_CODE_ROOT must be configured}/lib/runner-event-emitter.js" "${args[@]}"
}

# monitor-agent-stalled: an alive agent went quiescent past the stale budget.
# Surface as BLOCKED (needs intervention) — NOT complete, NOT failed. The process
# is still alive and the md5 heuristic is known-blind to spinner redraws, so a
# stall verdict is uncertain; blocked lets the watchdog/reconciler/human take over
# while ensuring nothing routes forward as success.
monitor-agent-stalled() {
    local session_name="$1"
    local chain_file="${2:-}"
    local stale_count="${3:-0}"
    local reason="${4:-monitor: agent output quiescent past max stale count ($stale_count)}"

    local agent_id
    agent_id="$(_monitor_resolve_agent_id "$session_name" "$chain_file")"
    local run_id="${MENTIKO_RUN_ID:-${RUN_ID:-}}"

    echo "$(date '+%H:%M:%S') - agent stalled (blocked): $reason"

    _monitor_ensure_run_helpers || true
    if [[ -n "$run_id" ]]; then
        if [[ -n "$agent_id" ]] && declare -f update-run-agent >/dev/null; then
            update-run-agent "$run_id" "$agent_id" "blocked" 2>/dev/null || true
        fi
        if declare -f update-run-status >/dev/null; then
            update-run-status "$run_id" "blocked" "$reason" 2>/dev/null || true
        fi
    fi

    # agent-timeout is the canonical lifecycle name for "agent did not finish in
    # its time budget" (in the schema enum + event contract). Output-quiescence
    # past max-stale is exactly that. source:monitor (not the agent id) guarantees
    # the completion matcher can never mistake this for a success handoff.
    _monitor_emit_diagnostic_event "agent-timeout" "${agent_id:-unknown}" "$reason" \
        "$stale_count"
}

# monitor-agent-died: the agent process is gone. If a genuine completion event
# already exists for this run, the agent finished and the process simply exited —
# complete normally. Otherwise the process died WITHOUT producing its handoff:
# that is a FAILURE, never a fabricated success. Record failure + diagnostic and
# do NOT run the success completion path.
# Returns 0 if it handled a real completion (caller should still break),
# 1 if it recorded a failure (caller should break without completing), and
# 2 if completion-event lookup failed before either classification was safe.
monitor-agent-died() {
    local session_name="$1"
    local chain_file="${2:-}"
    local reason="${3:-monitor: agent process exited before producing its completion event}"

    local agent_id
    agent_id="$(_monitor_resolve_agent_id "$session_name" "$chain_file")"
    local run_id="${MENTIKO_RUN_ID:-${RUN_ID:-}}"
    local events_dir="${EVENTS_DIR:-}"

    # Did the agent already emit its declared completion event for this run?
    local completion_event=""
    if [[ -n "$chain_file" && -f "$chain_file" ]]; then
        if ! declare -f monitor_completion_event_file >/dev/null; then
            echo "error: cannot classify exited agent '$session_name'; typed completion-event lookup is unavailable" >&2
            return 2
        fi
        if ! completion_event="$(monitor_completion_event_file "$session_name" "$chain_file" "$events_dir" "$agent_id")"; then
            echo "error: cannot classify exited agent '$session_name'; completion-event lookup failed" >&2
            return 2
        fi
    fi

    if [[ -n "$completion_event" ]]; then
        # genuine completion: the agent produced its handoff, then its process
        # exited. Run the normal completion handler (NOT a fabrication).
        echo "  process gone but completion event exists ($(basename "$completion_event")); completing normally"
        if [[ -n "$chain_file" && -f "$chain_file" ]]; then
            launch-chain-runner-complete "$session_name" "$chain_file"
        fi
        return 0
    fi

    # dead without event = failure. Do NOT fabricate the success event; do NOT
    # run the completion handler.
    echo "  process gone with NO completion event: $reason"
    _monitor_ensure_run_helpers || true
    if [[ -n "$run_id" ]]; then
        if [[ -n "$agent_id" ]] && declare -f update-run-agent >/dev/null; then
            update-run-agent "$run_id" "$agent_id" "failed" 2>/dev/null || true
        fi
        if declare -f update-run-status >/dev/null; then
            update-run-status "$run_id" "failed" "$reason" 2>/dev/null || true
        fi
    fi
    _monitor_emit_diagnostic_event "agent-error" "${agent_id:-unknown}" "$reason"
    return 1
}

launch-chain-runner-complete() {
    local session_name="$1"
    local chain_file="$2"
    local script_dir
    if [[ -z "$session_name" || -z "$chain_file" || ! -f "$chain_file" ]]; then
        echo "  runner-v2 completion not launched: missing chain.json"
        return 1
    fi

    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    local completion_launcher=""

    # Completion ownership is unconditionally typed, including agents launched
    # by the remaining shell bootstrap. Missing/unsupported typed completion
    # fails closed; there is no shell handler or detached fallback.
    if ! command -v node >/dev/null 2>&1; then
        echo "  runner-v2 completion failed closed: node unavailable" >&2
        return 1
    fi
    if [[ -f "$script_dir/runner-v2-completion-launch.js" ]]; then
        completion_launcher="$script_dir/runner-v2-completion-launch.js"
    else
        echo "  runner-v2 completion failed closed: typed completion entrypoint missing" >&2
        return 1
    fi
    # The typed launcher copies the allowlisted environment into a private,
    # one-shot 0600 context file. PTY metadata receives only its random path.
    if node "$completion_launcher" "$session_name" "$chain_file"; then
        echo "  runner-v2 completion session started"
        return 0
    fi

    echo "  runner-v2 completion failed closed; no shell completion fallback exists"
    return 1
}

completion-chain-required() {
    local session_name="${1:-unknown}"
    echo "  runner-v2 completion unsupported: no chain.json for session $session_name" >&2
    echo "  completion left active and unacknowledged; no shell completion fallback exists" >&2
    return 2
}

# -------------------------------------------------------------------
# monitor-with-ai: watch an agent session, nudge when stale,
# trigger completion handler on AGENT_COMPLETE
# -------------------------------------------------------------------
monitor-with-ai() {
    # This long-lived poll loop contains intentionally-non-zero probes and reads
    # optional vars. Keep forgiving shell options regardless of its caller.
    set +e +u +o pipefail 2>/dev/null || true

    local session_name="$1"
    local check_interval="${2:-$MENTIKO_MONITOR_INTERVAL}"
    local agent_context="${3:-}"
    local max_stale_count="${4:-${DEFAULT_MAX_STALE_COUNT:-5}}"
    local advisor_stale_threshold="${MENTIKO_ADVISOR_STALE_COUNT:-3}"
    # legacy spec-driven path has no chain.json, but CHAIN_FILE may be exported;
    # if present it lets the failure/completion helpers consult the event file.
    local chain_file="${CHAIN_FILE:-}"
    local state_dir="$HOME/.mentiko_monitor"
    local state_file="$state_dir/${session_name}_state"
    local stale_count_file="$state_dir/${session_name}_stale"

    mkdir -p "$state_dir"
    echo "0" > "$stale_count_file"

    # wait for session to appear (handles race with agent launch)
    local retries=0
    while ! transport_has_session "$session_name" 2>/dev/null; do
        retries=$((retries + 1))
        if [[ $retries -ge 10 ]]; then
            echo "  error: session '$session_name' not found after 30s"
            return 1
        fi
        echo "  waiting for session '$session_name'... ($retries/10)"
        sleep 3
    done

    echo "  monitoring '$session_name' every ${check_interval}s..."

    # initial state
    local current_state=$(transport_capture "$session_name" 20 | md5sum | cut -d' ' -f1)
    echo "$current_state" > "$state_file"

    while true; do
        sleep "$check_interval"

        if ! transport_has_session "$session_name" 2>/dev/null; then
            echo "  session '$session_name' gone. stopping."
            rm -f "$state_file" "$stale_count_file"
            break
        fi

        # check agent-CLI liveness (detect a CLI that exited/crashed).
        # dead != succeeded: if the CLI is gone without its completion event,
        # this is a FAILURE, not a fabricated success (finding #2).
        if _monitor_agent_process_gone "$session_name" "$state_dir/${session_name}_armed"; then
            echo "  agent CLI in session '$session_name' is no longer running."
            sleep 3
            # monitor-agent-died completes normally IFF a real event exists,
            # otherwise records failure + diagnostic (never fabricates success).
            monitor-agent-died "$session_name" "$chain_file"
            local died_rc=$?
            rm -f "$state_file" "$stale_count_file" "$state_dir/${session_name}_complete" "$state_dir/${session_name}_armed" "$state_dir/${session_name}_armed_grace"
            if [[ "$died_rc" -eq 2 ]]; then
                return 2
            fi
            break
        fi

        # check for completion signal. Completion is latched from authoritative
        # signals (AGENT_COMPLETE sighting OR the agent's emitted event file), so
        # a chatty agent that scrolls the marker off-screen still completes
        # (finding #4). The marker must be on its own line so prose like
        # "output AGENT_COMPLETE" in the prompt is ignored.
        agent-completion-latched "$session_name" "$state_dir/${session_name}_complete" "$chain_file"
        local completion_latch_rc=$?
        if [[ "$completion_latch_rc" -eq 0 ]]; then
            echo "$(date '+%H:%M:%S') - AGENT_COMPLETE detected"
            echo "  triggering completion handler..."

            if [[ -n "$chain_file" && -f "$chain_file" ]]; then
                launch-chain-runner-complete "$session_name" "$chain_file" || return $?
            else
                completion-chain-required "$session_name"
                return 2
            fi
            rm -f "$state_file" "$stale_count_file" "$state_dir/${session_name}_complete" "$nudge_count_file"
            break
        elif [[ "$completion_latch_rc" -eq 2 ]]; then
            return 2
        fi

        # md5 of the last 20 lines is a QUIESCENCE trigger for nudges/diagnostics
        # ONLY — never a completion signal. KNOWN BLINDNESS: a CLI that repaints a
        # spinner/status line keeps the hash changing so a genuinely hung agent can
        # read as "active"; conversely a quiet-but-working agent reads as stale.
        # Because of that unreliability, max-stale never completes — it surfaces.
        local new_state=$(transport_capture "$session_name" 20 | md5sum | cut -d' ' -f1)
        local old_state=""
        [[ -f "$state_file" ]] && old_state=$(cat "$state_file")

        if [[ "$new_state" == "$old_state" ]]; then
            local stale_count=$(cat "$stale_count_file")
            stale_count=$((stale_count + 1))
            echo "$stale_count" > "$stale_count_file"

            # max stale reached: stale != complete. The agent is alive but quiet;
            # surface it as BLOCKED (intervention) — do NOT emit its success event
            # and do NOT run the completion path (finding #1).
            if [[ $stale_count -ge $max_stale_count ]]; then
                monitor-agent-stalled "$session_name" "$chain_file" "$stale_count" \
                    "monitor: agent output quiescent for ${stale_count} stale cycles (max ${max_stale_count})"
                rm -f "$state_file" "$stale_count_file" "$state_dir/${session_name}_complete" "$nudge_count_file"
                break
            fi

            if declare -f monitor_should_ask_advisor >/dev/null && ! monitor_should_ask_advisor "$stale_count" "$advisor_stale_threshold"; then
                echo "$(date '+%H:%M:%S') - stale ($stale_count). waiting for advisor threshold ($advisor_stale_threshold)."
                echo "$new_state" > "$state_file"
                continue
            fi

            echo "$(date '+%H:%M:%S') - stale ($stale_count). asking Mentiko advisor..."

            local response=""
            if declare -f monitor_stale_nudge_message >/dev/null; then
                response="$(monitor_stale_nudge_message "$stale_count" "$session_name" "$agent_context" "$check_interval")"
            else
                response="Resume only the current assigned task. If it is complete, write its event file and make the final non-empty line exactly AGENT_COMPLETE."
            fi
            if declare -f monitor_sanitize_nudge >/dev/null; then
                response="$(monitor_sanitize_nudge "$response" "$stale_count")"
            fi
            echo "  -> $response"

            # send text first, wait for terminal to receive it, then press Enter
            transport_send_raw "$session_name" "$response"
            sleep 1
            transport_send_raw "$session_name" $'\r'
            sleep 0.5
        else
            echo "$(date '+%H:%M:%S') - active"
            echo "0" > "$stale_count_file"
        fi

        echo "$new_state" > "$state_file"
    done
}

# -------------------------------------------------------------------
# monitor-chain-agent: JSON-driven monitor variant
# uses chain.json for completion handling instead of grep-parsing specs
# supports local, ssh, and docker workspaces
# -------------------------------------------------------------------
monitor-chain-agent() {
    # The monitor runs as a long-lived poll loop with commands that legitimately
    # return non-zero (alive probes, not-yet completion, grep misses) and optional
    # vars. Keep forgiving shell options so one probe cannot strand the run.
    set +e +u +o pipefail 2>/dev/null || true

    local session_name="$1"
    local check_interval="${2:-5}"
    local agent_context="${3:-}"
    local chain_file="${4:-${CHAIN_FILE:-}}"
    local workspace_type="${WORKSPACE_TYPE:-local}"
    local max_stale_count="${5:-${DEFAULT_MAX_STALE_COUNT:-5}}"
    local advisor_stale_threshold="${MENTIKO_ADVISOR_STALE_COUNT:-3}"
    local state_dir="$HOME/.mentiko_monitor"
    local state_file="$state_dir/${session_name}_state"
    local stale_count_file="$state_dir/${session_name}_stale"
    # durable nudge budget: a hard ceiling on keystrokes typed into a quiescent
    # session, tracked in a file the screen-echo reset never touches. The
    # per-cycle stale counter is defeated because each nudge's echo repaints the
    # screen and resets it (so it never reaches max_stale_count from the nudge
    # path); this budget survives that AND a monitor restart, so a 0-progress
    # agent is escalated instead of nudged forever.
    local nudge_count_file="$state_dir/${session_name}_nudges"
    local max_total_nudges="${MENTIKO_MONITOR_MAX_NUDGES:-5}"

    mkdir -p "$state_dir"
    echo "0" > "$stale_count_file"
    [[ -f "$nudge_count_file" ]] || echo "0" > "$nudge_count_file"

    # wait for session to appear (handles race with agent launch)
    local retries=0
    while ! transport_has_session "$session_name" 2>/dev/null; do
        retries=$((retries + 1))
        if [[ $retries -ge 10 ]]; then
            echo "  error: session '$session_name' not found after 30s"
            return 1
        fi
        echo "  waiting for session '$session_name'... ($retries/10)"
        sleep 3
    done

    echo "  monitoring '$session_name' every ${check_interval}s (chain mode, workspace: $workspace_type)..."

    local current_state=$(transport_capture "$session_name" 20 | md5sum | cut -d' ' -f1)
    echo "$current_state" > "$state_file"
    local observed_completion_event_file=""
    # after a nudge, the agent's echo of it can span a COUPLE of poll cycles — the
    # PTY first echoes the typed keystrokes, then the agent prints its own
    # response. This grace window absorbs those cycles so nudge-induced repaints
    # are not miscredited as real progress (which would wrongly refill the budget
    # and let the loop run forever — the very bug the budget exists to stop). A
    # single-cycle flag is NOT enough: it catches the keystroke echo but the
    # agent's response on the next cycle then refills the budget.
    local nudge_echo_grace=0

    while true; do
        sleep "$check_interval"

        if ! transport_has_session "$session_name" 2>/dev/null; then
            echo "  session '$session_name' gone. stopping."
            rm -f "$state_file" "$stale_count_file"
            break
        fi

        # check agent-CLI liveness (detect a CLI that exited/crashed).
        # skip for remote workspaces (process check not supported remotely).
        # dead != succeeded: monitor-agent-died completes normally ONLY if the
        # agent's real completion event already exists; otherwise it records
        # failure + a diagnostic event and does NOT hand off to the completion
        # handler (which would otherwise fabricate a success — finding #2).
        if [[ "$workspace_type" == "local" ]]; then
            if _monitor_agent_process_gone "$session_name" "$state_dir/${session_name}_armed"; then
                echo "  agent CLI in session '$session_name' is no longer running."
                monitor-agent-died "$session_name" "$chain_file" \
                    "monitor: agent CLI process exited before producing its completion event"
                local died_rc=$?
                rm -f "$state_file" "$stale_count_file" "$state_dir/${session_name}_complete" "$state_dir/${session_name}_armed" "$state_dir/${session_name}_armed_grace"
                if [[ "$died_rc" -eq 2 ]]; then
                    return 2
                fi
                break
            fi
        fi

        # Event files mean the agent has produced handoff data. They are not
        # the kill signal. The agent still owns its final terminal response and
        # must print AGENT_COMPLETE before the chain completion handler runs.
        local completion_event_file=""
        if ! declare -f monitor_completion_event_file >/dev/null; then
            echo "error: typed completion-event observation is unavailable for session '$session_name'; stopping monitor" >&2
            return 2
        fi
        if ! completion_event_file="$(monitor_completion_event_file "$session_name" "$chain_file" "$EVENTS_DIR" "${MENTIKO_AGENT_ID:-}")"; then
            echo "error: completion-event observation failed for session '$session_name'; stopping monitor" >&2
            return 2
        fi
        if [[ -n "$completion_event_file" && "$completion_event_file" != "$observed_completion_event_file" ]]; then
            observed_completion_event_file="$completion_event_file"
            echo "$(date '+%H:%M:%S') - completion event observed: $(basename "$completion_event_file"); waiting for AGENT_COMPLETE"
        fi

        # -----------------------------------------------------------
        # COMPLETION DETECTION PROTOCOL:
        #
        # Completion is LATCHED from authoritative signals, not re-scraped from a
        # fixed tail window each poll:
        #   - AGENT_COMPLETE seen at least once (sticky latch), OR
        #   - the agent's declared emits event file exists for this run.
        # A chatty agent that scrolls AGENT_COMPLETE past the capture window still
        # completes via the event-file signal (finding #4).
        #
        # The md5 hash of the last 20 lines is ONLY an activity/quiescence trigger
        # for nudges; it is NEVER a completion signal and never force-completes.
        # KNOWN BLINDNESS: spinner/status-line redraws keep the hash changing, so a
        # hung agent can read "active"; a quiet-but-working agent reads "stale".
        # claude doesn't exit on context exhaustion — it idles at the prompt, so
        # process liveness alone is not enough either; the latch above is the
        # authoritative "done" signal.
        # -----------------------------------------------------------

        # Check completion before classifying output as "active". Some CLIs repaint
        # status lines after the agent's final text, so waiting for a stable hash
        # can miss the completion window and send a stale nudge.
        agent-completion-latched "$session_name" "$state_dir/${session_name}_complete" "$chain_file" "$EVENTS_DIR" "${MENTIKO_AGENT_ID:-}"
        local completion_latch_rc=$?
        if [[ "$completion_latch_rc" -eq 0 ]]; then
            echo "$(date '+%H:%M:%S') - AGENT_COMPLETE detected"
            sleep 3

            # profiler: take final snapshot before completion
            if declare -f profiler-snapshot >/dev/null; then
                profiler-snapshot "$session_name" "pre-complete" 2>/dev/null || true
            fi

            local script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
            if [[ -n "$chain_file" && -f "$chain_file" ]]; then
                echo "  using runner-v2 completion"
                launch-chain-runner-complete "$session_name" "$chain_file" || return $?
            else
                completion-chain-required "$session_name"
                return 2
            fi
            rm -f "$state_file" "$stale_count_file" "$state_dir/${session_name}_complete" "$nudge_count_file"
            break
        elif [[ "$completion_latch_rc" -eq 2 ]]; then
            return 2
        fi

        local new_state=$(transport_capture "$session_name" 20 | md5sum | cut -d' ' -f1)
        local old_state=""
        [[ -f "$state_file" ]] && old_state=$(cat "$state_file")

        if [[ "$new_state" != "$old_state" ]]; then
            if [[ -n "$completion_event_file" ]]; then
                local stale_count=$(cat "$stale_count_file")
                stale_count=$((stale_count + 1))
                echo "$stale_count" > "$stale_count_file"

                if declare -f monitor_should_ask_advisor >/dev/null && ! monitor_should_ask_advisor "$stale_count" "$advisor_stale_threshold"; then
                    echo "$(date '+%H:%M:%S') - completion event exists; waiting for AGENT_COMPLETE threshold ($stale_count/$advisor_stale_threshold)."
                    echo "$new_state" > "$state_file"
                    continue
                fi

                # bound the keystrokes: this branch fires while the screen keeps
                # CHANGING, so without a ceiling a forever-repainting session with a
                # completion event present would be nudged indefinitely (the
                # max_stale_count break below only guards the hash-stable branch).
                # The completion event is authoritative — the latch completes this
                # run once the screen stabilises — so past the budget we stop typing
                # into the session rather than spam it.
                if [[ $stale_count -ge $max_stale_count ]]; then
                    echo "$(date '+%H:%M:%S') - completion event exists; nudge budget exhausted (${stale_count}/${max_stale_count}); awaiting latch, not nudging."
                    echo "$new_state" > "$state_file"
                    continue
                fi

                echo "$(date '+%H:%M:%S') - completion event already exists; nudging for AGENT_COMPLETE..."
                local nudge_msg="Your completion event exists. Finish the final terminal response and make the final non-empty line exactly AGENT_COMPLETE. Do not redo the task."
                if declare -f monitor_sanitize_nudge >/dev/null; then
                    nudge_msg="$(monitor_sanitize_nudge "$nudge_msg" "$stale_count")"
                fi
                transport_send_raw "$session_name" "$nudge_msg"
                sleep 1
                transport_send_raw "$session_name" $'\r'
                sleep 0.5
                echo "$new_state" > "$state_file"
                continue
            fi
            # output changed → agent is actively working
            echo "$(date '+%H:%M:%S') - active"
            echo "0" > "$stale_count_file"
            echo "$new_state" > "$state_file"
            # Only progress we did NOT cause refills the nudge budget. A nudge's
            # echo spans a few cycles (typed keystrokes, then the agent's
            # response); the grace window absorbs them. Activity beyond the window
            # is real progress and safely refills the budget. This stops a 0-work
            # session from refilling its budget by echoing our keystrokes — the
            # exact loop that defeated the per-cycle stale cap.
            if [[ "${nudge_echo_grace:-0}" -gt 0 ]]; then
                nudge_echo_grace=$((nudge_echo_grace - 1))
            else
                echo "0" > "$nudge_count_file"
            fi

            # profiler: periodic snapshot (every cycle)
            if declare -f profiler-snapshot >/dev/null; then
                profiler-snapshot "$session_name" "monitor-check" 2>/dev/null || true
            fi
            continue
        fi

        # hash stable → agent is idle. Use the latched completion signal (marker
        # sighting OR emitted event file); the prompt contains AGENT_COMPLETE too,
        # so the marker check intentionally avoids substring matches.
        agent-completion-latched "$session_name" "$state_dir/${session_name}_complete" "$chain_file" "$EVENTS_DIR" "${MENTIKO_AGENT_ID:-}"
        completion_latch_rc=$?
        if [[ "$completion_latch_rc" -eq 0 ]]; then
            echo "$(date '+%H:%M:%S') - AGENT_COMPLETE detected"
            sleep 3

            # profiler: take final snapshot before completion
            if declare -f profiler-snapshot >/dev/null; then
                profiler-snapshot "$session_name" "pre-complete" 2>/dev/null || true
            fi

            local script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
            if [[ -n "$chain_file" && -f "$chain_file" ]]; then
                echo "  using runner-v2 completion"
                launch-chain-runner-complete "$session_name" "$chain_file" || return $?
            else
                completion-chain-required "$session_name"
                return 2
            fi
            rm -f "$state_file" "$stale_count_file" "$state_dir/${session_name}_complete" "$nudge_count_file"
            break
        elif [[ "$completion_latch_rc" -eq 2 ]]; then
            return 2
        fi

        # idle but no AGENT_COMPLETE → agent is stalled, nudge it
        local stale_count=$(cat "$stale_count_file")
        stale_count=$((stale_count + 1))
        echo "$stale_count" > "$stale_count_file"

        # max stale reached: stale != complete. The agent is alive but quiescent.
        # Surface it as BLOCKED (intervention) and stop monitoring — do NOT emit
        # its success event and do NOT run the completion handler (finding #1).
        # If a completion event already exists, this is the chatty/slow-final case
        # handled by the latch above, so reaching here means no event yet.
        if [[ $stale_count -ge $max_stale_count ]]; then
            monitor-agent-stalled "$session_name" "$chain_file" "$stale_count" \
                "monitor: agent output quiescent for ${stale_count} stale cycles (max ${max_stale_count}); no AGENT_COMPLETE and no completion event"
            rm -f "$state_file" "$stale_count_file" "$state_dir/${session_name}_complete" "$nudge_count_file"
            break
        fi

        if declare -f monitor_should_ask_advisor >/dev/null && ! monitor_should_ask_advisor "$stale_count" "$advisor_stale_threshold"; then
            echo "$(date '+%H:%M:%S') - stale ($stale_count). waiting for advisor threshold ($advisor_stale_threshold)."
            echo "$new_state" > "$state_file"
            continue
        fi

        # durable nudge budget gate: past the budget, a quiescent agent is
        # escalated as BLOCKED instead of being typed at forever. The per-cycle
        # stale counter can never reach max_stale_count here — each nudge's echo
        # repaints the screen and resets it — so this file-backed ceiling is the
        # only thing that actually stops an unresponsive (e.g. 0-token) session.
        local nudge_total=0
        [[ -f "$nudge_count_file" ]] && nudge_total=$(cat "$nudge_count_file" 2>/dev/null || echo 0)
        if [[ "${nudge_total:-0}" -ge "$max_total_nudges" ]]; then
            echo "$(date '+%H:%M:%S') - nudge budget spent (${nudge_total}/${max_total_nudges}); escalating, not nudging."
            monitor-agent-stalled "$session_name" "$chain_file" "$nudge_total" \
                "monitor: no real progress after ${nudge_total} nudges (budget ${max_total_nudges}); escalating instead of nudging an unresponsive session indefinitely"
            rm -f "$state_file" "$stale_count_file" "$state_dir/${session_name}_complete" "$nudge_count_file"
            break
        fi

        echo "$(date '+%H:%M:%S') - stale ($stale_count). asking Mentiko advisor..."

        # nudge the agent via pty send keys
        local nudge_msg=""
        if [[ -n "$completion_event_file" ]]; then
            nudge_msg="Your completion event exists. Finish the final terminal response and make the final non-empty line exactly AGENT_COMPLETE. Do not redo the task."
        elif declare -f monitor_stale_nudge_message >/dev/null; then
            nudge_msg="$(monitor_stale_nudge_message "$stale_count" "$session_name" "$agent_context" "$check_interval")"
        elif [[ $stale_count -le 4 ]]; then
            nudge_msg="continue only the current assigned task, or write your event file and output AGENT_COMPLETE on its own line."
        else
            nudge_msg="write your event file and summary artifacts, then make your final non-empty terminal line exactly AGENT_COMPLETE with no text after it."
        fi
        if declare -f monitor_sanitize_nudge >/dev/null; then
            nudge_msg="$(monitor_sanitize_nudge "$nudge_msg" "$stale_count")"
        fi

        transport_send_raw "$session_name" "$nudge_msg"
        sleep 1
        transport_send_raw "$session_name" $'\r'
        sleep 0.5

        # charge this keystroke against the durable budget and mark that the next
        # "active" cycle is our own echo, not progress.
        echo "$(( ${nudge_total:-0} + 1 ))" > "$nudge_count_file"
        nudge_echo_grace=3

        echo "$new_state" > "$state_file"
    done
}

# -------------------------------------------------------------------
# mentiko-monitor: profile-aware monitor (wrapper for the script)
# usage: mentiko-monitor <session-name> "end state" [profile] [interval]
# -------------------------------------------------------------------
mentiko-monitor() {
    local lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    bash "$lib_dir/mentiko-monitor.sh" "$@"
}

# exports
export -f new_pty_session
export -f send-message
export -f new-agent-session
export -f new-agent-from-spec
export -f peek-session
export -f agent-complete-marker-seen
export -f _agent_transcript_cli
export -f _agent_transcript_identity_args
export -f _agent_transcript_jsonl
export -f agent-complete-marker-durable
export -f agent-completion-latched
export -f monitor-agent-stalled
export -f monitor-agent-died
export -f launch-chain-runner-complete
export -f monitor-with-ai
export -f monitor-chain-agent
export -f mentiko-monitor

echo "  mentiko: core functions loaded"
