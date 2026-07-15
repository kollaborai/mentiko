# chain-runner.sh execution flow

complete breakdown of how chain-runner.sh orchestrates agent chains.

see also:
  - [watchdog.md](./watchdog.md) - stalled run detection
  - [chain-watcher.md](./chain-watcher.md) - event-driven chain triggers

overview
========

chain-runner.sh is the main orchestration engine that reads chain.json,
resolves agents, creates PTY sessions, and manages execution flow.

it is NOT a loop - it launches one agent, then exits.
the next agent is selected and durably accepted by the typed completion entrypoint.

this pattern enables:
  - event-driven chaining (agents emit events, next agent waits for trigger)
  - fault isolation (crash in one agent doesn't crash entire chain)
  - resumability (can restart from any agent with --start <id>)

phase 0: initialization
======================

1. source libraries
   ------------------
   sources orchestration libraries:
   - config.sh               namespace and path resolution
   - agent-functions.sh      agent utility functions (see [agent-functions.md](./agent-functions.md))
   - webhook-sender.sh       webhook notifications
   - slack-integration.sh    slack notifications
   - run-lib.sh              run tracking (create-run, update-run-status, etc)
   - metrics.sh              performance metrics
   - performance.sh          OS/PTY sample boundary for typed performance tracking
   - profiler.sh             OS/PTY sample boundary for typed agent profiling
   - error-handling.sh       error handling
   - scheduler.sh            cron scheduling
   - runner-audit.js         typed audit CLI boundary
   - retry-utils.sh          retry logic
   - approval-gate.sh        human approval gates
   - plugin-runner.sh        typed plugin-dispatch CLI invocation boundary
   - budget-check.sh         spending limits

   runner-event emission and lifecycle are not sourced shell libraries. process
   boundaries invoke the compiled typed emitter and lifecycle CLIs under
   `MENTIKO_CODE_ROOT/lib/`.

2. background services
   -------------------
   chain startup does not create watchdog or chain-watcher sessions. the
   process-manager-owned typescript background worker already owns stalled-run
   scans and file-event chain launches. a watcher failure exits the worker so
   process-manager supervision restarts the complete service.

   see: [watchdog.md](./watchdog.md) and [chain-watcher.md](./chain-watcher.md)

phase 1: argument parsing
=========================

usage:
  chain-runner.sh <chain.json> [options]

options:
  --workspace <path>     override project_root (useful for multi-repo workflows)
  --task <id>            load task context from task store (populates {TASK_*} placeholders)
  --start <agent-id>     start from specific agent (skip to this agent)
  --parallel <ids...>    launch multiple agents in parallel
  --dry-run              validate chain and show graph without executing
  --debug                enable step-through debug mode

global vars:
  RUN_ID              from env (MENTIKO_RUN_ID, AGENT_CHAIN_RUN_ID) or created new
  PARENT_RUN_ID       for chain chaining (on_complete: "chain:<name>")
  NAMESPACE_ID        default (or from env)

phase 2: chain.json validation
===============================

1. check jq installed
   -------------------
   exits if jq not found (brew install jq / apt install jq)

2. validate JSON syntax
   ----------------------
   jq empty "$CHAIN_FILE"
   exits if invalid JSON

3. extract chain config
   ----------------------
   CHAIN_NAME          chain name
   CHAIN_CLI           executor to use (claude, codex, aider, kollabor)
   CHAIN_CLI_ARGS      additional cli arguments
   CHAIN_MONITOR       enable monitor sessions
   CHAIN_MONITOR_INTERVAL  seconds between monitor checks
   CHAIN_MAX_ROUNDS    max passes through chain
   CHAIN_SESSION_PREFIX  prefix for session names
   CHAIN_ON_COMPLETE   what to do when done (stop/keep/archive)
   CHAIN_WEBHOOK       webhook URL for notifications
   CHAIN_SCHEDULE      cron schedule
   CHAIN_DEFAULT_AGENT_PROFILE  default profile for agents without one

4. resolve executor
   ------------------
   priority: config.executor > config.cli > MENTIKO_CLI env > "claude"

   friendly names map to binaries:
   - claude   -> claude
   - claude-cli -> claude (legacy alias)
   - codex    -> codex
   - aider    -> aider
   - kollabor -> kl

5. resolve config profiles
   -------------------------
   loads chain-level profiles from config-profiles/:
   - execution profile  overrides cli, cli_args, monitor, max_rounds, on_complete
   - model profile      overrides cli, cli_args

   profile files: {orgRoot}/config-profiles/{type}/{name}.json

6. load task context
   ------------------
   if --task <id> provided:
   - fetches task from native sqlite task store (task-store.ts)
   - extracts: id, title, description, type, priority,
              acceptance_criteria, design, notes
   - fetches comments
   - builds TASK_CONTEXT block
   - exports TASK_ID, TASK_TITLE, TASK_DESCRIPTION, etc.

7. workspace config
   ------------------
   WORKSPACE_TYPE      local | ssh | docker

   ssh:
   - SSH_HOST, SSH_USER, SSH_PATH, SSH_KEY, SSH_PORT

   docker:
   - DOCKER_CONTAINER, DOCKER_PATH, DOCKER_USER

8. resolve project root
   ----------------------
   --workspace flag overrides chain config
   project_root "auto" -> git rev-parse --show-toplevel

9. build namespace-aware paths
   -----------------------------
   local workspace:
   - uses MENTIKO_PROJECT_ROOT from config.sh (already collapsed)

   remote workspace:
   - collapses default org: REMOTE_PROJECT_ROOT (no /orgs/default/)
   - non-default org: REMOTE_PROJECT_ROOT/namespaces/{id}/
   - EVENTS_DIR, STATE_DIR, REPORTS_DIR built from REMOTE_NAMESPACE_ROOT

10. create runspace
   --------------
   if RUN_ID set:
   - RUNSPACE_DIR = RUNS_DIR/{runId}/runspace
   - creates manifest.json (run_id, chain_name, artifacts[])

phase 3: agent resolution
=========================

1. find starting agent
   --------------------
   --start <id> flag overrides auto-detection

   auto-detection:
   - find agent with trigger "manual-start"
   - fallback to first agent in chain.json

2. resolve agent profile
   ----------------------
   priority: agent.agent_profile > chain.default_agent_profile >
              workspace default > namespace default

   an explicitly selected profile must exist and validate; malformed or absent
   selections fail closed rather than selecting a lower-priority profile.

3. build profile command
   ----------------------
   calls the typed runner-agent-profile command compiler

   returns a typed-produced command that sources a private temporary env file,
   deletes it immediately, then invokes the external CLI.

   env vars are NEVER inlined in command string (security + cleanliness).

4. legacy CLI resolution
   ----------------------
   only used if profile_id == "__inline__":

   priority: agent.cli > agent.executor > gateway.cli >
              agent profile (old) > chain.cli

phase 4: run initialization
============================

1. create run object
   ------------------
   if RUN_ID not set:
   - calls create-run from run-lib.sh
   - generates run-{timestamp} ID
   - creates RUNS_DIR/{runId}/run.json
   - exports RUN_ID for subprocesses

2. run.json schema
   ---------------
   {
     id: "run-1740500000"
     chain: "Chain Name"
     goal: "description from chain"
     started: "2026-03-12T10:00:00-07:00"
     completed: null
     status: "running"
     status_message: "chain started"
     agents: []
     sessions: []
     config: { chainId, workspaceId, taskId }
     metadata: { parentRunId, branchName }
   }

3. metrics: track run start
   --------------------------
   - metric-counter "runs_started" 1
   - metric-counter "chain_{name}_runs" 1
   - metric-start-timer "run_{runId}"

4. audit: chain start
   -------------------
   submits the chain-start fact to the compiled typed audit CLI; the CLI owns
   JSONL append, index validation, and atomic index publication

phase 5: agent launch
=====================

function: launch_chain_agent <agent-id> <round>

1. pre-flight checks
   ------------------
   budget check:
   - calls check-budget from budget-check.sh
   - stops chain if over spending limit

   circuit breaker:
   - calls is_circuit_open from error-handling.sh
   - stops chain if agent in open state (too many recent failures)

   approval gate:
   - if agent.approval_gate == true
   - calls wait_for_approval from approval-gate.sh
   - waits for human approval (timeout configurable)
   - stops chain if rejected or timed out

2. breakpoint check
   -----------------
   if breakpoint enabled for agent:
   - calls pause_at_breakpoint
   - updates breakpoints.json with pausedAt, hitCount
   - calls wait_for_resume (polls breakpoints.json for resumeRequested)

3. build agent instructions
   --------------------------
   if agent.spec set:
   - instructions point to spec file path
   - agent reads spec and follows playbooks

   elif agent.prompt set:
   - builds instructions from prompt
   - substitutes placeholders: {TASK_*}, {GOAL}, {CHAIN_NAME}
   - includes context files (read_first array)
   - includes authorities (can array)
   - includes runspace context (current files, produces, consumes)

4. create session
   ---------------
   local:   transport_new_session (pty-manager daemon)
   ssh:     transport_new_session (local PTY that SSHs into remote host)
   docker:  transport_new_session (local PTY that docker-execs into container)

   session naming: {PROJECT_NAME}-{session_prefix}-{run_suffix}

5. register session with run
   ---------------------------
   calls add-run-session from run-lib.sh
   updates run.json agents[] and sessions[] arrays

6. git snapshot (before)
   -----------------------
   writes:
   - artifacts/{agentId}-git-before.txt (git HEAD sha)
   - artifacts/{agentId}-started-at.txt (ISO timestamp)

   used by activity capture to generate diff on completion.

7. start CLI
   -----------
   builds command:
   - cd $REMOTE_PROJECT_ROOT
   - unset CLAUDECODE (so claude doesn't refuse to run in nested session)
   - source /tmp/agent-gw-env-XXXXXX (if gateway env vars set)
   - rm -f /tmp/agent-gw-env-XXXXXX
   - {profile_cmd or cli_cmd}

   sends to session:
   - local:   transport_send_keys (pty-manager)
   - ssh:     transport_send_keys (pty-manager, session is SSH'd in)
   - docker:  transport_send_keys (pty-manager, session is docker-exec'd in)

8. send instructions
   ------------------
   multi-line instructions sent via heredoc (temp file for remote)

9. write state file
   -----------------
   STATE_DIR/{state_id}.state:
   - status: running
   - session: {session_name}
   - agent_id: {id}
   - round: {n}
   - started: {ISO timestamp}
   - chain: {name}
   - emits: {event_name}
   - workspace: local|ssh|docker
   - timeout: {seconds}
   - retry_max: {n}
   - retry_attempt: 0
   - on_error: {handler}
   - on_timeout: {handler}
   - start_sha: {git sha}

10. start heartbeat
   -----------------
   background loop sends POST to /api/runs/{runId}/agents/{agentId}/heartbeat
   every 60 seconds while state file says "running"
   exits when status changes or 404 (run deleted)

11. start monitor
   ---------------
   if agent.monitor == true:
   - creates monitor-{session_name} session
   - runs monitor-chain-agent from agent-functions.sh
   - watches agent output for AGENT_COMPLETE
   - handles timeouts and stalls
   - starts the typed completion launcher when the agent is done

   see [completion-entrypoint.md](./completion-entrypoint.md) for
   what happens after completion.

12. metrics: agent started
   ------------------------
   - metric-counter "agents_launched" 1
   - metric-counter "chain_{name}_agents_launched" 1
   - metric-start-timer "agent_{session_name}"

13. performance tracking
   ----------------------
   calls perf-start-agent through performance.sh; the wrapper invokes the compiled typed runtime-metrics CLI

14. profiler: start tracking
   --------------------------
   calls profiler-start through profiler.sh; the wrapper invokes the compiled typed runtime-metrics CLI

phase 6: execution (agent monitor session)
============================================

the agent's monitor session (monitor-{session_name}) runs independently.
this is a PTY session running the monitor-chain-agent function from
lib/agent-functions.sh (see [agent-functions.md](./agent-functions.md)).

1. watch for AGENT_COMPLETE
   --------------------------
   grep output for "AGENT_COMPLETE" line

2. timeout handling
   -----------------
   if agent.timeout set and exceeded:
   - send nudge message
   - if max_stale_count exceeded:
   - mark as failed
   - call typed completion with failure evidence

3. stall detection
   ---------------
   if no output for agent_max_stale intervals:
   - send nudge message
   - increment stale counter
   - if max_stale exceeded: mark as failed

phase 7: agent completion (typed completion entrypoint)
=====================================================

called by monitor when AGENT_COMPLETE detected.

full documentation: [completion-entrypoint.md](./completion-entrypoint.md)

summary:

1. parse session name
   -------------------
   extracts agent_id from session name

2. read state file
   ---------------
   STATE_DIR/{state_id}.state
   gets agent config (emits, round, retry_attempt, etc)

3. git diff (after)
   -----------------
   git diff {before_sha}..HEAD > artifacts/{agentId}-diff.patch

4. capture agent activity
   -----------------------
   sources agent-activity-capture.sh
   calls capture-agent-activity:
   - diff.patch          git diff
   - files-changed.json  git diff --name-status
   - conversations.json  from xterm.js logs or conversation artifacts
   - output.txt          head + tail of agent output

   updates run.json artifacts[] manifest

5. update state file
   -------------------
   status: completed | failed
   completed: {ISO timestamp}
   end_sha: {git sha}

6. update run status
   ------------------
   calls update-run-status from run-lib.sh
   updates run.json agents[] with agent status

7. verify declared event
   ----------------------
   matches the strict event already written through the typed emitter:
   event: {agent_emits}
   source: {session_prefix}
   run_id: {run_id}
   timestamp: {ISO timestamp}
   processed: false
   data: {...}

   a missing declared event fails the agent/run; completion does not fabricate
   a success event. chain-event-watcher can independently pick up the event for
   cross-chain triggers.
   see: [chain-watcher.md](./chain-watcher.md)

8. metrics: agent completed
   --------------------------
   - metric-counter "agents_completed" 1
   - metric-stop-timer "agent_{session_name}"

9. performance tracking
   ----------------------
   calls perf-end-agent through performance.sh; the wrapper invokes the compiled typed runtime-metrics CLI

10. profiler: stop tracking
   --------------------------
   calls profiler-end through profiler.sh; the wrapper invokes the compiled typed runtime-metrics CLI

11. find next agent
   ----------------
   searches chain.json for agent with trigger matching emitted event

12. retry logic
   ------------
   if agent failed and retry.max_retries > 0:
   - calculate backoff delay (exponential: delay * 2^attempt)
   - update state file retry_attempt
   - relaunch same agent

13. error handlers
   ---------------
   on_error:  skip | stop | {agent_id}
   on_timeout: skip | stop | {agent_id}

14. launch next agent
   ------------------
   if next agent found in typed completion:
   - invokes runner-v2-launch-agent for exact targets
   - waits for bounded CLI exit and verifies run agent/session/attempt state
   - leaves the active parent event retryable until durable acceptance

   there is no shell completion branch. typed launch rejection leaves the
   parent event active for replay.

15. chain completion
   ------------------
   if no next agent (or max_rounds reached):
   - update run.json status: completed
   - send-webhook "chain_complete"
   - send-slack-chain-complete
   - handle on_complete (stop/keep/archive)
   - metric-stop-timer "run_{runId}"
   - metric-counter "runs_completed" 1

16. debug mode
   -----------
   if --debug enabled:
   - calls debug-prompt
   - shows agent output
   - prompts: continue/skip/retry/abort

phase 8: cleanup
================

on_complete values:

  stop     - kill all sessions, exit
  keep     - leave sessions running for inspection
  archive  - move sessions to archive folder

webhooks:
  chain_started   sent when chain starts
  agent_started   sent for each agent
  agent_complete  sent for each agent
  chain_complete  sent when chain finishes

notifications:
  slack integration sends start/complete/fail messages
  can be configured per chain

key files involved
==================

lib/chain-runner.sh           main orchestrator (this file)
web/lib/runner-v2/completion-entrypoint.ts  completion owner (see [completion-entrypoint.md](./completion-entrypoint.md))
lib/agent-functions.sh        function library (see [agent-functions.md](./agent-functions.md))
web/lib/runner-v2/agent-profile.ts typed profile validation, resolution, and command compilation
lib/launch-agent.sh           agent launcher (legacy)
lib/config.sh                 namespace/path config
lib/run-lib.sh                run tracking
lib/session-transport.sh      pty-manager abstraction
web/lib/runner-v2/event-lifecycle.ts strict event scan, lookup, processed mutation, archive
web/lib/runner-v2/event-lifecycle-cli.ts compiled lifecycle command source
lib/metrics.sh                performance metrics
lib/performance.sh            performance tracking
lib/profiler.sh               agent profiling
lib/error-handling.sh         error handling + circuit breaker
lib/approval-gate.sh          human approval gates
lib/budget-check.sh           spending limits
web/lib/runner-v2/chain-watcher-service.ts  file-event chain launches (see [chain-watcher.md](./chain-watcher.md))
web/lib/runner-v2/watchdog.ts               stalled run detection (see [watchdog.md](./watchdog.md))
lib/scheduler.sh              cron scheduling
web/lib/system/audit-log.ts   typed audit logging and index ownership
web/lib/system/audit-cli.ts   compiled audit command source
lib/retry-utils.sh            retry logic
web/lib/system/plugin-dispatch.ts typed registry parsing and hook dispatch
lib/plugin-runner.sh          minimal typed plugin-dispatch invocation boundary
lib/token-extractor.sh        token usage extraction

related daemons
===============

[watchdog.md](./watchdog.md)                - detects stalled runs
[chain-watcher.md](./chain-watcher.md)       - event-driven chain triggers
[completion-entrypoint.md](./completion-entrypoint.md) - typed agent completion owner

data paths (namespace-aware)
============================

runs:        {orgRoot}/runs/{runId}/
events:      {projectRoot}/events/
state:       {projectRoot}/state/
reports:     {projectRoot}/reports/agent-reports/
artifacts:   {runsDir}/{runId}/artifacts/
runspace:    {runsDir}/{runId}/runspace/

collapse logic (default org):
  ~/.mentiko/namespaces/default/runs/           (not /orgs/default/runs/)
  ~/.mentiko/namespaces/{ns}/runs/              (non-default namespace)

non-default org:
  ~/.mentiko/namespaces/{ns}/orgs/{org}/runs/

env vars for path resolution
============================

MENTIKO_GLOBAL_ROOT     ~/.mentiko
MENTIKO_CODE_ROOT       the git checkout
MENTIKO_NAMESPACE_ROOT  ~/.mentiko/namespaces/{id}
MENTIKO_ORG_ROOT        resolved org root (collapsed for default)
MENTIKO_PROJECT_ROOT    resolved project root (collapsed for default)
NAMESPACE_ID            default (or from env)
ORG_ID                  default (or from env)
MENTIKO_RUN_ID          run id (or generated new)
