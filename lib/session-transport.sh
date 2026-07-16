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
_TRANSPORT_TYPED_CLI="${_TRANSPORT_SCRIPT_DIR}/runner-pty-transport.js"

_transport_typed() {
    [[ -f "$_TRANSPORT_TYPED_CLI" ]] || {
        echo "mentiko: typed PTY transport bundle missing: $_TRANSPORT_TYPED_CLI" >&2
        return 1
    }
    node "$_TRANSPORT_TYPED_CLI" "$@"
}

if [[ -z "${PTY_DAEMON:-}" ]]; then
    PTY_DAEMON="$(_transport_typed daemon-name)" || {
        echo "mentiko: typed PTY daemon resolution failed" >&2
        return 1 2>/dev/null || exit 1
    }
fi
export PTY_DAEMON

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
    _transport_typed ensure >/dev/null
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
    _transport_typed alive --name "$1" >/dev/null
}

# transport_session_exists: true if session is registered (alive or exited)
# use this when you want to detect any known session, not just alive ones
transport_session_exists() {
    _transport_typed has --name "$1" >/dev/null
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
    _transport_typed list
}

# -------------------------------------------------------------------
# transport_pid: get child process pid
# gets child process pid
# -------------------------------------------------------------------
transport_pid() {
    _transport_typed pid --name "$1"
}

echo "  session-transport: loaded (pty-manager)"
