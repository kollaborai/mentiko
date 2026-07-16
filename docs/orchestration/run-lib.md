# Typed run record contract

a Run groups sessions by execution, providing run-id for session naming,
run.json for metadata, and run history tracking.

`web/lib/runs/run-record.ts` and `web/lib/runner-v2/run-record-cli.ts` own run
creation, ID generation, validation, and every locked `run.json` mutation.
`lib/run-lib.sh` is an invocation-only boundary: each of its functions forwards
through the single `_run_record_cli` seam in `lib/run-record-client.sh` to the
compiled `lib/runner-run-record.js`. Shell parses and serializes no run JSON.

see also:
  - [chain-runner-flow.md](./chain-runner-flow.md) - run creation in phase 4
  - [completion-entrypoint.md](./completion-entrypoint.md) - typed completion run updates

overview
========

a Run represents one chain execution:

  run-{timestamp}/
    run.json          metadata, status, agents, sessions
    artifacts/        agent outputs (diff, files-changed, etc)
    runspace/         working files for the run

run.json schema:
  {
    id: "run-1740500000",
    chain: "Chain Name",
    goal: "description from chain",
    started: "2026-03-12T10:00:00-07:00",
    completed: null | "2026-03-12T10:15:00-07:00",
    status: "running" | "completed" | "stopped" | "failed",
    status_message: "optional detail",
    parent_run_id: "run-..." | null,      // chain chaining
    taskId: "TASK-xxx" | null,           // linked task
    workspacePath: "/path/to/project",
    sessions: ["session-name", ...],     // all sessions in run
    agents: [
      {
        id: "agent-id",
        name: "Agent Name",
        session: "session-name" | null,
        status: "running" | "complete" | "error",
        started: "ISO timestamp",
        completed: "ISO timestamp" | null
      },
      ...
    ],
    artifacts: [
      {
        agentId: "agent-id",
        type: "output" | "diff" | "files-changed" | "conversations" | "events",
        path: "/path/to/artifact",
        timestamp: "ISO timestamp"
      },
      ...
    ]
  }

init
====

when sourced:
  - sources config.sh for RUNS_DIR, DEBUG_DIR
  - sets PROJECT_ROOT for git operations
  - no auto-init - functions create dirs as needed

run lifecycle functions
========================

create-run <chain.json> <goal>
  ----------------------------
  create a new run object.

  flow:
    shell:
      1. check the chain file exists, else fail
      2. assemble primitive flags (--runs-dir, --chain-file, --goal, and
         optionally --parent-run-id, --workspace-path, --task-id)
      3. forward to runner-run-record.js via _run_record_cli
      4. echo whatever the typed owner returns (the run-id)

    typed owner (web/lib/runs/run-record.ts):
      5. read the chain name from the chain file
      6. generate the run-id
      7. create RUNS_DIR/run-{id}/ and validate + atomically write run.json

  shell runs no jq and constructs no JSON here.

  usage:
    RUN_ID=$(create-run chain.json "deploy to production")

  returns: run-id

update-run-status <run-id> <status> [status_message]
  -----------------------------------------------------
  update run status field.

  statuses:
    running    - execution in progress
    completed  - all agents finished successfully
    stopped    - halted by user or watchdog
    failed     - error during execution

  flow:
    1. read run.json
    2. update status field
    3. if status != "running", set completed timestamp
    4. optionally set status_message
    5. write back to run.json

  usage:
    update-run-status $RUN_ID "completed"
    update-run-status $RUN_ID "failed" "agent timeout"

add-run-session <run-id> <session-name> <agent-id> [agent-name]
  -----------------------------------------------------------
  register a session with the run.

  called when agent is launched.

  flow:
    1. append session-name to sessions[] array
    2. add or update agent in agents[] array
    3. set agent.session = session-name
    4. set agent.status = "running"
    5. set agent.started = timestamp
    6. set agent.name if provided

  usage:
    add-run-session $RUN_ID "project-agent-1-run-123" "agent" "Researcher"

update-run-agent <run-id> <agent-id> <status>
  --------------------------------------------
  update agent status within run.

  called when agent completes or fails.

  flow:
    1. find agent in agents[] by id
    2. update agent.status
    3. if terminal status, set agent.completed timestamp

  usage:
    update-run-agent $RUN_ID "agent" "complete"
    update-run-agent $RUN_ID "agent" "error"

query functions
===============

get-run <run-id>
  --------------
  output run.json to stdout.

  returns: full run.json, or error object if not found

  usage:
    get-run $RUN_ID | jq .

list-runs [chain-name]
  --------------------
  list all runs, optionally filtered by chain.

  returns: json array of run objects

  usage:
    list-runs                    # all runs
    list-runs "deploy-chain"     # specific chain

cleanup functions
=================

cleanup-old-runs [days]
  ----------------------
  remove run directories older than N days.

  default: 30 days

  usage:
    cleanup-old-runs 7    # delete runs older than a week

  warning: deletes entire run directories including artifacts

debug state functions
=====================

debug state tracks execution steps for troubleshooting.
written to DEBUG_DIR/{run-id}.json (namespace-aware).

write-debug-state <run-id> <agent-id> <agent-name> <session> <round> <status> [output]
  ----------------------------------------------------------------------------------------
  write debug state for current step.

  flow:
    1. read existing debug file or create new
    2. sanitize output (strip ANSI, truncate to 200 chars)
    3. append step to steps[] array
    4. update current_step index
    5. write back to debug file

  usage:
    write-debug-state $RUN_ID "agent" "Agent" "session-1" 1 "running"

get-debug-state <run-id>
  -----------------------
  read current debug state.

  returns: debug json with steps[] array

clear-debug-state <run-id>
  ------------------------
  remove debug state file.

  usage: cleanup after run completes

task integration
================

update-task-from-run <run-id> <status>
  -------------------------------------
  propagate run status back to linked task (native sqlite).

  flow:
    1. read taskId from run.json
    2. build run summary (chain, dates, agents, artifacts)
    3. update task metadata via task-store.ts
    5. on terminal status, write summary note
    6. on completed, close the task via task store API
    7. emit event for traceability

  metadata fields added:
    last_run_status
    last_run_id
    last_run_chain
    last_run_started
    last_run_completed
    last_run_agents      (comma-separated id|status pairs)
    last_run_artifacts   (json array)
    last_run_error       (terminal execution error or block reason)
    last_run_blocked_reason (exact runner-v2 reason when last_run_status=blocked)

  usage: called at shell launch boundaries; typed completion uses the shared locked writer

path resolution
===============

run-lib uses namespace-aware paths from config.sh:

  RUNS_DIR      - projectRoot/runs/ (where runs are stored)
  DEBUG_DIR     - projectRoot/debug/ (where debug state lives)

default org collapse:
  ~/.mentiko/namespaces/default/runs/
  (NOT ~/.mentiko/namespaces/default/orgs/default/runs/)

non-default org:
  ~/.mentiko/namespaces/acme/orgs/engineering/projects/{cwd}/runs/

related files
=============

web/lib/runs/run-record.ts    typed run record owner
web/lib/runner-v2/run-record-cli.ts  typed command boundary source
lib/runner-run-record.js      compiled run-record CLI
lib/run-record-client.sh      the single _run_record_cli shell seam
lib/run-lib.sh                this file; invocation-only wrapper
lib/config.sh                 path resolution (RUNS_DIR, DEBUG_DIR)
lib/chain-runner.sh           creates run via create-run
web/lib/runner-v2/completion-entrypoint.ts  updates through the typed shared-lock writer
lib/agent-activity-capture.sh  invokes the typed activity capture owner;
web/lib/runner-v2/activity-capture.ts writes and validates artifacts in the run directory
web/app/api/runs/[id]/route.ts web api reads run.json

troubleshooting
===============

run.json not found?
  - check RUNS_DIR path (namespace-aware)
  - verify run-id format: run-{timestamp}
  - list runs: ls $RUNS_DIR/run-*

agent not in agents[]?
  - add-run-session might not have been called
  - check monitor session launched agent correctly
  - verify session-name matches what was registered

artifacts not showing?
  - check artifacts dir exists in run directory
  - verify run.json artifacts[] array updated
  - the compiled lib/runner-activity-capture.js bundle must exist

task not updating?
  - check taskId in run.json
  - verify task store database exists (~/.mentiko/namespaces/{id}/data/tasks.db)
  - check task via API: GET /api/tasks/<id>
