# orchestration docs

documentation for the mentiko orchestration layer. this is the brain
of mentiko - it coordinates agent execution, handles events, manages
chain lifecycle, and provides the infrastructure for multi-agent
workflows.

see: [../architecture.md](../architecture.md) for system-wide architecture.

see: [../RUNNER_V2_ARCHITECTURE.md](../RUNNER_V2_ARCHITECTURE.md) for the
current typed runner-v2 boundary and the complete HTTP-to-next-agent lifecycle.

overview
========

the orchestration layer is a hybrid typescript/shell event-driven system that:

  - reads chain.json definitions
  - spawns AI agents in isolated PTY sessions
  - monitors agent output for completion signals
  - captures artifacts (git diffs, files changed, conversations)
  - emits events to trigger next agents or chains
  - tracks execution state in run.json objects
  - detects and handles stalled runs
  - supports retry, fan-out/fan-in, and error routing

the long-running chain watcher and watchdog are typescript services owned by
`web/server/background-worker.ts`. they are not shell or pty daemons.

architecture philosophy
=======================

not a loop
  the typed direct runner launches ONE initial agent then exits. the next agent
  is selected and durably accepted by the typed completion entrypoint.
  this prevents cascading failures and enables event-driven chaining.

event-driven
  agents emit events when they complete. the next agent is triggered
  by matching events, not by hard-coded sequence. enables flexible
  pipelines and cross-chain automation.

fault isolation
  each agent runs in its own PTY session with a companion monitor
  session. a crash in one agent doesn't crash the entire chain.

file-based state
  run objects (run.json), event files, state files, and debug state
  are all written to disk. enables recovery, inspection, and auditing.

namespace-aware
  all paths resolve through the 3-tier hierarchy:
  namespace > organization > project.

typed chain generation
----------------------

`lib/chain-generator.sh` is an invocation-only legacy command boundary. The
compiled `web/lib/runner-v2/chain-generation-cli.ts` owns the generation
prompt, external model output decoding, normalized chain validation, atomic
`chain.json` materialization, and agent-spec materialization. The model CLI is the only
child-process product boundary; there is no shell parser or alternate CLI
fallback. The production image compiles this contract to
`lib/runner-chain-generation.js`.

typed chain version control
---------------------------

`lib/version-control.sh` is an invocation-only legacy boundary. The compiled
`web/lib/runner-v2/version-control.ts` contract owns semver validation, chain
version/metadata JSON parsing, snapshot creation, version listing, rollback
backups, agent comparison, and all version-path resolution. Its CLI is
`web/lib/runner-v2/version-control-cli.ts`, compiled in production to
`lib/runner-version-control.js`. The external `diff` command remains the sole
child-process product behavior for version diffs; shell does not parse JSON,
serialize metadata, or provide a fallback. Ownership details live in
`docs/orchestration/contracts/chain-version-control.design.json`.

typed git projections
---------------------

`lib/git-integration.sh` keeps only the legacy function/invocation boundary
for the read-only projection functions (`git_status`, `git_get_history`,
`git_diff_commits`, `git_list_branches`, `git_detect_conflicts`,
`git_get_commit_info`, `git_compare_branches`, and `git_get_stash_list`). The
compiled `web/lib/runner-v2/git-integration-cli.ts`
(`lib/runner-git-integration.js` in the production image) runs the required
external Git CLI, parses status, history, diff, branch, conflict, commit,
comparison, and stash output, and owns the normalized JSON records. Diff
payloads are base64 encoded by TypeScript; shell does not run `jq`, assemble
records, or provide a fallback. The external chain `.git` directory remains
the source of truth and no Mentiko JSON projection is persisted.

typed team-mux interoperability
--------------------------------

`lib/teammux-bridge.sh` is an invocation-only boundary. The compiled
`web/lib/runner-v2/teammux-bridge-cli.ts` owner reads and validates external
team-mux `configurations/agent-spec.json` and memory JSON records, extracts the
documented README metadata, and atomically writes exported README/spec files.
It also owns team-mux root and agent path resolution, including symlink
rejection. No shell JSON parser, heredoc contract, or shell fallback remains;
the production image compiles this boundary to `lib/runner-teammux-bridge.js`.

typed audit shipping and notification dispatch
----------------------------------------------

`lib/audit-ship.sh` and `lib/notification-dispatcher.sh` are invocation-only
boundaries. `web/lib/runner-v2/audit-ship.ts` validates raw JSONL before
normalizing audit identity/timestamps, derives the external object key, owns
rclone retry/failure records, and never turns malformed input into an invented
audit object. `web/lib/runner-v2/notification-dispatcher.ts` owns the typed
request/response envelope, the `chain-started` event mapping, event-specific
messages, and malformed-response handling. The shell files contain no JSON,
HTTP, retry, or fallback logic. Enforceable ownership is recorded in
`docs/orchestration/contracts/audit-ship.contract.json` and
`docs/orchestration/contracts/notification-dispatch.contract.json`.

core components
===============

execution layer
---------------

[chain-runner-flow.md](./chain-runner-flow.md)
  main orchestrator. 8-phase execution flow:
    0. initialization (source libraries; long-running services are already worker-owned)
    1. argument parsing
    2. chain.json validation
    3. agent resolution (profiles, configs)
    4. run initialization (create run.json)
    5. agent launch (create PTY, send instructions)
    6. execution (agent runs, monitor watches)
    7. agent completion (via the typed completion entrypoint)
    8. cleanup (on_complete: stop/keep/archive)

  key point: NOT a loop. launches one agent, exits.

[completion-entrypoint.md](./completion-entrypoint.md)
  typed completion owner. durable process when an agent finishes:
    1. derive agent identity from session name
    2. capture final output
    3. find and strictly match the declared runner event
    4. capture artifacts and update run.json under the shared lock
    5. queue idempotent external effects
    6. durably accept route targets and fan-in claims
    7. consume the trigger only after accepted effects and targets
    8. clean up the completed agent and monitor sessions

  called by: monitor session when AGENT_COMPLETE detected.

[agent-functions.md](./agent-functions.md)
  thin shell boundary for direct external PTY transport plus typed standalone
  and manual-monitor invocation. It is not sourced by the typed chain runner.

  key functions:
    - new_pty_session          direct external PTY creation
    - send-message             interactive agent communication
    - peek-session             view session output
    - new-agent-from-spec      typed standalone-launch forwarding boundary
    - mentiko-monitor          typed manual-monitor forwarding boundary

  There is no generic shell agent launcher or shell monitor. Typed launch and
  monitor owners validate lifecycle input and fail closed before touching PTYs.

background service layer
------------------------

[watchdog.md](./watchdog.md)
  typed stalled-run recovery. the background worker runs one pass at startup
  and every 60 seconds.

  flow:
    1. list all runs with status "running"
    2. for each run, check agent session exists
    3. honor live process, handoff, completion, and grace evidence
    4. recheck pty and run state immediately before mutation
    5. mark a still-proven stall as "stopped"
    6. emit run-stalled and queue durable recovery effects

  grace periods:
    - 10 seconds: newly missing session
    - 2 minutes: resume, sessionless agent, or pending run
    - 5 minutes: exited-session or recent-completion handoff

[chain-watcher.md](./chain-watcher.md)
  typed event-driven chain trigger service. the background worker watches the
  configured event root for new event files.

  flow:
    1. scan EVENTS_DIR/ for unprocessed events
    2. read event: name, source, timestamp, data
    3. search chains for matching triggers
    4. launch matching chains via detached `bin/mentiko run`
    5. record per-trigger handled markers without mutating the event

  enables:
    - agent chaining (event triggers next agent in chain)
    - cross-chain automation (one chain triggers another)
    - manual triggers (`mentiko emit` from the CLI)

supporting libraries
====================

[session-transport.md](./session-transport.md)
  invocation-only pty-manager boundary. `web/lib/pty/pty-client.ts` owns daemon
  identity, readiness, session listing, liveness, and child-PID projection; the
  shell forwards primitive transport operations to `runner-pty-transport.js` and
  invokes the external `bin/p` CLI, which is the required product behavior.

  functions (each forwards to the typed transport CLI or the PTY binary):
    - transport_init           ensure daemon running
    - transport_new_session    spawn PTY session
    - transport_send_keys      send text + enter
    - transport_send_raw       send text without enter
    - transport_capture        capture output
    - transport_has_session    check alive
    - transport_kill_session   kill and remove
    - transport_list_sessions  list all sessions
    - transport_pid            get process pid

  all workspaces: uses pty-manager daemon (bin/p)
  remote workspaces: local PTY session that SSHs or docker-execs in

[run-lib.md](./run-lib.md)
  invocation-only run-record boundary. `web/lib/runs/run-record.ts` and
  `web/lib/runner-v2/run-record-cli.ts` own run creation, locked `run.json`
  mutation, and validation. Every function below forwards through the single
  `_run_record_cli` seam in `lib/run-record-client.sh` to
  `runner-run-record.js`; run-lib.sh parses no JSON.

  functions:
    - create-run              create run-{id}/run.json
    - update-run-status       update status field
    - add-run-session         register session with run
    - update-run-agent        update agent status
    - get-run                 read run.json
    - list-runs               list all runs
    - cleanup-old-runs        delete old runs
    - write-debug-state       track execution steps
    - update-task-from-run    propagate to linked task

  run.json schema:
    - id, chain, goal, started, completed, status
    - sessions[] (all sessions in run)
    - agents[] (id, name, session, status, timestamps)
    - artifacts[] (agent outputs: diff, files-changed, etc)

[event-trigger.md](./event-trigger.md)
  typed file-based event lifecycle. the path is retained for inbound links.

  public commands:
    - mentiko emit         atomically write one canonical event
    - mentiko events       strictly list valid and invalid event files

  typed lifecycle operations:
    - find                 resolve one strict unprocessed completion event
    - mark                 atomically set processed:true
    - consume              process the explicit trigger and archive owned events

  event file format:
    event: agent-complete
    source: agent-id
    run_id: run-1784102007562-bb990ff5
    timestamp: 2026-03-12T10:00:00-07:00
    processed: false
    data: {...}

  canonical serialization, validation, filename selection, and atomic writes
  live in web/lib/runner-v2/event-emitter.ts. strict scan, lookup, processed
  mutation, and scoped archival live in web/lib/runner-v2/event-lifecycle.ts.

[routing-lib.md](./routing-lib.md)
  invocation-only routing boundary. `web/lib/runner-v2/routing-contract.ts` owns
  the branch/fan/error/timeout contract. Each function below is a one-line
  forward to `runner-routing-contract.js`; the file must never parse chain
  routing JSON itself.

  functions (all forwarding):
    - retry-calculate-delay     exponential backoff
    - branch-parse              parse branch config
    - error-handler-resolve     find error handler
    - timeout-check-agent       check timeout exceeded

  patterns:
    - fan-out: one event triggers multiple agents
    - fan-in: wait for all/any/quorum before continuing
    - retry: exponential, linear, fixed backoff
    - error routing: on_error, on_timeout handlers
    - conditional branching: if/then/else logic

data flow
=========

1. user starts chain (cli or web ui)
   input: chain.json path, optional --workspace, --task, --start

   runner-v2-direct-run.ts:
     -> validates and normalizes the chain
     -> loads typed task context when --task is supplied
     -> creates run object (run-{timestamp}/run.json) and immutable snapshot
     -> resolves the initial agent and agent profile
     -> builds typed PTY, readiness, instruction, and monitor plans

2. agent launch
   typed bootstrap executor:
     -> performs typed admission and creates the PTY session
     -> writes typed instruction and startup evidence artifacts
     -> gates readiness before instruction submission
     -> starts the typed monitor with the allowlisted run context
     -> creates monitor session (monitor-{session-name})
    -> monitor runs compiled monitor-v2 with the allowlisted run context

3. agent execution (in agent PTY session)
   agent runs:
     -> reads instructions
     -> performs work (writes code, runs commands, etc)
     -> writes AGENT_COMPLETE to output when done

   monitor session (typed monitor only):
     -> watches agent output for "AGENT_COMPLETE"
     -> handles timeout (agent.timeout config)
     -> handles stall detection (no output for N intervals)
     -> on detection: starts the typed completion launcher

4. agent completion
   typed completion responsibilities:
     -> kills monitor and agent sessions
     -> captures final output (transport_capture)
     -> git diff (before..HEAD) -> artifacts/{agent-id}-diff.patch
     -> captures files changed -> artifacts/{agent-id}-files-changed.json
     -> captures conversations -> artifacts/{agent-id}-conversations.json
     -> updates run.json (agent status, artifacts manifest)
     -> strictly resolves the agent's matching declared event; absence fails closed
     -> finds next agent (branch mapping or trigger matching)
     -> synchronously accepts runner-v2-launch-agent and only then consumes the event

5. next agent triggered
   two paths:

   a) same chain (next agent):
      -> typed completion invokes the typed routed-agent launcher directly
      -> RUN_ID and run directory are preserved via env
      -> durable agent/session/attempt state is verified in the same run before event consumption

   b) cross-chain (chain-watcher):
      -> the background-worker-owned typed watcher detects a new event file
      -> strictly parses it and matches chain config.event_triggers
      -> launches detached bin/mentiko run with scoped trigger environment
      -> records handled state without changing the event's processed field

6. chain completion
   when no next agent found:
     -> run.json status = "completed"
     -> completed timestamp set
     -> webhook sent (chain.webhook config)
     -> slack notification sent
     -> linked task updated (if taskId in run.json)
     -> chain chaining (if on_complete = "chain:{name}")
     -> metrics recorded
     -> cleanup based on on_complete (stop/keep/archive)

execution modes
===============

local workspace (default)
  - PROJECT_ROOT = git rev-parse --show-toplevel
  - sessions created via pty-manager daemon
  - transport_* functions talk to bin/p
  - process liveness checks work

ssh workspace
  - SSH_HOST, SSH_USER, SSH_PATH, SSH_KEY, SSH_PORT
  - sessions created via pty-manager (local PTY that SSHs into remote host)
  - transport_* functions used for all operations
  - no process liveness (can't check remote pid)

docker workspace
  - DOCKER_CONTAINER, DOCKER_PATH, DOCKER_USER
  - sessions created via pty-manager (local PTY that docker-execs into container)
  - transport_* functions used for all operations
  - no process liveness (container isolates pid namespace)

path resolution (namespace-aware)
==================================

3-tier hierarchy:
  namespace -> organization -> project

paths collapse for "default" org:
  ~/.mentiko/namespaces/default/runs/
  (NOT ~/.mentiko/namespaces/default/orgs/default/runs/)

non-default org:
  ~/.mentiko/namespaces/{ns}/orgs/{org}/runs/

project (encoded cwd):
  ~/.mentiko/namespaces/{ns}/orgs/{org}/projects/{encoded-cwd}/runs/

key directories:
  RUNS_DIR      projectRoot/runs/           (run objects)
  EVENTS_DIR    projectRoot/events/         (event files)
  STATE_DIR     projectRoot/state/          (agent state)
  DEBUG_DIR     projectRoot/debug/          (debug state)
  REPORTS_DIR   projectRoot/reports/agent-reports/
  ARTIFACTS_DIR runsDir/{runId}/artifacts/  (agent outputs)

env vars for child processes:
  MENTIKO_GLOBAL_ROOT     ~/.mentiko
  MENTIKO_NAMESPACE_ROOT  ~/.mentiko/namespaces/{id}
  MENTIKO_ORG_ROOT        resolved org root
  MENTIKO_PROJECT_ROOT    resolved project root
  NAMESPACE_ID            namespace id (default: "default")
  ORG_ID                  org id (default: "default")
  MENTIKO_RUN_ID          run id
  MENTIKO_PARENT_RUN_ID   parent run id (chain chaining)

key concepts
============

event-driven chaining
  agents emit events (event file to EVENTS_DIR/). next agent
  triggered by matching event name in triggers[] or branches{}.
  enables flexible pipelines without hardcoding dependencies.

  example:
    agent A emits "build-complete" -> agent B with trigger "build-complete" starts

fault isolation
  each agent in separate PTY session. companion monitor session
  watches it. crash in one agent doesn't crash entire chain.
  monitor can detect failure and trigger error handler.

resumability
  run.json tracks all agents and their status. can restart from
  any agent with --start <id>. run id preserved across restarts.

stall detection
  the background worker runs the typed watchdog every 60s. live pty/process,
  handoff, completion, and grace evidence wins. only a twice-checked stall is
  marked "stopped"; pty observation failure leaves the run unchanged.

cross-chain triggers
  the typed chain watcher watches the configured event root. one chain's
  completion can trigger another chain's start. enables multi-chain workflows.

fan-out / fan-in
  single event can trigger multiple agents in parallel (fan-out).
  wait for all/any/quorum to complete before continuing (fan-in).
  implemented by typed routing and fan-group contracts; routing-lib.sh only invokes typed primitives.

artifact capture
  on agent completion, capture:
    - git diff (before..HEAD) as patch
    - files changed (name-status list)
    - conversations (configured profile .jsonl files)
    - output (captured terminal report)
  stored in runs/{runId}/artifacts/

  `web/lib/runner-v2/activity-capture.ts` owns raw-file checks, typed
  name-status parsing, transcript path resolution, symlink rejection, atomic
  artifact writes, and the `run.json` activity manifest mutation. Git remains
  an external probe. `lib/agent-activity-capture.sh` is only the invocation
  boundary and does not parse or serialize activity data.

task integration
  chains can be linked to tasks via --task flag.
  run status propagated back to task metadata.
  on completion, task auto-closed with summary.

monitor vs chain-watcher
========================

two "watchers", different purposes:

  monitor session (per-agent)
    - monitor-{session-name} PTY session
    - runs the compiled typed monitor
    - watches ONE agent's output for AGENT_COMPLETE
    - handles timeout and stall detection for that agent
    - starts the typed completion launcher when the agent is done
    - lifecycle: tied to agent (dies with it)

  chain-watcher (background-worker service)
    - one in-process service plus a per-namespace/org pid lock
    - watches the configured event root for new event files
    - matches events against ALL chains' triggers
    - launches new chains through detached bin/mentiko run children
    - lifecycle: starts and stops with the background worker

quick reference: file locations
================================

core orchestration:
  lib/chain-runner.sh              compatibility filename; execs typed direct runner
  web/lib/runner-v2/completion-entrypoint.ts typed completion owner
  lib/launch-agent.sh              standalone-spec compatibility forwarding boundary

libraries:
  lib/agent-functions.sh           PTY session functions
  lib/session-transport.sh         pty-manager abstraction
  lib/run-lib.sh                   run object management
  web/lib/runner-v2/event-lifecycle.ts strict scan, lookup, processed mutation, archive
  web/lib/runner-v2/routing-contract.ts typed branch/fan/error/timeout contract
  lib/routing-lib.sh               invocation-only routing compatibility boundary
  web/lib/runner-v2/version-control.ts typed chain version/metadata contract
  lib/version-control.sh            invocation-only version-control boundary
  web/lib/runner-v2/agent-profile.ts typed profile validation, resolution, and command compilation
  lib/config.sh                    path resolution
  web/lib/runner-v2/activity-capture.ts typed artifact/provenance capture
  lib/agent-activity-capture.sh         invocation-only activity boundary
  web/lib/runner-v2/task-context.ts typed task API normalization and prompt handoff
  lib/runner-task-context.js            compiled task-context CLI boundary
  web/lib/runner-v2/teammux-bridge.ts typed team-mux agent/spec/memory contract
  lib/teammux-bridge.sh                 invocation-only team-mux boundary

background services:
  web/server/background-worker.ts                process owner
  web/lib/runner-v2/event-emitter.ts              canonical runner-event writer
  web/lib/runner-v2/event-lifecycle-cli.ts        typed lifecycle CLI source
  web/lib/runner-v2/watchdog.ts                   stalled-run recovery
  web/lib/runner-v2/chain-watcher-service.ts      event-triggered chain launch

supporting:
  web/lib/runner-v2/error-handling.ts typed report/error/retry lifecycle owner
  lib/error-handling.sh            invocation-only error boundary
  web/lib/runner-v2/retry-circuit.ts typed retry policy and circuit-state owner
  lib/retry-utils.sh               invocation-only typed retry/circuit boundary
  web/lib/runner-v2/approval-gate.ts typed approval request/polling owner
  lib/approval-gate.sh             invocation-only approval boundary
  lib/webhook-sender.sh            webhook notifications
  lib/slack-integration.sh         slack notifications
  lib/metrics.sh                   invocation-only metrics boundary; forwards
                                   primitive metric operations to runner-legacy-metrics.js
  lib/chain-runner.sh              invocation-only compatibility boundary for typed direct run
  lib/profiler.sh                  collects only live PTY/OS resource samples;
                                   the typed runtime-profiler owns the records
  lib/performance.sh               collects only real PTY process resource values

binary:
  bin/p                            pty-manager daemon (node.js)

troubleshooting
===============

agent stuck, not completing?
  - check monitor session exists: transport_has_session "monitor-{session}"
  - check agent output for "AGENT_COMPLETE" string
  - check state file: STATE_DIR/{agent-id}.state
  - check agent.timeout in chain.json

next agent not launching?
  - check event file written to EVENTS_DIR/
  - run `mentiko events --unprocessed` to inspect pending and invalid events
  - verify event name matches next agent's triggers[]
  - check branches{} mapping in chain.json

run marked "stopped" prematurely?
  - inspect watchdog status in state/background-worker.json
  - confirm the configured pty transport reported the session accurately
  - inspect runnerV2.watchdog in the run.json for the durable assessment
  - verify the run was outside resume, startup, handoff, and completion grace

artifacts not captured?
  - check RUN_ID is set in environment
  - check artifacts dir exists: runs/{runId}/artifacts/
  - verify git-before.txt exists (for diff capture)
  - check the typed activity bundle exists: lib/runner-activity-capture.js
  - check the configured profile has a valid log_path when conversations are expected

pty-manager issues?
  - check daemon running: ./bin/p status
  - check sessions: ./bin/p list
  - restart daemon: ./bin/p daemon
  - check for orphaned sessions: kill dead sessions first

namespace path bugs?
  - #1 recurring issue: namespace path mismatches
  - web API writes to namespaced paths, bash reads from legacy flat paths
  - fix: always pass MENTIKO_ROOT from API spawn env
  - verify paths: echo $RUNS_DIR, echo $EVENTS_DIR

related docs
============

[../run-tracking.md](../run-tracking.md)         - run directory structure
[../tutorial/chain-anatomy.md](../tutorial/chain-anatomy.md)   - chain.json schema
[../tutorial/event-system.md](../tutorial/event-system.md)     - event system guide
[../architecture.md](../architecture.md)       - system-wide architecture
# Typed readiness boundary

`lib/cli-readiness-enhanced.sh` is an invocation-only adapter. `web/lib/runner-v2/readiness-cli.ts` owns PTY readiness polling, capture classification, fail-closed behavior, and terminal outcome codes; it invokes the configured PTY command as the required external product boundary.

The legacy `wait_for_profile_readiness` entrypoint delegates the same typed command with the bounded startup-recovery budget and artifact directory. Advisor selection, decision validation, key translation, retry application, and recovery audit records are owned by `readiness-cli.ts`; the shell only applies the resulting run/agent lifecycle state.
