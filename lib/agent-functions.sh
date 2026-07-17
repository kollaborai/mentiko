#!/bin/bash
# agent-functions.sh - direct PTY command boundaries for Mentiko

# Load session transport (pty-manager for all sessions)
_AF_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$_AF_SCRIPT_DIR/session-transport.sh"
source "$_AF_SCRIPT_DIR/ai-gateway-agent-env.sh" 2>/dev/null || true

if ! transport_init; then
    echo "  mentiko: pty-manager daemon could not start"
    return 1 2>/dev/null || exit 1
fi

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

# Legacy generic agent launch, chain-monitor, completion-latch, stale/nudge,
# process-death, and diagnostic helpers were retired.
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
export -f new-agent-from-spec
export -f peek-session
export -f mentiko-monitor

echo "  mentiko: core functions loaded"
