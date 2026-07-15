#!/bin/bash
# concurrency-cap.sh — engine-level concurrency ceiling with QUEUE semantics.

CONCURRENCY_CAP_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$CONCURRENCY_CAP_SCRIPT_DIR/config.sh"
source "$CONCURRENCY_CAP_SCRIPT_DIR/run-record-client.sh"
#
# WHY THIS EXISTS (phase-2 step 2; inputs from load-drill-2026-06-10.md)
# ---------------------------------------------------------------------
# The 2026-06-10 load drill on a 2GB tenant box found the engine's binding limit is
# NOT memory but correctness + the per-agent CLI RSS. Real agent CLIs are 150-400MB
# each (vs the 4MB stub), so the honest cap UNIT is "concurrent active agent
# sessions". The recommended 2GB-shared defaults: 4 concurrent chains, 3 active agent
# sessions. This module enforces those caps at launch time with a bounded, observable
# QUEUE: at the cap, new work WAITS (run marked `pending` with a "queued" message) and
# is admitted as soon as a slot frees; it never silently fails or hangs. On max-wait
# expiry the run is surfaced terminally `blocked` with a clear reason.
#
# LIVE COUNT, NOT A MAINTAINED COUNTER (the deliberate design choice)
# -------------------------------------------------------------------
# A maintained "active runs" counter would need a decrement on EVERY exit path —
# complete, failed, killed-by-watchdog, force-stopped, crashed mid-launch — and would
# leak a phantom slot the first time any path is missed (and the drill proved several
# exit paths are flaky). Instead we COUNT THE GROUND TRUTH each time, under a short
# lock:
#   - running chains  = run dirs whose run.json status is running|pending (self-heals:
#     a crashed run that never reached terminal still shows running until the watchdog
#     reaps it, which is exactly the conservative behavior we want; a reaped run drops
#     out of the count for free).
#   - active agents   = ALIVE pty-manager sessions, excluding reserved mentiko
#     utility/retired-daemon names and the per-agent completion monitor sessions
#     (monitor-*). The active typed watcher/watchdog are not PTY sessions. A
#     dead/exited session is not counted — again self-healing.
#
# LOCK BOUNDARY: the lock is held ONLY around the count-and-decide step (and, for the
# agent cap, through the spawn so the next counter sees the new session). The bounded
# back-off sleep happens OUTSIDE the lock so a waiting acquirer never blocks a
# releasing one. Same atomic-mkdir lock primitive as lib/run-lib.sh / routing-lib.sh.
#
# ENV KNOBS (control plane sets these per hosting tier at provisioning):
#   MENTIKO_MAX_CONCURRENT_CHAINS  max chains running at once         (default 4)
#   MENTIKO_MAX_ACTIVE_AGENTS      max alive agent PTY sessions       (default 3)
#   MENTIKO_CAP_MAX_WAIT_SECS      max time a queued item waits        (default 300)
#   MENTIKO_CAP_POLL_SECS          initial back-off between re-checks  (default 2)
#   MENTIKO_CAP_POLL_MAX_SECS      back-off ceiling (exponential)      (default 15)
#   MENTIKO_CAP_DISABLED=1         bypass the cap entirely (escape hatch)
#
# This file is sourced by chain-runner.sh AFTER run-lib.sh + session-transport.sh +
# metrics.sh (it uses update-run-status, transport_list_sessions, _sys_log). It is
# self-contained otherwise — its own lock helpers, no cross-source of routing-lib.

# ---- knobs (env-overridable; defaults tuned to the 2GB shared tier per the drill) --
MENTIKO_MAX_CONCURRENT_CHAINS="${MENTIKO_MAX_CONCURRENT_CHAINS:-4}"
MENTIKO_MAX_ACTIVE_AGENTS="${MENTIKO_MAX_ACTIVE_AGENTS:-3}"
MENTIKO_CAP_MAX_WAIT_SECS="${MENTIKO_CAP_MAX_WAIT_SECS:-300}"
MENTIKO_CAP_POLL_SECS="${MENTIKO_CAP_POLL_SECS:-2}"
MENTIKO_CAP_POLL_MAX_SECS="${MENTIKO_CAP_POLL_MAX_SECS:-15}"
CAP_LOCK_STALE_SECS="${CAP_LOCK_STALE_SECS:-60}"
CAP_LOCK_WAIT_TICKS="${CAP_LOCK_WAIT_TICKS:-100}"   # ~5s of ~50ms ticks waiting for the cap lock itself

# ===================================================================
# cap lock (atomic mkdir; same protocol as run-lib.sh, sibling copy)
# ===================================================================
# Lives at $RUNS_DIR/.cap.lock — one lock guards both the chain-slot and agent-slot
# admission decisions for this project (namespace+org) so counts are consistent.
_cap_lock_dir() { printf '%s/.cap.lock' "${RUNS_DIR:-$HOME/.mentiko/runs}"; }

_cap_lock_acquire() {
    local lock_dir; lock_dir="$(_cap_lock_dir)"
    mkdir -p "$(dirname "$lock_dir")" 2>/dev/null || true
    local waited=0 holder mtime now age
    while true; do
        if mkdir "$lock_dir" 2>/dev/null; then
            echo "$$" > "$lock_dir/pid" 2>/dev/null || true
            return 0
        fi
        holder="$(cat "$lock_dir/pid" 2>/dev/null || echo "")"
        mtime="$(stat -c %Y "$lock_dir" 2>/dev/null || stat -f %m "$lock_dir" 2>/dev/null || echo 0)"
        now="$(date +%s)"; age=0; [[ "$mtime" -gt 0 ]] && age=$(( now - mtime ))
        if { [[ -n "$holder" ]] && ! kill -0 "$holder" 2>/dev/null; } \
           || [[ "$age" -ge "$CAP_LOCK_STALE_SECS" ]]; then
            rm -f "$lock_dir/pid" 2>/dev/null || true
            rmdir "$lock_dir" 2>/dev/null || true
            continue
        fi
        if [[ "$waited" -ge "$CAP_LOCK_WAIT_TICKS" ]]; then
            return 1   # could not get the cap lock; caller treats as "no slot this round"
        fi
        sleep 0.05 2>/dev/null || sleep 1
        waited=$((waited + 1))
    done
}

_cap_lock_release() {
    local lock_dir; lock_dir="$(_cap_lock_dir)"
    rm -f "$lock_dir/pid" 2>/dev/null || true
    rmdir "$lock_dir" 2>/dev/null || true
}

# ===================================================================
# live counters (ground truth — self-healing, no maintained state)
# ===================================================================

# _cap_count_running_chains [exclude_run_id]
# Counts run dirs under $RUNS_DIR that are OCCUPYING A SLOT — i.e. status `running`.
# A queued run is `pending` (the queue, NOT a slot-holder) and is deliberately NOT
# counted, otherwise queued runs would count against the very cap they're waiting on
# and the queue could deadlock. Optionally excludes one run id so an acquirer can
# count "everyone holding a slot except me" (its own pre-gate status is irrelevant).
_cap_count_running_chains() {
    local exclude="${1:-}" runs_dir="${RUNS_DIR:-$HOME/.mentiko/runs}"
    local args=(count-running --runs-dir "$runs_dir")
    [[ -n "$exclude" ]] && args+=(--exclude-run-id "$exclude")
    _run_record_cli "${args[@]}"
}

# _cap_count_active_agents
# Counts ALIVE pty-manager sessions that are agent sessions: excludes reserved
# mentiko utility/retired-daemon names and per-agent completion monitors.
# Relies on transport_list_sessions / PTY_CMD already being in scope
# (session-transport.sh).
# The pty list line format is: "<name>  pid=<pid>  <WxH>  <alive|exited(N)>  <cmd>".
_cap_count_active_agents() {
    local list
    if declare -f transport_list_sessions >/dev/null 2>&1; then
        list="$("$PTY_CMD" list 2>/dev/null || echo "")"
    else
        list="$(pty-mgr list 2>/dev/null || echo "")"
    fi
    [[ -z "$list" || "$list" == "no sessions" ]] && { echo 0; return 0; }
    # field 1 = name, field 4 = status word (alive | exited(N)). Keep alive, drop
    # reserved mentiko utilities/retired daemon names + completion monitors.
    # awk avoids spawning a process per line.
    echo "$list" | awk '
        $4 == "alive" {
            name = $1
            if (name ~ /^mentiko-/)  next   # reserved utility/retired daemon names
            if (name ~ /^monitor-/)  next   # per-agent completion monitors
            c++
        }
        END { print c+0 }
    '
}

# ===================================================================
# admission: chain slot
# ===================================================================
# cap_acquire_chain_slot <run_id>
#   0 = slot acquired (run promoted to `running`), proceed to launch.
#   1 = max-wait expired; run has been marked terminal `blocked` with a reason.
#
# Admission counts only OTHER slot-holders (status `running`, excluding self) under the
# lock, and admits when that count < cap — then promotes self to `running` BEFORE
# releasing the lock, so the slot it just took is immediately visible to the next
# acquirer (closes the TOCTOU: two late arrivals can't both pass because the lock
# serializes count→promote). While waiting, self is `pending` (existing status
# vocabulary; the UI renders it neutral/"waiting") with a queued status_message, and
# a `pending` run is NOT counted as a slot-holder so the queue can't deadlock on itself.
cap_acquire_chain_slot() {
    local run_id="$1"
    # When the cap is bypassed/unlimited we still take the slot immediately, but we MUST
    # promote the run to `running` here: create-run now creates it `pending`, and this
    # gate is the sole promoter. Skipping the promote would strand the run `pending`.
    if [[ "${MENTIKO_CAP_DISABLED:-0}" == "1" ]]; then
        update-run-status "$run_id" "running" 2>/dev/null || true
        return 0
    fi
    local cap="$MENTIKO_MAX_CONCURRENT_CHAINS"
    if [[ "$cap" -le 0 ]]; then   # cap <= 0 means unlimited
        update-run-status "$run_id" "running" 2>/dev/null || true
        return 0
    fi

    # IMPORTANT: a run does NOT hold a slot until it passes this gate. create-run (and
    # the web service) set the run `running` up front, which would make a concurrent
    # acquirer count this not-yet-admitted run as a slot-holder during the create→gate
    # window. So FIRST demote self to `pending` (the queue state, never counted as a
    # slot-holder), THEN count and admit. A run that finds a free slot is promoted back
    # to `running` immediately below; the brief pending flicker is harmless (the UI
    # renders it neutral/"waiting"), and it makes the count exact rather than racy.
    update-run-status "$run_id" "pending" 2>/dev/null || true

    local start now elapsed poll="$MENTIKO_CAP_POLL_SECS" others queued_once=0
    start="$(date +%s)"
    while true; do
        if _cap_lock_acquire; then
            # Corrupt Run Record evidence is not a free slot. The typed counter
            # returns nonzero, and admission blocks rather than under-counting.
            if ! others="$(_cap_count_running_chains "$run_id")"; then
                _cap_lock_release
                update-run-status "$run_id" "blocked" \
                    "concurrency admission blocked: invalid run record in configured runs root" 2>/dev/null || true
                _sys_log "error" "concurrency-cap" "run $run_id blocked: typed run count failed" \
                    "runs root: ${RUNS_DIR:-unset}"
                echo "  concurrency-cap: blocked admission because a run record is invalid" >&2
                return 1
            fi
            if [[ "$others" -lt "$cap" ]]; then
                # take the slot: mark self `running` so the NEXT counter sees me, THEN
                # drop the lock. The status write happens inside the critical section.
                if [[ "$queued_once" -eq 1 ]]; then
                    update-run-status "$run_id" "running" "admitted from queue ($((others+1))/$cap chains active)" 2>/dev/null || true
                    _sys_log "info" "concurrency-cap" "run $run_id admitted from queue" "chains active: $((others+1))/$cap"
                else
                    # not queued (slot was free immediately) — ensure status is running
                    # (create-run already set it; this is a cheap idempotent confirm).
                    update-run-status "$run_id" "running" 2>/dev/null || true
                fi
                _cap_lock_release
                return 0
            fi
            _cap_lock_release
        fi
        # at/over the cap (or couldn't get the cap lock this round) — queue + back off.
        now="$(date +%s)"; elapsed=$(( now - start ))
        if [[ "$elapsed" -ge "$MENTIKO_CAP_MAX_WAIT_SECS" ]]; then
            update-run-status "$run_id" "blocked" \
                "concurrency cap: waited ${elapsed}s for a chain slot (limit ${cap}); blocked" 2>/dev/null || true
            _sys_log "warn" "concurrency-cap" "run $run_id BLOCKED at chain cap after ${elapsed}s" \
                "limit: $cap chains; raise MENTIKO_MAX_CONCURRENT_CHAINS or wait for a slot"
            echo "  concurrency-cap: run $run_id blocked (waited ${elapsed}s for a chain slot, limit $cap)" >&2
            return 1
        fi
        if [[ "$queued_once" -eq 0 ]]; then
            queued_once=1
            update-run-status "$run_id" "pending" \
                "queued: waiting for a chain slot (${others:-?} active, limit ${cap})" 2>/dev/null || true
            _sys_log "info" "concurrency-cap" "run $run_id queued at chain cap" \
                "active: ${others:-?}/$cap; max wait ${MENTIKO_CAP_MAX_WAIT_SECS}s"
            echo "  concurrency-cap: at limit ($cap chains) — run $run_id QUEUED (waiting up to ${MENTIKO_CAP_MAX_WAIT_SECS}s)" >&2
        fi
        sleep "$poll" 2>/dev/null || sleep 2
        # exponential back-off up to the ceiling (cheap polling that doesn't hammer jq).
        poll=$(( poll * 2 )); [[ "$poll" -gt "$MENTIKO_CAP_POLL_MAX_SECS" ]] && poll="$MENTIKO_CAP_POLL_MAX_SECS"
    done
}

# ===================================================================
# admission: active agent-session slot
# ===================================================================
# cap_wait_for_agent_slot <run_id> <agent_label>
#   0 = a slot is free; caller should spawn the agent session NOW (while not holding
#       any cap lock — the spawn itself is observed by the NEXT counter once the
#       session is alive). We intentionally do NOT hold the lock across the external
#       spawn here because pty spawn goes through several layers; instead we rely on
#       the chain cap as the primary bound and treat the agent cap as a secondary
#       smoothing gate. Returns 1 only on max-wait expiry (does not mark the run
#       terminal — the caller decides, since an agent-slot timeout mid-chain is a
#       softer condition than a chain that never started).
# Best-effort, bounded, observable; never hangs.
cap_wait_for_agent_slot() {
    local run_id="${1:-}" label="${2:-agent}"
    [[ "${MENTIKO_CAP_DISABLED:-0}" == "1" ]] && return 0
    local cap="$MENTIKO_MAX_ACTIVE_AGENTS"
    [[ "$cap" -le 0 ]] && return 0   # unlimited

    local start now elapsed poll="$MENTIKO_CAP_POLL_SECS" active announced=0
    start="$(date +%s)"
    while true; do
        if _cap_lock_acquire; then
            active="$(_cap_count_active_agents)"
            if [[ "$active" -lt "$cap" ]]; then
                _cap_lock_release
                return 0
            fi
            _cap_lock_release
        fi
        now="$(date +%s)"; elapsed=$(( now - start ))
        if [[ "$elapsed" -ge "$MENTIKO_CAP_MAX_WAIT_SECS" ]]; then
            _sys_log "warn" "concurrency-cap" "agent-slot wait expired for $label (run ${run_id:-?})" \
                "active: ${active:-?}/$cap after ${elapsed}s; proceeding (chain cap still bounds load)"
            echo "  concurrency-cap: agent-slot wait expired for $label after ${elapsed}s (active ${active:-?}/$cap)" >&2
            return 1
        fi
        if [[ "$announced" -eq 0 ]]; then
            announced=1
            echo "  concurrency-cap: at agent limit ($cap active) — $label waiting up to ${MENTIKO_CAP_MAX_WAIT_SECS}s" >&2
            _sys_log "info" "concurrency-cap" "agent $label queued at active-agent cap" "active: ${active:-?}/$cap"
        fi
        sleep "$poll" 2>/dev/null || sleep 2
        poll=$(( poll * 2 )); [[ "$poll" -gt "$MENTIKO_CAP_POLL_MAX_SECS" ]] && poll="$MENTIKO_CAP_POLL_MAX_SECS"
    done
}

export -f _cap_lock_dir _cap_lock_acquire _cap_lock_release
export -f _cap_count_running_chains _cap_count_active_agents
export -f cap_acquire_chain_slot cap_wait_for_agent_slot
export MENTIKO_MAX_CONCURRENT_CHAINS MENTIKO_MAX_ACTIVE_AGENTS
export MENTIKO_CAP_MAX_WAIT_SECS MENTIKO_CAP_POLL_SECS MENTIKO_CAP_POLL_MAX_SECS
