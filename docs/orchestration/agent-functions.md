# agent-functions.sh - core functions library

library of bash functions for PTY-based AI agent orchestration.
not a standalone script - sourced by chain-runner.sh and other tools.

see also:
  - [chain-runner-flow.md](./chain-runner-flow.md) - main orchestration flow
  - [completion-entrypoint.md](./completion-entrypoint.md) - typed completion owner

overview
========

this file provides reusable functions for:
  - creating and managing PTY sessions
  - launching AI agents (claude, codex, aider, etc)
  - monitoring agent sessions
  - detecting completion and handling timeouts

all functions are exported after definition and can be used in any
script that sources this file.

init
====

when sourced, this file:
1. loads session-transport.sh (pty-manager abstraction)
2. initializes transport via transport_init
3. validates MENTIKO_CLI exists (default: claude)
4. exports all functions

session management functions
============================

new_pty_session <session_name>
  ------------------------------
  wrapper for transport_new_session.
  creates a new PTY session via pty-manager.

  usage: new_pty_session "my-session"

send-message <session_name> <message>
  -----------------------------------
  send text to a session, wait for response, capture output.
  used for interactive agent communication.

  usage: send-message "my-session" "your task is X"

peek-session <session_name> [tail_lines]
  ------------------------------------------
  view session output. if tail_lines provided, captures that many
  lines from end of session. otherwise captures all output.

  usage: peek-session "my-session" 50

agent creation functions
========================

new-agent-session <session_name> <agent_name> <task_description>
  ------------------------------------------------------------
  create a new PTY session and launch an AI agent with a task.

  flow:
    1. creates PTY session
    2. sends MENTIKO_CLI command (claude, glm, etc)
    3. sends initialization message with agent name and task
    4. agent begins working

  usage: new-agent-session "my-session" "researcher" "analyze X"

new-agent-from-spec <spec_file> [--monitor]
  ----------------------------------------------
  launch an agent from a spec file (markdown format).

  spec file format:
    name: Agent Name
    session-prefix: agent-id
    event: agent-complete
    ...

  flow:
    1. parses spec file for session-prefix and name
    2. builds session name: {project}-{session-prefix}-{date}
    3. calls new-agent-session with task from spec
    4. writes state file to STATE_DIR/{agent_id}.state
    5. if --monitor: starts monitor session

  usage: new-agent-from-spec "agents/researcher.md" --monitor

event diagnostics
=================

  monitor failure and stall paths can request diagnostic runner events through
  _monitor_emit_diagnostic_event. this shell helper is invocation-only: the
  typed runner-event emitter owns canonical bytes, strict six-field validation,
  filenames, and atomic writes.

  diagnostic events require an explicit run id and never substitute for an
  agent's declared success event. if the declared event is missing, completion
  fails closed instead of manufacturing a successful handoff.

monitor functions
=================

monitor-with-ai <session_name> [check_interval] [agent_context] [max_stale_count]
  ----------------------------------------------------------------------------

  legacy monitor function. watches agent session for AGENT_COMPLETE,
  handles timeouts and stalls by nudging with AI-generated prompts.

  flow:
    1. wait for session to appear (30s timeout)
    2. loop every check_interval (default: 60s):
       - check session still exists
       - check process still alive (local only)
       - grep output for "AGENT_COMPLETE"
       - if found without chain context: fail closed; do not fabricate an event
       - if output unchanged (stale):
         - increment stale counter
         - if max_stale_count reached: force completion
         - otherwise: nudge with AI-generated prompt

  stale detection:
    - captures 20 lines, computes md5 hash
    - if hash unchanged from last check -> stale
    - nudges with prompt to MENTIKO_CLI
    - prompt asks AI to generate 1-2 sentence directive

  usage: monitor-with-ai "my-session" 60 "Spec: spec.md" 5

monitor-chain-agent <session_name> [check_interval] [agent_context] [chain_file] [workspace_type] [max_stale_count]
  --------------------------------------------------------------------------------------------------------

  json-driven monitor variant. uses chain.json for completion
  handling instead of grep-parsing spec files. supports local,
  ssh, and docker workspaces.

  flow:
    1. wait for session to appear (30s timeout)
    2. loop every check_interval:
       - check session still exists
       - check process alive (local workspaces only)
       - grep output for "AGENT_COMPLETE"
       - if found:
         - call profiler-snapshot
         - launch the typed completion PTY through its one-shot context handoff
       - if output unchanged (stale):
         - increment stale counter
         - if max_stale_count reached: force completion
         - otherwise: nudge with AI-generated prompt

  workspace support:
    - local: uses transport_* functions (pty-manager)
    - ssh: uses transport_* functions (local PTY that SSHs into remote host)
    - docker: uses transport_* functions (local PTY that docker-execs into container)

  nudging:
    - captures 500 lines of agent output
    - sends to MENTIKO_CLI with supervisor prompt
    - sends response to agent session

  usage: monitor-chain-agent "my-session" 60 "Chain: X, Agent: Y" "/path/to/chain.json" "local" 5

mentiko-monitor <session_name> "end_state" [profile] [interval]
  -------------------------------------------------------------

  profile-aware monitor wrapper. calls mentiko-monitor.sh script
  with provided arguments.

  usage: mentiko-monitor "my-session" "complete" "default-profile" 60

monitor flow comparison
======================

monitor-with-ai:
  - legacy spec-oriented monitor loop
  - requires chain context for completion and otherwise fails closed
  - never fabricates a missing declared event

monitor-chain-agent:
  - json-driven mode (chain.json)
  - calls the typed completion launcher on completion
  - missing declared event fails closed; chain.json only identifies what to match
  - for: chain-based agents

both handle:
  - AGENT_COMPLETE detection
  - process liveness checks
  - stale detection and nudging
  - max_stale_count forcing completion

state files
==========

monitor state (per session):
  $HOME/.mentiko_monitor/{session_name}_state     (md5 hash)
  $HOME/.mentiko_monitor/{session_name}_stale    (stale count)

agent state (per agent):
  STATE_DIR/{session_prefix}.state                  (status, session, started, etc)

exported functions
==================

after sourcing, these functions are available:

  - new_pty_session
  - send-message
  - new-agent-session
  - new-agent-from-spec
  - peek-session
  - monitor-with-ai
  - monitor-chain-agent
  - mentiko-monitor

usage in scripts
=================

source the library:
  source "$SCRIPT_DIR/agent-functions.sh"

use functions:
  new-agent-session "my-session" "agent" "task"
  monitor-chain-agent "my-session" 60 "context" "$CHAIN_FILE" "local" 5

related files
=============

lib/agent-functions.sh        this file
lib/session-transport.sh      pty-manager abstraction
lib/chain-runner.sh          main orchestrator (sources this)
web/lib/runner-v2/completion-entrypoint.ts typed completion owner
lib/mentiko-monitor.sh          profile-aware monitor script
