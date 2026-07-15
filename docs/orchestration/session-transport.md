# session-transport.sh - PTY session abstraction layer

abstraction layer for session management. wraps pty-manager daemon
for all session types. remote workspaces (ssh/docker) create a local
PTY session that SSH's or docker-exec's into the remote host.

see also:
  - [chain-runner-flow.md](./chain-runner-flow.md) - usage in agent launch
  - [agent-functions.md](./agent-functions.md) - functions that use transport

overview
========

pty-manager (bin/p) is a node.js daemon that creates PTY sessions.
this library provides a clean bash API for:

  - spawning sessions
  - sending input (keys or raw)
  - capturing output
  - checking liveness
  - killing sessions
  - listing sessions
  - getting process pids

local:    all transport_* calls -> pty-manager daemon
remote:   all transport_* calls -> pty-manager daemon (session SSHs/docker-execs in)

init
====

when sourced:
  - resolves PTY_CMD to ../bin/p (relative to script dir)
  - no auto-init - daemon started on first transport_init call

transport_init
=============

ensure pty-manager daemon is running. idempotent - safe to call
multiple times.

  transport_init

flow:
  1. check if daemon running (p status)
  2. if not, start daemon (p daemon)
  3. wait up to 5s (10 retries x 0.5s)
  4. return 0 if ready, 1 if failed

usage: called implicitly by transport_new_session, or explicitly
during chain-runner initialization.

session management functions
============================

transport_new_session <name> [cmd] [args...]
  ----------------------------------------------
  create a new PTY session.

  forms:
    transport_new_session my-agent
      -> starts default shell in session

    transport_new_session my-agent bash script.sh
      -> runs specific command

  flow:
    1. calls transport_init (ensures daemon running)
    2. p spawn <name> [cmd] [args...]
    3. session created, command running

  returns: 0 on success, 1 on failure

transport_send_keys <name> <text>
  ---------------------------------
  send text followed by enter key.

  equivalent: tmux send-keys -t <name> "<text>" Enter

  flow:
    - p send <name> "<text>"
    - pty-manager sends text, waits 1s, sends enter

  used for: sending commands to agent sessions

transport_send_raw <name> <text>
  -------------------------------
  send text without enter key.

  equivalent: tmux send-keys -t <name> -l "<text>"

  used for: incremental input, multi-line pastes

transport_capture <name> [lines]
  -------------------------------
  capture session output.

  forms:
    transport_capture my-agent
      -> full buffer

    transport_capture my-agent 40
      -> last 40 lines

  equivalent: tmux capture-pane -t <name> -p [-S -<lines>]

  returns: output text to stdout

transport_has_session <name>
  ---------------------------
  check if session exists and is alive.

  returns: 0 if alive, 1 if dead/not found/daemon not running

  used for: monitoring agent sessions, checking before spawn

transport_session_exists <name>
  -------------------------------
  true if session is registered (alive OR exited).

  use this when you want to detect any known session, not just
  alive ones. useful for cleanup of dead sessions.

transport_kill_session <name>
  ----------------------------
  kill and remove session.

  equivalent: tmux kill-session -t <name>

  flow:
    - p remove <name>
    -> kills if alive, then removes from manager

  used for: cleanup on agent completion, chain stop

transport_list_sessions
  ----------------------
  list session names (one per line).

  equivalent: tmux list-sessions -F '#{session_name}'

  returns: list of session names, or "no sessions"

  used for: diagnostics, finding orphaned sessions

transport_pid <name>
  ------------------
  get child process pid.

  equivalent: tmux display-message -t <name> -p "#{pane_pid}"

  returns: pid number or empty if not found

  used for: process monitoring, killing runaway agents

remote workspace notes
=========================

all workspaces (local, ssh, docker) use the same transport_* functions.
remote workspaces create a local PTY session via pty-manager, then
SSH or docker-exec into the remote host from within that session.
there are no separate remote helpers - everything goes through pty-manager.

pty-manager commands reference
==============================

transport function  | pty-manager command
--------------------+--------------------
transport_new_session    p spawn
transport_send_keys      p send
transport_send_raw       p send --raw
transport_capture        p capture
transport_has_session    p alive
transport_kill_session   p remove
transport_list_sessions  p list
transport_pid            p pid

pty-manager vs tmux equivalence
================================

pty-manager replaced tmux for all session types (historical reference):

  tmux                               pty-manager
  ---------------------------------  -------------------------
  tmux new-session -s name           p spawn name
  tmux send-keys -t name "cmd" Enter p send name "cmd"
  tmux capture-pane -t name -p       p capture name
  tmux has-session -t name           p alive name
  tmux kill-session -t name          p remove name
  tmux list-sessions                 p list
  tmux display-message -p "#{pane_pid}"  p pid name

advantages of pty-manager:
  - node.js daemon (easier to debug)
  - cleaner session management (no orphaned sessions)
  - better output capture (full buffer available)
  - unified transport for all workspace types (local, ssh, docker)

related files
=============

lib/session-transport.sh    this file
bin/p                        pty-manager daemon (node.js)
lib/chain-runner.sh         uses transport for local agents
lib/agent-functions.sh      uses transport for session mgmt
typed completion uses the PTY client for output capture and cleanup

troubleshooting
===============

daemon not starting?
  - check if node is installed
  - check if bin/p exists and is executable
  - try manually: ./bin/p daemon
  - check port conflicts (pty-manager uses random port)

session not found?
  - transport_list_sessions to see all sessions
  - check if daemon running: ./bin/p status
  - session name might be wrong (check run.json sessions[])

capture returns empty?
  - session might not have output yet
  - agent might still be initializing
  - check session alive: transport_has_session

can't kill session?
  - check if session exists: transport_session_exists
  - force kill: ./bin/p remove <name>
  - last resort: kill -9 $(transport_pid <name>)
