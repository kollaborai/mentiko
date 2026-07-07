#!/bin/bash
# watchdog.sh - background daemon that catches stalled runs
# runs every 60s, checks all "running" runs against live pty sessions
# emits run-stalled events for self-heal chain to pick up
#
# usage:
#   watchdog.sh              start the daemon (runs in foreground)
#   watchdog.sh status       check if running
#   watchdog.sh stop         stop the daemon
#
# env vars:
#   WATCHDOG_INTERVAL=60     check interval in seconds
#   WATCHDOG_AUTO_HEAL=false auto-trigger self-heal chain on stall

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# load config for paths
source "$SCRIPT_DIR/config.sh" 2>/dev/null || true

# load session transport
source "$SCRIPT_DIR/session-transport.sh"

# handle subcommands
case "${1:-}" in
    status)
        if transport_has_session "mentiko-watchdog" 2>/dev/null; then
            echo "  watchdog: running"
            transport_list_sessions 2>/dev/null | grep watchdog || true
        else
            echo "  watchdog: not running"
        fi
        exit 0
        ;;
    stop)
        if transport_has_session "mentiko-watchdog" 2>/dev/null; then
            transport_kill_session "mentiko-watchdog"
            echo "  watchdog: stopped"
        else
            echo "  watchdog: not running"
        fi
        exit 0
        ;;
esac

# RUNS_DIR, EVENTS_DIR, CHAIN_DIR from config.sh
INTERVAL="${WATCHDOG_INTERVAL:-60}"
SELF_HEAL_CHAIN="${CHAIN_DIR}/self-heal/chain.json"
AUTO_HEAL="${WATCHDOG_AUTO_HEAL:-false}"

source "$SCRIPT_DIR/run-lib.sh" 2>/dev/null || true

# log crashes (set -e exits)
trap '_sys_log "error" "watchdog" "CRASHED at line $LINENO (exit $?)" "run: ${run_id:-unknown}"' ERR

mkdir -p "$EVENTS_DIR"

# check pty-manager is responsive
check_pty_manager() {
    if ! transport_list_sessions >/dev/null 2>&1; then
        echo "  !! pty-manager not responding"
        echo "     attempting to start pty-mgr daemon..."

        # try to start pty-mgr daemon
        if command -v pty-mgr >/dev/null 2>&1; then
            pty-mgr daemon >/dev/null 2>&1 &
            sleep 2
            # verify it started
            if transport_list_sessions >/dev/null 2>&1; then
                echo "     pty-manager started"
            else
                echo "     failed to start pty-manager"
                return 1
            fi
        else
            echo "     pty-mgr not found in PATH"
            return 1
        fi
    fi
    return 0
}

# shared hook runner (also used by chain-runner-complete.sh)
_HOOKS_PROJECT_ROOT="$PROJECT_ROOT" source "$SCRIPT_DIR/hooks.sh"
HOOKS_DIR="$_HOOKS_DIR"

echo "  watchdog started"
echo "  interval: ${INTERVAL}s"
echo "  runs dir: $RUNS_DIR"
echo "  hooks dir: $HOOKS_DIR"
echo "  auto-heal: $AUTO_HEAL"
echo "  ---"

get_live_sessions() {
    transport_list_sessions 2>/dev/null || true
}

check_run() {
    local run_dir="$1"
    local run_file="$run_dir/run.json"
    local run_id=$(basename "$run_dir")

    [[ -f "$run_file" ]] || return 0

    local status=$(jq -r '.status // ""' "$run_file" 2>/dev/null)
    [[ "$status" == "running" ]] || return 0

    # Resume can take a little while to recreate the PTY session. During that
    # window the run may have pending agents and no live session yet.
    local resumed_at
    resumed_at=$(jq -r '.resumedAt // empty' "$run_file" 2>/dev/null)
    if [[ -n "$resumed_at" ]]; then
        local resumed_no_tz
        resumed_no_tz=$(echo "$resumed_at" | sed 's/[-+][0-9][0-9]:[0-9][0-9]$//; s/Z$//; s/\.[0-9][0-9]*$//')
        local resumed_epoch
        resumed_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%S" "$resumed_no_tz" "+%s" 2>/dev/null \
            || date -d "$resumed_at" "+%s" 2>/dev/null || echo 0)
        if [[ "$resumed_epoch" -gt 0 ]]; then
            local resume_age=$(( $(date +%s) - resumed_epoch ))
            if [[ $resume_age -lt 120 ]]; then
                return 0
            fi
        fi
    fi

    local live_sessions="$2"
    local agents_json=$(jq -c '.agents // []' "$run_file" 2>/dev/null)
    local any_alive=false
    local any_running=false
    local any_pending=false
    local last_agent=""
    local last_agent_status=""
    local pending_list=""

    # check each agent
    # RULE: if PTY session is alive, agent is alive. period. no age checks needed.
    # age-based fallbacks only apply when session is confirmed dead or missing.
    while IFS= read -r agent; do
        local aid=$(echo "$agent" | jq -r '.id')
        local ast=$(echo "$agent" | jq -r '.status')
        local asess=$(echo "$agent" | jq -r '.session // ""')

        # ── FIRST: check if PTY session is alive (source of truth) ──
        # this check runs regardless of agent.status in the JSON.
        # a live session means the agent is alive, full stop.
        if [[ -n "$asess" && "$asess" != "null" ]]; then
            if transport_has_session "$asess" 2>/dev/null; then
                any_alive=true
                [[ "$ast" == "running" ]] && any_running=true
                [[ "$ast" != "pending" ]] && { last_agent="$aid"; last_agent_status="$ast"; }
                continue  # session alive → skip all other checks
            fi
            # also check if monitor is alive (monitor outlives agent session
            # during chain-runner-complete handoff)
            if transport_has_session "monitor-$asess" 2>/dev/null; then
                any_alive=true
                [[ "$ast" == "running" ]] && any_running=true
                [[ "$ast" != "pending" ]] && { last_agent="$aid"; last_agent_status="$ast"; }
                continue  # monitor alive → agent is being handled
            fi
        fi

        # ── SESSION IS DEAD OR MISSING: apply fallback logic ──

        if [[ "$ast" == "running" ]]; then
            any_running=true
            if [[ -n "$asess" && "$asess" != "null" ]]; then
                # session was registered but is now dead
                if transport_session_exists "$asess" 2>/dev/null; then
                    # session exists (exited) - give 5 min for monitor/cleanup
                    local run_ts=${run_id#run-}
                    if [[ "$run_ts" =~ ^[0-9]+$ ]]; then
                        local now_ms=$(( $(date +%s) * 1000 ))
                        local age_ms=$(( now_ms - run_ts ))
                        if [[ $age_ms -lt 300000 ]]; then
                            any_alive=true
                        fi
                    fi
                else
                    # session not found at all - startup grace period (10s)
                    local run_ts=${run_id#run-}
                    if [[ "$run_ts" =~ ^[0-9]+$ ]]; then
                        local now_ms=$(( $(date +%s) * 1000 ))
                        local age_ms=$(( now_ms - run_ts ))
                        if [[ $age_ms -lt 10000 ]]; then
                            any_alive=true
                        fi
                    fi
                fi
            else
                # agent marked running but no session yet (handoff in progress)
                # give 2 min from agent's own start time
                local agent_started=$(echo "$agent" | jq -r '.started // ""')
                if [[ -n "$agent_started" ]]; then
                    local agent_epoch
                    local agent_no_tz=$(echo "$agent_started" | sed 's/[-+][0-9][0-9]:[0-9][0-9]$//')
                    agent_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%S" "$agent_no_tz" "+%s" 2>/dev/null \
                        || date -d "$agent_started" "+%s" 2>/dev/null || echo 0)
                    if [[ "$agent_epoch" -gt 0 ]]; then
                        local now_s=$(date +%s)
                        local agent_age=$(( now_s - agent_epoch ))
                        if [[ $agent_age -lt 120 ]]; then
                            any_alive=true
                        fi
                    else
                        any_alive=true  # can't parse start time, assume alive
                    fi
                else
                    any_alive=true  # no start time, transitioning - assume alive
                fi
            fi
        elif [[ "$ast" == "pending" ]]; then
            any_pending=true
            pending_list="${pending_list:+$pending_list,}$aid"
            # grace period: pending agents expected in young runs
            local now_s=$(date +%s)
            local run_ts=${run_id#run-}
            if [[ "$run_ts" =~ ^[0-9]+$ ]]; then
                local now_ms=$(( now_s * 1000 ))
                local age_ms=$(( now_ms - run_ts ))
                if [[ $age_ms -lt 120000 ]]; then
                    any_alive=true
                fi
            fi
            # grace period: if any agent completed recently, chain-runner-complete
            # is doing handoff (artifact capture + next agent launch)
            if ! $any_alive; then
                local latest_completion
                latest_completion=$(echo "$agents_json" | jq -r \
                    '[.[] | select(.completed != null) | .completed] | sort | last // empty' 2>/dev/null)
                if [[ -n "$latest_completion" ]]; then
                    local comp_no_tz=$(echo "$latest_completion" | sed 's/[-+][0-9][0-9]:[0-9][0-9]$//')
                    local comp_epoch
                    comp_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%S" "$comp_no_tz" "+%s" 2>/dev/null \
                        || date -d "$latest_completion" "+%s" 2>/dev/null || echo 0)
                    if [[ "$comp_epoch" -gt 0 ]]; then
                        local since_completion=$(( now_s - comp_epoch ))
                        if [[ $since_completion -lt 300 ]]; then
                            any_alive=true
                        fi
                    fi
                fi
            fi
        fi

        # track last non-pending agent for diagnostics
        if [[ "$ast" != "pending" ]]; then
            last_agent="$aid"
            last_agent_status="$ast"
        fi
    done < <(echo "$agents_json" | jq -c '.[]' 2>/dev/null)

    if $any_alive; then
        return 0  # run is fine, has live sessions or active monitors
    fi

    # stalled: either had running agents with dead sessions (no monitor), or no running agents but pending ones
    if $any_running || $any_pending; then
        echo "  !! stalled: $run_id"
        echo "     last_agent: $last_agent ($last_agent_status)"
        echo "     pending: $pending_list"
        _sys_log "warn" "watchdog" "run $run_id stalled: no live sessions" \
            "last_agent: $last_agent ($last_agent_status), pending: $pending_list"

        # kill all agent and monitor PTY sessions before updating JSON
        # use set +e so failures don't abort the cleanup loop
        set +e
        while IFS= read -r agent; do
            local asess=$(echo "$agent" | jq -r '.session // ""')
            local aid=$(echo "$agent" | jq -r '.id // ""')
            if [[ -n "$asess" && "$asess" != "null" ]]; then
                echo "     killing agent session: $asess"
                transport_kill_session "$asess" 2>/dev/null || true
            fi
            # kill per-agent monitor (monitor-{runId}-{agentId}) only if dead
            # never kill live monitors - they may be owned by chain-runner-complete
            if [[ -n "$aid" && "$aid" != "null" ]]; then
                local monitor_sess="monitor-${run_id}-${aid}"
                if ! transport_has_session "$monitor_sess" 2>/dev/null; then
                    transport_kill_session "$monitor_sess" 2>/dev/null || true
                fi
            fi
        done < <(echo "$agents_json" | jq -c '.[]' 2>/dev/null)
        # kill run-level monitor session only if dead
        # never kill live monitors - chain-runner-complete uses them for artifact capture
        local run_monitor="monitor-${run_id}"
        if ! transport_has_session "$run_monitor" 2>/dev/null; then
            transport_kill_session "$run_monitor" 2>/dev/null || true
        fi
        set -e

        # update run.json: mark stopped, cancel pending agents.
        # bug #7: the watchdog is one of THREE independent run.json writers (the
        # others are the bash completion helpers in run-lib.sh and the web heartbeat
        # route). This rewrite now goes through run-lib's shared mkdir-lock so it
        # cannot lost-update a concurrent agent-status or heartbeat write. The jq
        # filter is unchanged — it lives in run-lib's watchdog-stop-run helper
        # (which watchdog.sh sources at the top). Fallback keeps the watchdog robust
        # if run-lib failed to source: an unlocked terminal write is still better
        # than leaving a stalled run stuck "running" forever.
        if declare -f watchdog-stop-run >/dev/null 2>&1; then
            watchdog-stop-run "$run_id" || true
        else
            jq '
                .status = "stopped" |
                .completed = (now | todate) |
                .agents |= map(
                    if .status == "running" and (.session == "" or .session == null) then .status = "cancelled"
                    elif .status == "running" then .status = "stopped"
                    elif .status == "pending" then .status = "cancelled"
                    else .
                    end
                )
            ' "$run_file" > "$run_file.tmp" && mv "$run_file.tmp" "$run_file"
        fi

        # emit run-stalled event
        # NOTE: this is a SYSTEM event (observed by hooks/notifications), not an agent
        # handoff event, so it intentionally keeps its own ${ts}-run-stalled.event naming
        # rather than the canonical ${run_id}-${source}-${event}.event used for agent
        # completion handoffs (see lib/event-trigger.sh emit-event). Do not "unify" it.
        local ts=$(date -u +"%Y%m%dT%H%M%S")
        local event_file="$EVENTS_DIR/${ts}-run-stalled.event"
        cat > "$event_file" <<EOF
event: run-stalled
source: watchdog
timestamp: $(date -Iseconds)
run_id: $run_id
last_agent: ${last_agent:-unknown}
last_agent_status: ${last_agent_status:-unknown}
pending_agents: ${pending_list:-none}
processed: false
EOF
        echo "     event: $event_file"

        # fire hooks (notifications, alerts, custom scripts)
        local hook_details=$(jq -nc \
            --arg rid "$run_id" \
            --arg la "${last_agent:-unknown}" \
            --arg las "${last_agent_status:-unknown}" \
            --arg pa "${pending_list:-none}" \
            --arg tid "${task_id:-}" \
            '{run_id:$rid, last_agent:$la, last_agent_status:$las, pending_agents:$pa, task_id:$tid}')
        run_hooks "run-stalled" "$run_id" "$hook_details"

        # dispatch notification: chain-stalled
        local chain_name=$(jq -r '.chain // "unknown"' "$run_file" 2>/dev/null)
        if declare -f dispatch-chain-stalled &>/dev/null; then
            dispatch-chain-stalled "$chain_name" "$run_id" 2>/dev/null || true
        fi

        # propagate to linked task (full summary with artifacts)
        update-task-from-run "$run_id" "stopped" 2>/dev/null || true

        # auto-trigger self-heal chain if enabled
        if [[ "$AUTO_HEAL" == "true" && -f "$SELF_HEAL_CHAIN" ]]; then
            echo "     triggering self-heal chain..."
            bash "$SCRIPT_DIR/chain-runner.sh" "$SELF_HEAL_CHAIN" &
        fi
    fi
}

# collect all session names referenced in NON-TERMINAL runs (anything not
# definitively finished). Fail-safe by design: we reap a live session only when
# its run is in a known-terminal state; every other status — running, pending
# (queued, added by the concurrency-cap feature), blocked, paused, waiting, a
# runner-v2-only state, or an unrecognized/empty one — is treated as "still held"
# and spared. An allow-list of active states fails dangerous (any state it does
# not list gets its live agent killed — exactly this bug); a terminal deny-list
# fails safe (an unknown state leaks at worst a dead session, never kills work).
# Terminal set spans all three RunStatus definitions (schemas.ts uses "complete",
# types.ts/runner-v2 use "completed"; runner-v2 adds "stopped").
get_active_run_sessions() {
    local sessions=""
    for run_dir in "$RUNS_DIR"/run-*; do
        [[ -d "$run_dir" ]] || continue
        local run_file="$run_dir/run.json"
        [[ -f "$run_file" ]] || continue
        local status=$(jq -r '.status // ""' "$run_file" 2>/dev/null)
        case "$status" in
            completed|complete|failed|cancelled|stopped) continue ;;  # terminal — reap orphan session
        esac
        # extract all session names from agents array
        local snames
        snames=$(jq -r '.agents[]?.session // empty' "$run_file" 2>/dev/null)
        sessions="${sessions}"$'\n'"${snames}"
    done
    echo "$sessions"
}

session_env_value() {
    local env_text="$1"
    local key="$2"
    printf '%s\n' "$env_text" | tr '\0' ' ' | sed -n "s/.*${key}=\\([^ ]*\\).*/\\1/p" | tail -1
}

session_in_watchdog_scope() {
    local session="$1"
    local pid
    pid=$(transport_pid "$session" 2>/dev/null || true)

    # If the session is exited or pid lookup is unavailable, keep legacy cleanup
    # behavior. The cross-root danger only applies to live processes.
    [[ -n "$pid" ]] || return 0

    local env_text
    env_text=$(ps eww -p "$pid" 2>/dev/null || true)
    [[ -n "$env_text" ]] || return 0

    local session_root session_namespace session_org
    session_root=$(session_env_value "$env_text" "MENTIKO_GLOBAL_ROOT")
    session_namespace=$(session_env_value "$env_text" "NAMESPACE_ID")
    session_org=$(session_env_value "$env_text" "ORG_ID")

    if [[ -n "$session_root" && -n "${MENTIKO_GLOBAL_ROOT:-}" && "$session_root" != "$MENTIKO_GLOBAL_ROOT" ]]; then
        return 1
    fi
    if [[ -n "$session_namespace" && "$session_namespace" != "${NAMESPACE_ID:-default}" ]]; then
        return 1
    fi
    if [[ -n "$session_org" && "$session_org" != "${ORG_ID:-default}" ]]; then
        return 1
    fi

    return 0
}

# kill sessions that exist in pty-manager but are not in any active run
cleanup_orphaned_sessions() {
    local active_sessions="$1"
    local live_sessions="$2"

    while IFS= read -r session; do
        [[ -z "$session" ]] && continue
        # skip watchdog's own session
        [[ "$session" == "mentiko-watchdog" ]] && continue
        [[ "$session" == mentiko-watchdog-* ]] && continue
        # skip chain event watcher
        [[ "$session" == "mentiko-chain-watcher" ]] && continue
        [[ "$session" == mentiko-chain-watcher-* ]] && continue
        # skip monitor sessions - they're companion processes to agent sessions
        # and are not tracked in run.json but are essential for chain progression
        [[ "$session" == monitor-* ]] && continue
        # skip completion handlers - they briefly run outside run.json while
        # finalizing artifacts, events, and run status.
        [[ "$session" == complete-* ]] && continue
        # skip user terminal sessions - standalone sessions not tied to runs
        [[ "$session" == term-* ]] && continue
        # skip onboarding auth sessions (gh auth, cli tool auth)
        [[ "$session" == gh-auth-* ]] && continue
        [[ "$session" == cli-auth-* ]] && continue
        # skip link/peer sessions - managed by peer-manager, not chain-runner
        [[ "$session" == link-* ]] && continue
        [[ "$session" == peer-* ]] && continue
        # pty-manager is global on the host, while run files are scoped under
        # MENTIKO_GLOBAL_ROOT/NAMESPACE_ID/ORG_ID. Do not let a temp namespace
        # watchdog reap live sessions that clearly belong to another root.
        if ! session_in_watchdog_scope "$session"; then
            _sys_log "info" "watchdog" "skipped foreign session: $session" \
                "session is outside this watchdog root/namespace"
            continue
        fi
        # check if this session is referenced by an active run
        if ! echo "$active_sessions" | grep -qxF "$session"; then
            echo "  ~~ orphan: $session (no active run)"
            _sys_log "info" "watchdog" "killed orphan session: $session" "no active run references this session"
            transport_kill_session "$session" 2>/dev/null || true
        fi
    done <<< "$live_sessions"
}

CLEANUP_INTERVAL="${WATCHDOG_CLEANUP_INTERVAL:-300}"  # orphan cleanup every 5 min
last_cleanup=0

# main loop
while true; do
    # ensure pty-manager is running before checking runs
    check_pty_manager || {
        sleep "$INTERVAL"
        continue
    }

    live_sessions=$(get_live_sessions)
    stalled_count=0

    for run_dir in "$RUNS_DIR"/run-*; do
        [[ -d "$run_dir" ]] || continue
        check_run "$run_dir" "$live_sessions"
        if [[ $? -ne 0 ]]; then
            stalled_count=$((stalled_count + 1))
        fi
    done

    # orphan session cleanup (every CLEANUP_INTERVAL seconds)
    now=$(date +%s)
    if [[ $(( now - last_cleanup )) -ge $CLEANUP_INTERVAL ]]; then
        active_run_sessions=$(get_active_run_sessions)
        if [[ -n "$live_sessions" ]]; then
            cleanup_orphaned_sessions "$active_run_sessions" "$live_sessions"
        fi
        last_cleanup=$now
    fi

    # reconcile task metadata (catches deleted runs, missed updates)
    web_url="${MENTIKO_WEB_URL:-http://localhost:${WEB_PORT:-${PORT:-3000}}}"
    curl -s -H "Authorization: Bearer ${BETTER_AUTH_SECRET:-}" \
        "${web_url%/}/api/tasks/reconcile" >/dev/null 2>&1 &

    sleep "$INTERVAL"
done
