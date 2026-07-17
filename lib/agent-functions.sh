#!/bin/bash
# agent-functions.sh - Core functions for mentiko
# PTY-based AI agent orchestration with file events

# Load session transport (pty-manager for all sessions)
_AF_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$_AF_SCRIPT_DIR/session-transport.sh"
source "$_AF_SCRIPT_DIR/ai-gateway-agent-env.sh" 2>/dev/null || true
source "$_AF_SCRIPT_DIR/agent-state-client.sh"

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

# Legacy chain-monitor, completion-latch, stale/nudge, process-death, and diagnostic helpers were retired.
# The active chain monitor is the compiled TypeScript service at lib/monitor-v2.js,
# launched directly by lib/chain-runner.sh. Standalone spec sessions start
# lib/runner-v2-standalone-monitor.js. This sourced file intentionally retains no
# monitor state, lifecycle mutation, event parsing, or completion fallback.

# -------------------------------------------------------------------
# mentiko-monitor: typed profile-aware manual monitor invocation boundary
# usage: mentiko-monitor <session-name> "end state" [profile] [interval]
# -------------------------------------------------------------------
mentiko-monitor() {
    local lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    node "$lib_dir/runner-manual-monitor.js" "$@"
}

# exports
export -f new_pty_session
export -f send-message
export -f new-agent-session
export -f new-agent-from-spec
export -f peek-session
export -f mentiko-monitor

echo "  mentiko: core functions loaded"
