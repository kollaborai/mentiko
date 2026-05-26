#!/bin/bash
# agent-functions.sh - Core functions for mentiko
# PTY-based AI agent orchestration with file events

# Load session transport (pty-manager for all sessions)
_AF_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$_AF_SCRIPT_DIR/session-transport.sh"
source "$_AF_SCRIPT_DIR/monitor-completion.sh" 2>/dev/null || true
source "$_AF_SCRIPT_DIR/ai-gateway-agent-env.sh" 2>/dev/null || true

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
        local agent_id=$(echo "$session_prefix" | tr '-' '_')
        mkdir -p "$state_dir"
        echo "status: running" > "$state_dir/${agent_id}.state"
        echo "session: $session_name" >> "$state_dir/${agent_id}.state"
        echo "started: $(date -Iseconds)" >> "$state_dir/${agent_id}.state"
    fi

    if [[ "$monitor" == "--monitor" ]]; then
        local agent_context="Spec: $(echo "$spec_file" | sed "s|^${project_root}/||"). Agent: $agent_name."
        local monitor_session="monitor-${session_name}"
        local lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
        local mon_script="/tmp/monitor-${session_name}.sh"
        local monitor_advisor_profile
        monitor_advisor_profile="$(find_advisor_profile 2>/dev/null || true)"
        {
            echo "#!/bin/bash"
            printf 'export AGENT_PROFILES_DIR=%q\n' "${AGENT_PROFILES_DIR:-}"
            printf 'export MENTIKO_MONITOR_PROFILE_ID=%q\n' "$monitor_advisor_profile"
            printf 'source %q 2>/dev/null\n' "${lib_dir}/agent-functions.sh"
            printf 'source %q 2>/dev/null\n' "${lib_dir}/event-trigger.sh"
            printf 'monitor-with-ai %q %q %q\n' "$session_name" "$MENTIKO_MONITOR_INTERVAL" "$agent_context"
        } > "$mon_script"
        chmod +x "$mon_script"
        new_pty_session "$monitor_session" bash "$mon_script"
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

# -------------------------------------------------------------------
# ensure-event-file: fallback event writer
# if agent says AGENT_COMPLETE but forgot to write an event file,
# this reads the spec and writes a clean event on behalf of the agent.
# -------------------------------------------------------------------
ensure-event-file() {
    local session_name="$1"
    local agent_context="$2"
    local project_root="$3"

    local events_dir="${EVENTS_DIR:-${MENTIKO_PROJECT_ROOT:-$project_root}/events}"
    local project_name=$(basename "$project_root")

    # derive session prefix
    local s_prefix=$(echo "$session_name" | sed "s/^${project_name}-//" | sed 's/-[0-9]\{8\}-[0-9]\{4\}$//')

    # check if ANY event file from this agent already exists
    for ef in "$events_dir"/*; do
        [[ -f "$ef" ]] || continue
        [[ -d "$ef" ]] && continue
        if grep -qi "source.*${s_prefix}\|agent.*${s_prefix}" "$ef" 2>/dev/null; then
            echo "  event file exists (content match)"
            return 0
        fi
        if echo "$(basename "$ef")" | grep -qi "$s_prefix" 2>/dev/null; then
            echo "  event file exists (filename match)"
            return 0
        fi
    done

    echo "  no event file found. writing fallback from spec..."

    # extract spec path from agent_context
    local spec_rel=$(echo "$agent_context" | sed -n 's/.*Spec: \([^ ]*\.md\).*/\1/p')
    local spec_path="${project_root}/${spec_rel}"

    if [[ ! -f "$spec_path" ]]; then
        echo "  spec not found at: $spec_path"
        return 1
    fi

    local prefix=$(grep -m1 '^session-prefix:' "$spec_path" 2>/dev/null | sed 's/^session-prefix:[[:space:]]*//' | xargs)
    if [[ -z "$prefix" ]]; then
        prefix="$s_prefix"
    fi

    # find emit event name from spec (playbook emit, not trigger)
    local emit_event=$(grep '[[:space:]]event:' "$spec_path" 2>/dev/null | grep -v '^[[:space:]]*-[[:space:]]*event:' | grep -v '^event:' | head -1 | sed 's/.*event:[[:space:]]*//' | xargs)

    if [[ -z "$emit_event" ]]; then
        echo "  could not determine event name from spec"
        return 1
    fi

    local fallback_file="$events_dir/${prefix}-${emit_event}-fallback.event"
    cat > "$fallback_file" <<FBEOF
event: ${emit_event}
source: ${prefix}
timestamp: $(date -Iseconds)
data: fallback event (agent completed but did not write event file)
processed: false
FBEOF

    echo "  fallback event written: $(basename "$fallback_file")"
    echo "  event: ${emit_event}, source: ${prefix}"
    return 0
}

agent-complete-marker-seen() {
    local session_name="$1"
    local tail_lines="${2:-100}"

    transport_capture "$session_name" "$tail_lines" 2>/dev/null |
        strip-terminal-control |
        grep -Eq '^[[:space:]]*AGENT_COMPLETE[[:space:]]*$'
}

launch-chain-runner-complete() {
    local session_name="$1"
    local chain_file="$2"
    local script_dir
    local completion_session
    local run_id

    if [[ -z "$session_name" || -z "$chain_file" || ! -f "$chain_file" ]]; then
        echo "  chain-runner-complete not launched: missing chain.json"
        return 1
    fi

    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    run_id="${MENTIKO_RUN_ID:-${RUN_ID:-}}"
    completion_session="complete-${session_name}-$(date +%s)"
    local completion_env_file=""
    local completion_script_q=""
    local session_name_q=""
    local chain_file_q=""
    local completion_cmd=""

    printf -v completion_script_q "%q" "$script_dir/chain-runner-complete.sh"
    printf -v session_name_q "%q" "$session_name"
    printf -v chain_file_q "%q" "$chain_file"
    completion_cmd="exec $completion_script_q $session_name_q $chain_file_q"

    if [[ "${MENTIKO_AI_GATEWAY_LOCAL_PROXY_ENABLED:-}" == "true" ]] && \
       [[ -n "${MENTIKO_AI_GATEWAY_LOCAL_BASE_URL:-}" ]] && \
       [[ -n "${MENTIKO_AI_GATEWAY_LOCAL_TOKEN:-}" ]]; then
        completion_env_file=$(mktemp /tmp/complete-gw-env-XXXXXX)
        chmod 600 "$completion_env_file"
        ai_gateway_append_local_proxy_control_exports "$completion_env_file"

        local completion_env_file_q=""
        printf -v completion_env_file_q "%q" "$completion_env_file"
        completion_cmd="trap 'rm -f $completion_env_file_q' EXIT; source $completion_env_file_q; rm -f $completion_env_file_q; trap - EXIT; exec $completion_script_q $session_name_q $chain_file_q"
    fi

    # Run completion in its own PTY session. The handler kills the monitor
    # session as part of cleanup, so it cannot be a child of that monitor PTY.
    if declare -f transport_new_session >/dev/null; then
        if transport_new_session "$completion_session" env \
            MENTIKO_RUN_ID="$run_id" \
            RUN_ID="$run_id" \
            NAMESPACE_ID="${NAMESPACE_ID:-default}" \
            ORG_ID="${ORG_ID:-default}" \
            WORKSPACE_TYPE="${WORKSPACE_TYPE:-local}" \
            bash -lc "$completion_cmd"; then
            echo "  chain-runner-complete session started: $completion_session"
            return 0
        fi
        [[ -n "$completion_env_file" ]] && rm -f "$completion_env_file"
        echo "  chain-runner-complete session failed: $completion_session"
    fi

    nohup bash "$script_dir/chain-runner-complete.sh" "$session_name" "$chain_file" >> "/tmp/complete-agent-${session_name}.log" 2>&1 &
    disown $! 2>/dev/null || true
    echo "  chain-runner-complete launched (pid: $!, disowned)"
}

# -------------------------------------------------------------------
# monitor-with-ai: watch an agent session, nudge when stale,
# trigger completion handler on AGENT_COMPLETE
# -------------------------------------------------------------------
monitor-with-ai() {
    local session_name="$1"
    local check_interval="${2:-$MENTIKO_MONITOR_INTERVAL}"
    local agent_context="${3:-}"
    local max_stale_count="${4:-${DEFAULT_MAX_STALE_COUNT:-5}}"
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
    local initial_capture
    initial_capture="$(transport_capture "$session_name" 20)"
    local current_state=$(printf '%s' "$initial_capture" | md5sum | cut -d' ' -f1)
    echo "$current_state" > "$state_file"

    while true; do
        sleep "$check_interval"

        if ! transport_has_session "$session_name" 2>/dev/null; then
            echo "  session '$session_name' gone. stopping."
            rm -f "$state_file" "$stale_count_file"
            break
        fi

        # check process liveness (detect dead CLI process)
        local pane_pid=$(transport_pid "$session_name" 2>/dev/null)
        if [[ -n "$pane_pid" ]]; then
            # check if the process is still running
            if ! ps -p "$pane_pid" >/dev/null 2>&1; then
                echo "  process $pane_pid inside session '$session_name' is dead. forcing completion..."
                local project_root
                project_root="${MENTIKO_GLOBAL_ROOT:-$HOME/.mentiko}"
                sleep 3
                ensure-event-file "$session_name" "$agent_context" "$project_root"
                local runtime_dir="${RUNTIME_DIR:-${MENTIKO_PROJECT_ROOT:-$project_root}/runtime}"
                if [[ -f "$runtime_dir/complete-agent.sh" ]]; then
                    nohup bash "$runtime_dir/complete-agent.sh" "$session_name" >> "/tmp/complete-agent-${session_name}.log" 2>&1 &
                    disown $!
                    echo "  complete-agent.sh launched (pid: $!, disowned)"
                fi
                rm -f "$state_file" "$stale_count_file"
                break
            fi
        fi

        # check for completion signal. The marker must be on its own line so
        # prose like "output AGENT_COMPLETE" in the prompt is ignored.
        if agent-complete-marker-seen "$session_name" 100; then
            echo "$(date '+%H:%M:%S') - AGENT_COMPLETE detected"
            echo "  triggering completion handler..."

            local project_root
            project_root="${MENTIKO_GLOBAL_ROOT:-$HOME/.mentiko}"

            # ensure event file exists before chain continues
            sleep 3
            ensure-event-file "$session_name" "$agent_context" "$project_root"

            local runtime_dir="${RUNTIME_DIR:-${MENTIKO_PROJECT_ROOT:-$project_root}/runtime}"
            if [[ -f "$runtime_dir/complete-agent.sh" ]]; then
                nohup bash "$runtime_dir/complete-agent.sh" "$session_name" >> "/tmp/complete-agent-${session_name}.log" 2>&1 &
                disown $!
                echo "  complete-agent.sh launched (pid: $!, disowned)"
            else
                echo "  complete-agent.sh not found at: $runtime_dir"
            fi
            rm -f "$state_file" "$stale_count_file"
            break
        fi

        local recent_capture
        recent_capture="$(transport_capture "$session_name" 20)"
        local new_state=$(printf '%s' "$recent_capture" | md5sum | cut -d' ' -f1)
        local old_state=""
        [[ -f "$state_file" ]] && old_state=$(cat "$state_file")

        if [[ "$new_state" == "$old_state" ]]; then
            if declare -f monitor_capture_looks_busy >/dev/null && monitor_capture_looks_busy "$recent_capture"; then
                echo "$(date '+%H:%M:%S') - active (busy indicator)"
                echo "0" > "$stale_count_file"
                echo "$new_state" > "$state_file"
                continue
            fi

            local stale_count=$(cat "$stale_count_file")
            stale_count=$((stale_count + 1))
            echo "$stale_count" > "$stale_count_file"

            # check if max stale count reached (stuck agent)
            if [[ $stale_count -ge $max_stale_count ]]; then
                echo "$(date '+%H:%M:%S') - max stale count ($max_stale_count) reached. forcing completion..."
                local project_root
                project_root="${MENTIKO_GLOBAL_ROOT:-$HOME/.mentiko}"
                sleep 3
                ensure-event-file "$session_name" "$agent_context" "$project_root"
                local runtime_dir="${RUNTIME_DIR:-${MENTIKO_PROJECT_ROOT:-$project_root}/runtime}"
                if [[ -f "$runtime_dir/complete-agent.sh" ]]; then
                    nohup bash "$runtime_dir/complete-agent.sh" "$session_name" >> "/tmp/complete-agent-${session_name}.log" 2>&1 &
                    disown $!
                    echo "  complete-agent.sh launched (pid: $!, disowned)"
                fi
                rm -f "$state_file" "$stale_count_file"
                break
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
            if declare -f monitor_format_nudge_for_agent >/dev/null; then
                response="$(monitor_format_nudge_for_agent "$response")"
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
    local session_name="$1"
    local check_interval="${2:-5}"
    local agent_context="${3:-}"
    local chain_file="${4:-$CHAIN_FILE}"
    local workspace_type="${WORKSPACE_TYPE:-local}"
    local max_stale_count="${5:-${DEFAULT_MAX_STALE_COUNT:-5}}"
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

    echo "  monitoring '$session_name' every ${check_interval}s (chain mode, workspace: $workspace_type)..."

    local initial_capture
    initial_capture="$(transport_capture "$session_name" 20)"
    local current_state=$(printf '%s' "$initial_capture" | md5sum | cut -d' ' -f1)
    echo "$current_state" > "$state_file"

    while true; do
        sleep "$check_interval"

        if ! transport_has_session "$session_name" 2>/dev/null; then
            echo "  session '$session_name' gone. stopping."
            rm -f "$state_file" "$stale_count_file"
            break
        fi

        # check process liveness (detect dead CLI process)
        # skip for remote workspaces (process check not supported remotely)
        if [[ "$workspace_type" == "local" ]]; then
            local pane_pid=$(transport_pid "$session_name" 2>/dev/null)
            if [[ -n "$pane_pid" ]]; then
                if ! ps -p "$pane_pid" >/dev/null 2>&1; then
                    echo "  process $pane_pid inside session '$session_name' is dead. forcing completion..."
                    if [[ -n "$chain_file" && -f "$chain_file" ]]; then
                        launch-chain-runner-complete "$session_name" "$chain_file"
                    fi
                    rm -f "$state_file" "$stale_count_file"
                    break
                fi
            fi
        fi

        # Prefer the event file over PTY nudges. Agents can emit their
        # completion event before AGENT_COMPLETE is visible in the current
        # capture window; treating that event as authoritative keeps the
        # monitor from sending a broad "continue" nudge to a finished agent.
        local completion_event_file=""
        if declare -f monitor_completion_event_file >/dev/null; then
            completion_event_file="$(monitor_completion_event_file "$session_name" "$chain_file" "$EVENTS_DIR" "${MENTIKO_AGENT_ID:-}" 2>/dev/null || true)"
            if [[ -z "$completion_event_file" && -n "$chain_file" ]]; then
                local run_events_dir
                run_events_dir="$(dirname "$chain_file")/events"
                completion_event_file="$(monitor_completion_event_file "$session_name" "$chain_file" "$run_events_dir" "${MENTIKO_AGENT_ID:-}" 2>/dev/null || true)"
            fi
        fi
        if [[ -n "$completion_event_file" ]]; then
            echo "$(date '+%H:%M:%S') - completion event detected: $(basename "$completion_event_file")"
            local script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
            if [[ -n "$chain_file" && -f "$chain_file" ]]; then
                echo "  using chain-runner-complete (JSON mode)"
                launch-chain-runner-complete "$session_name" "$chain_file"
            fi
            rm -f "$state_file" "$stale_count_file"
            break
        fi

        # -----------------------------------------------------------
        # COMPLETION DETECTION PROTOCOL:
        #
        # 1. hash last 20 lines to detect activity
        # 2. hash changed = agent working, do nothing
        # 3. hash stable = agent idle at prompt
        #    → check last 20 lines for AGENT_COMPLETE
        #    → if found: trigger handoff
        #    → if not found: agent stalled, send nudge via pty
        #
        # NEVER grep the full buffer - the agent's prompt contains
        # "AGENT_COMPLETE" as instruction text. grepping 100+ lines
        # matches the instruction before the agent finishes.
        # only check last ~20 lines AFTER idle detected.
        #
        # claude doesn't exit on context exhaustion - it idles at
        # the prompt. p alive is always true. hash comparison is
        # the only reliable signal for "agent stopped working".
        # -----------------------------------------------------------

        # Check the marker before classifying output as "active". Some CLIs
        # repaint status lines after the agent's final text, so waiting for a
        # stable hash can miss the completion window and send a stale nudge.
        if agent-complete-marker-seen "$session_name" 100; then
            echo "$(date '+%H:%M:%S') - AGENT_COMPLETE detected"
            sleep 3

            # profiler: take final snapshot before completion
            if declare -f profiler-snapshot >/dev/null; then
                profiler-snapshot "$session_name" "pre-complete" 2>/dev/null || true
            fi

            local script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
            if [[ -n "$chain_file" && -f "$chain_file" ]]; then
                echo "  using chain-runner-complete (JSON mode)"
                launch-chain-runner-complete "$session_name" "$chain_file"
            else
                echo "  no chain.json, falling back to complete-agent.sh"
                local project_root
                project_root="${MENTIKO_GLOBAL_ROOT:-$HOME/.mentiko}"
                ensure-event-file "$session_name" "$agent_context" "$project_root"
                local runtime_dir="${RUNTIME_DIR:-${MENTIKO_PROJECT_ROOT:-$project_root}/runtime}"
                if [[ -f "$runtime_dir/complete-agent.sh" ]]; then
                    nohup bash "$runtime_dir/complete-agent.sh" "$session_name" >> "/tmp/complete-agent-${session_name}.log" 2>&1 &
                    disown $!
                fi
            fi
            rm -f "$state_file" "$stale_count_file"
            break
        fi

        local recent_capture
        recent_capture="$(transport_capture "$session_name" 20)"
        local new_state=$(printf '%s' "$recent_capture" | md5sum | cut -d' ' -f1)
        local old_state=""
        [[ -f "$state_file" ]] && old_state=$(cat "$state_file")

        if [[ "$new_state" != "$old_state" ]]; then
            # output changed → agent is actively working
            echo "$(date '+%H:%M:%S') - active"
            echo "0" > "$stale_count_file"
            echo "$new_state" > "$state_file"

            # profiler: periodic snapshot (every cycle)
            if declare -f profiler-snapshot >/dev/null; then
                profiler-snapshot "$session_name" "monitor-check" 2>/dev/null || true
            fi
            continue
        fi

        if declare -f monitor_capture_looks_busy >/dev/null && monitor_capture_looks_busy "$recent_capture"; then
            echo "$(date '+%H:%M:%S') - active (busy indicator)"
            echo "0" > "$stale_count_file"
            echo "$new_state" > "$state_file"
            continue
        fi

        # hash stable → agent is idle. check recent output for a completion
        # marker on its own line. The prompt contains AGENT_COMPLETE too, so
        # this intentionally avoids substring matches.
        if agent-complete-marker-seen "$session_name" 100; then
            echo "$(date '+%H:%M:%S') - AGENT_COMPLETE detected"
            sleep 3

            # profiler: take final snapshot before completion
            if declare -f profiler-snapshot >/dev/null; then
                profiler-snapshot "$session_name" "pre-complete" 2>/dev/null || true
            fi

            local script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
            if [[ -n "$chain_file" && -f "$chain_file" ]]; then
                echo "  using chain-runner-complete (JSON mode)"
                launch-chain-runner-complete "$session_name" "$chain_file"
            else
                echo "  no chain.json, falling back to complete-agent.sh"
                local project_root
                project_root="${MENTIKO_GLOBAL_ROOT:-$HOME/.mentiko}"
                ensure-event-file "$session_name" "$agent_context" "$project_root"
                local runtime_dir="${RUNTIME_DIR:-${MENTIKO_PROJECT_ROOT:-$project_root}/runtime}"
                if [[ -f "$runtime_dir/complete-agent.sh" ]]; then
                    nohup bash "$runtime_dir/complete-agent.sh" "$session_name" >> "/tmp/complete-agent-${session_name}.log" 2>&1 &
                    disown $!
                fi
            fi
            rm -f "$state_file" "$stale_count_file"
            break
        fi

        # idle but no AGENT_COMPLETE → agent is stalled, nudge it
        local stale_count=$(cat "$stale_count_file")
        stale_count=$((stale_count + 1))
        echo "$stale_count" > "$stale_count_file"

        # check if max stale count reached (stuck agent)
        if [[ $stale_count -ge $max_stale_count ]]; then
            echo "$(date '+%H:%M:%S') - max stale count ($max_stale_count) reached. forcing completion..."
            if [[ -n "$chain_file" && -f "$chain_file" ]]; then
                launch-chain-runner-complete "$session_name" "$chain_file"
            fi
            rm -f "$state_file" "$stale_count_file"
            break
        fi

        echo "$(date '+%H:%M:%S') - stale ($stale_count). asking Mentiko advisor..."

        # nudge the agent via pty send keys
        local nudge_msg=""
        if declare -f monitor_stale_nudge_message >/dev/null; then
            nudge_msg="$(monitor_stale_nudge_message "$stale_count" "$session_name" "$agent_context" "$check_interval")"
        elif [[ $stale_count -le 4 ]]; then
            nudge_msg="continue only the current assigned task, or write your event file and output AGENT_COMPLETE on its own line."
        else
            nudge_msg="write your event file and summary artifacts, then make your final non-empty terminal line exactly AGENT_COMPLETE with no text after it."
        fi
        if declare -f monitor_sanitize_nudge >/dev/null; then
            nudge_msg="$(monitor_sanitize_nudge "$nudge_msg" "$stale_count")"
        fi
        if declare -f monitor_format_nudge_for_agent >/dev/null; then
            nudge_msg="$(monitor_format_nudge_for_agent "$nudge_msg")"
        fi

        transport_send_raw "$session_name" "$nudge_msg"
        sleep 1
        transport_send_raw "$session_name" $'\r'
        sleep 0.5

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
export -f ensure-event-file
export -f launch-chain-runner-complete
export -f monitor-with-ai
export -f monitor-chain-agent
export -f mentiko-monitor

echo "  mentiko: core functions loaded"
