# chain-runner-complete.sh - agent completion handler

called by the agent's monitor session (monitor-{session_name}) when
AGENT_COMPLETE is detected in the agent's output. the monitor runs
monitor-chain-agent (from lib/agent-functions.sh) in a companion PTY
session.

handles the transition from one agent to the next, captures artifacts,
and manages chain completion.

see also:
  - [chain-runner-flow.md](./chain-runner-flow.md) - main orchestration flow
  - [watchdog.md](./watchdog.md) - stalled run detection
  - [chain-watcher.md](./chain-watcher.md) - event-driven chain triggers

overview
========

chain-runner-complete.sh is the bridge between agents:

1. agent finishes (writes AGENT_COMPLETE to output)
2. monitor detects completion
3. monitor calls chain-runner-complete.sh
4. this script captures artifacts, finds next agent, launches it

this is where the chain transition happens - linking one agent
to the next via events.

usage
=====

  chain-runner-complete.sh <session-name> <chain.json>

called by:
  - monitor-chain-agent function (see [agent-functions.md](./agent-functions.md))
  - manual invocation (for recovery)

phase 1: derive agent identity
===============================

1. parse session name
   ------------------
   session naming: {PROJECT_NAME}-{session_prefix}-{run_suffix}

   extract session_prefix by stripping:
   - project name prefix
   - run suffix (-run-{timestamp} or -{YYYYMMDD-HHMM})

2. find agent in chain.json
   -------------------------
   match by:
   - session_prefix == agent.session_prefix
   - session_prefix == agent.id
   - session_prefix ends with agent.id

   fallback: strip chain session_prefix and match again

3. extract agent config
   ---------------------
   - CURRENT_AGENT_ID
   - CURRENT_AGENT_NAME
   - EXPECTED_EVENT (from agent.emits)

phase 2: capture final output
============================

1. capture session output
   -----------------------
   - all workspaces: transport_capture (pty-manager)
   - writes to REPORTS_DIR/{session}-{timestamp}.txt

2. extract token usage
   --------------------
   if extract-tokens-from-output function available:
   - parse output for token counts
   - record to run metrics

phase 3: find event file
========================

canonical runner events contain all six fields:

  event: {emits}
  source: {session_prefix}
  run_id: {run_id}
  timestamp: {ISO}
  processed: false
  data: {...}

the typed producer, web readers, reconciler, chain watcher, and watchdog validate
that strict shape. this shell completion reader is the remaining migration
exception: until its lifecycle scanner moves to TypeScript, it still accepts
legacy case-insensitive fields, `agent:` as a source alias, `AGENT EVENT:`
headers, JSON field extraction, and filename-derived source. those compatibility
paths are not authoritative and are scheduled for removal with
`lib/event-trigger.sh`.

this script searches EVENTS_DIR/ for:
1. source matching SESSION_PREFIX or CURRENT_AGENT_ID
2. run_id matching the active run
3. processed != true
4. event matching the agent's declared emits value

there is no success fallback. if the declared event is missing, the handler
fails the agent/run, requests a diagnostic agent-error through the typed event
emitter, and launches no downstream agent. the core-generation import backstop
is the narrow exception: a compatible run/attempt-scoped generation payload can
provide completion evidence without fabricating the declared event.

phase 4: kill sessions
======================

1. kill monitor session
   ---------------------
   monitor-{session_name} - companion session watching the agent

2. kill agent session
   ------------------
   {session_name} - the agent's PTY session

3. write state file
   -----------------
   STATE_DIR/{state_id}.state:
   - status: complete
   - session: {session_name}
   - agent_id: {id}
   - completed: {ISO timestamp}
   - event: {event_name}
   - chain: {chain_name}
   - webhook_status: sent/disabled

phase 5: capture artifacts
==========================

if RUN_ID is set (normal chain execution):

1. capture agent activity
   -----------------------
   sources agent-activity-capture.sh
   calls capture-agent-activity:
   - git diff (before..HEAD)
   - files-changed.json (name-status list)
   - conversations.json (claude .jsonl files)
   - output.txt (head + tail of session output)

2. capture git diff
   -----------------
   reads artifacts/{agentId}-git-before.txt (written by chain-runner.sh)
   runs git diff {before_sha}..HEAD
   if no committed changes: captures staged + unstaged
   writes to artifacts/{agentId}-diff.patch

3. capture files changed
   ----------------------
   parses git diff --name-status
   writes JSON array: [{status, file}, ...]
   status: M (modified), A (added), D (deleted)
   writes to artifacts/{agentId}-files-changed.json

4. capture conversations
   ----------------------
   searches ~/.claude/projects/{encoded-path}/ for .jsonl files
   newer than agent started timestamp
   writes JSON array: [{path}, ...]
   writes to artifacts/{agentId}-conversations.json

5. update run.json artifacts
   ---------------------------
   adds entries to run.json.artifacts[]:
   - {agentId, type: "output", path, timestamp}
   - {agentId, type: "events", path, timestamp}
   - {agentId, type: "diff", path, timestamp}
   - {agentId, type: "files-changed", path, timestamp}
   - {agentId, type: "conversations", path, timestamp}

6. update linked task
   ------------------
   if taskId in run.json:
   - update task via task store API with notes "Agent X completed. Event: Y. Session: Z"

phase 6: find next agent
=========================

1. loop detection
   ---------------
   track visited {agent_id}:{event} pairs in chain_loop_tracker.txt
   if already visited -> chain complete (prevent infinite loops)

2. branch mapping (branches section)
   ----------------------------------
   check chain.json branches[event_name]:

   string: "next-agent"         -> simple mapping
   array: ["agent1", "agent2"]   -> fan-out (parallel)
   object with fan_out:         -> fan-out with fan-in
   object with conditions:      -> conditional branching

3. trigger-based lookup (fallback)
   -------------------------------
   if no branch mapping, search agents[] for matching trigger:
   - normalize event name (lowercase, strip suffixes)
   - find agents with triggers[] matching event
   - if 1 match -> single agent
   - if 2+ matches -> parallel execution

4. no match found
   ---------------
   chain complete. proceed to phase 8.

phase 7: launch next agent
==========================

single agent:
  - check round count (increment if same agent triggered again)
  - if ROUND > CHAIN_MAX_ROUNDS -> stop
  - re-invoke chain-runner.sh with --start {next_agent_id}

parallel agents:
  - re-invoke chain-runner.sh with --parallel agent1 agent2 ...
  - chain-runner.sh launches all in background

fan-out (advanced):
  - create fan-group state
  - launch each agent with AGENT_FAN_GROUP_ID env
  - agents complete independently
  - fan-group-agent-complete tracks progress
  - when all done -> fan-in agent triggered

debug mode:
  - if DEBUG_MODE=true, prompt user before launching:
  - ① continue, ② skip, ③ retry, ④ abort

phase 8: chain completion
========================

when no next agent found (or max_rounds reached):

1. update run.json
   ---------------
   - status: completed
   - completed: {ISO timestamp}

2. propagate to task
   ------------------
   if taskId in run.json:
   - update task metadata via task store API: {"last_run_status":"completed",...}

3. send notifications
   -------------------
   - send-webhook "chain_complete"
   - request a typed chain-complete event through the emit-event shell wrapper
     (for chain-watcher to pick up)
   - run-plugins "chain-completed"
   - dispatch to /api/notifications/dispatch
   - fire watchdog hooks "run-completed"
   - fire metadata.webhooks for event="completed"

4. chain chaining
   ---------------
   if on_complete = "chain:{name}":
   - find next chain.json
   - spawn chain-runner.sh with new chain
   - passes MENTIKO_PARENT_RUN_ID for tracking

5. legacy webhook
   ---------------
   if on_complete = "webhook" and webhook_url set:
   - POST {chain, status, last_event} to webhook_url

phase 9: missing declared event
================================

if no matching declared event is found:

1. fail_completion_no_event records the agent as failed
2. the run is marked failed and task status is propagated
3. a diagnostic agent-error is requested through the typed emitter
4. no declared event is synthesized and no downstream route is launched

diagnostic events are failure evidence only. their event name and source cannot
satisfy the success handoff matcher.

related files
=============

lib/chain-runner-complete.sh   this file
web/lib/runner-v2/event-emitter.ts canonical runner-event serializer and writer
lib/chain-runner.sh             main orchestrator
lib/agent-functions.sh          monitor-chain-agent function (see [agent-functions.md](./agent-functions.md))
lib/agent-activity-capture.sh   artifact capture
lib/run-lib.sh                   run tracking functions
lib/routing-lib.sh               fan-out/fan-in logic
lib/error-handling.sh            circuit breaker
lib/retry-utils.sh               retry logic
lib/session-transport.sh         PTY abstraction

artifacts created
================

per agent:
  artifacts/{agentId}-git-before.txt     (written by chain-runner.sh)
  artifacts/{agentId}-started-at.txt     (written by chain-runner.sh)
  artifacts/{agentId}-diff.patch          (git diff)
  artifacts/{agentId}-files-changed.json (file list)
  artifacts/{agentId}-conversations.json (claude .jsonl paths)
  artifacts/{agentId}-output.txt          (session output)
  artifacts/{agentId}-events.json         (event fired)

run.json:
  {
    artifacts: [
      {agentId, type, path, timestamp},
      ...
    ]
  }

troubleshooting
===============

agent stuck, not completing?
  - check monitor session: transport_has_session "monitor-{session}"
  - check agent output for "AGENT_COMPLETE" string
  - check state file: STATE_DIR/{state_id}.state

next agent not launching?
  - check event file written to EVENTS_DIR/
  - check event name matches next agent's triggers[]
  - check branch mapping in chain.json branches section

chain marked complete too early?
  - check chain_loop_tracker.txt for loop detection
  - check agent.emits matches next agent's triggers

artifacts not captured?
  - check RUN_ID is set
  - check artifacts dir exists
  - check git-before.txt exists (for diff capture)
