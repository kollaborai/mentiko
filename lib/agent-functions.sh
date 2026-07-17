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
# new-agent-from-spec: compatibility invocation boundary
#
# The compiled TypeScript launcher owns spec parsing, session identity, PTY
# creation, instruction delivery, state publication, and typed monitor startup.
# Keep this exported function only for sourced legacy callers; it must not
# interpret a spec or reconstruct any lifecycle behavior.
# -------------------------------------------------------------------
new-agent-from-spec() {
    node "$_AF_SCRIPT_DIR/runner-v2-standalone-agent-launch.js" "$@"
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
