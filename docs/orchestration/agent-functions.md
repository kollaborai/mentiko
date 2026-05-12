# agent-functions.sh - core functions library

library of bash functions for PTY-based AI agent orchestration.
not a standalone script - sourced by chain-runner.sh and other tools.

see also:
  - [chain-runner-flow.md](./chain-runner-flow.md) - main orchestration flow
  - [chain-runner-complete.md](./chain-runner-complete.md) - completion handler

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

event functions
===============

ensure-event-file <session_name> <agent_context> <project_root>
  -------------------------------------------------------------

  fallback event writer. if agent says AGENT_COMPLETE but forgot
  to write an event file, this reads the spec and writes a clean
  event on behalf of the agent.

  flow:
    1. checks if any event file from this agent already exists
    2. finds spec file from agent_context
    3. extracts emit event name from spec
    4. writes fallback event file to EVENTS_DIR/

  event format:
    event: {emit_event}
    source: {session_prefix}
    timestamp: {ISO}
    data: fallback event (agent completed but did not write event file)
    processed: false

  usage: ensure-event-file "my-session" "Spec: spec.md" "/path/to/project"

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
       - if found: call ensure-event-file, launch complete-agent.sh
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
         - launch chain-runner-complete.sh (json mode)
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
  - legacy mode (grep-parsing spec files)
  - calls complete-agent.sh on completion
  - uses ensure-event-file fallback
  - for: legacy spec-based agents

monitor-chain-agent:
  - json-driven mode (chain.json)
  - calls chain-runner-complete.sh on completion
  - no event file fallback (chain.json has expected event)
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
  - ensure-event-file
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
lib/chain-runner-complete.sh  completion handler
lib/mentiko-monitor.sh          profile-aware monitor script
