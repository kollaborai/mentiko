#!/bin/bash
# session-transport.sh - Abstraction layer for session management
#
# Uses pty-manager daemon for all sessions.
# Remote workspaces (ssh/docker) are local PTY sessions that
# SSH/docker-exec into the remote host.
#
# Source this file to get transport_* functions.
#
# Functions:
#   transport_init          - ensure pty-manager daemon is running
#   transport_new_session   - create a new session (p spawn)
#   transport_send_keys     - send text + enter (p send)
#   transport_send_raw      - send text without enter (p send --raw)
#   transport_capture       - capture session output (p capture)
#   transport_has_session   - check if session exists and alive (p alive)
#   transport_kill_session  - kill and remove session (p remove)
#   transport_list_sessions - list session names (p list)
#   transport_pid           - get child process pid (p pid)

# resolve pty-manager CLI path
# prefer bin/p (dev wrapper) if it exists and is executable,
# otherwise fall back to pty-mgr on PATH (container/production)
_TRANSPORT_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_LOCAL_P="${_TRANSPORT_SCRIPT_DIR}/../bin/p"
if [[ -x "$_LOCAL_P" ]] && ! [[ -L "$_LOCAL_P" && ! -e "$_LOCAL_P" ]]; then
    PTY_CMD="$_LOCAL_P"
elif command -v pty-mgr >/dev/null 2>&1; then
    PTY_CMD="pty-mgr"
else
    PTY_CMD="$_LOCAL_P"  # will fail with clear error
fi

# -------------------------------------------------------------------
# transport_init: ensure pty-manager daemon is running
# idempotent - safe to call multiple times
# -------------------------------------------------------------------
transport_init() {
    if "$PTY_CMD" status >/dev/null 2>&1; then
        return 0
    fi
    echo "  starting pty-manager daemon..."
    "$PTY_CMD" daemon 2>/dev/null
    # daemon forks and reports ready, but verify
    local retries=0
    while ! "$PTY_CMD" status >/dev/null 2>&1; do
        retries=$((retries + 1))
        if [[ $retries -ge 10 ]]; then
            echo "  error: pty-manager daemon failed to start"
            return 1
        fi
        sleep 0.5
    done
    return 0
}

# -------------------------------------------------------------------
# transport_new_session: create a new session
# usage: transport_new_session <name> [cmd] [args...]
#   transport_new_session my-agent              (starts default shell)
#   transport_new_session my-agent bash script  (runs specific command)
# -------------------------------------------------------------------
transport_new_session() {
    # ensure pty-manager daemon is running before spawning sessions
    transport_init || return 1

    local name="$1"
    shift
    if [[ $# -gt 0 ]]; then
        "$PTY_CMD" spawn "$name" "$@" >/dev/null 2>&1
    else
        "$PTY_CMD" spawn "$name" >/dev/null 2>&1
    fi
}

# -------------------------------------------------------------------
# transport_send_keys: send text + enter
# sends text + enter to session
# -------------------------------------------------------------------
transport_send_keys() {
    local name="$1"
    local text="$2"
    "$PTY_CMD" send "$name" "$text" 2>/dev/null
}

# -------------------------------------------------------------------
# transport_send_raw: send text without enter
# sends text without enter
# -------------------------------------------------------------------
transport_send_raw() {
    local name="$1"
    local text="$2"
    "$PTY_CMD" send "$name" --raw "$text" 2>/dev/null
}

# -------------------------------------------------------------------
# transport_capture: capture session output
# usage: transport_capture <name> [lines]
#   transport_capture my-agent        (full buffer)
#   transport_capture my-agent 40     (last 40 lines)
# captures rendered screen output
# -------------------------------------------------------------------
transport_capture() {
    local name="$1"
    local lines="${2:-}"
    if [[ -n "$lines" ]]; then
        "$PTY_CMD" capture "$name" "$lines" 2>/dev/null
    else
        "$PTY_CMD" capture "$name" 2>/dev/null
    fi
}

# -------------------------------------------------------------------
# transport_has_session: check if session exists and is alive
# returns 0 if alive, 1 if dead/not found/daemon not running
# checks if session is alive
# -------------------------------------------------------------------
transport_has_session() {
    local result
    result=$("$PTY_CMD" alive "$1" 2>/dev/null) || return 1
    [[ "$result" == "alive" ]] && return 0
    return 1
}

# transport_session_exists: true if session is registered (alive or exited)
# use this when you want to detect any known session, not just alive ones
transport_session_exists() {
    "$PTY_CMD" list 2>/dev/null | awk '{print $1}' | grep -qxF "$1"
}

# -------------------------------------------------------------------
# transport_kill_session: kill and remove session
# uses 'remove' which kills if alive then removes from manager
# kills and removes session
# -------------------------------------------------------------------
transport_kill_session() {
    "$PTY_CMD" remove "$1" 2>/dev/null || true
}

# -------------------------------------------------------------------
# transport_list_sessions: list session names (one per line)
# lists all session names
# -------------------------------------------------------------------
transport_list_sessions() {
    local output
    output=$("$PTY_CMD" list 2>/dev/null) || return 0
    if [[ "$output" == "no sessions" ]]; then
        return 0
    fi
    echo "$output" | awk '{print $1}'
}

# -------------------------------------------------------------------
# transport_pid: get child process pid
# gets child process pid
# -------------------------------------------------------------------
transport_pid() {
    "$PTY_CMD" pid "$1" 2>/dev/null
}

echo "  session-transport: loaded (pty-manager)"
