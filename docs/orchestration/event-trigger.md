# event-trigger.sh - File-based event system

file-based event system for mentiko. producers request canonical event writes
through the typed emitter; the typed chain-watcher service watches the configured
event root and triggers matching chains.

see also:
  - [chain-watcher.md](./chain-watcher.md) - typed service that watches these events
  - [chain-runner-complete.md](./chain-runner-complete.md) - event matching on completion

overview
========

event-driven chaining:
  1. producer invokes the typed event emitter
  2. chain-watcher service detects the validated file
  3. chain-watcher matches event against chain triggers
  4. matching chain launched with event context

event file format:
  event: agent-complete
  source: agent-id
  run_id: run-1784102007562-bb990ff5
  timestamp: 2026-03-12T10:00:00-07:00
  processed: false
  data: {...}

event flow:
  agent complete -> mentiko emit -> typed emitter -> configured EVENTS_DIR
    -> typed chain-watcher detects -> matches triggers -> bin/mentiko run

init
====

when sourced:
  - requires EVENTS_DIR to have already been resolved by configuration
  - exports functions for subshells

path resolution
==============

the authoritative path is the configured `{runtimeRoot}/events` for the active
namespace, organization, and project. the typed emitter resolves that same root
through `web/lib/config.ts`; the shell helper does not guess a fallback path.

functions
=========

emit-event <event-name> <source-agent> [data] [scope]
  --------------------------------------------
  invocation-only shell entrypoint for the typed runner-event emitter.

  args:
    event-name    - name of the event (e.g. "agent-complete")
    source-agent  - agent id or session name that emitted
    data          - optional text payload
    scope         - run or ingress; defaults to run only when a run id exists

  flow:
    1. forward event, source, active run id, and data to the compiled typed CLI
    2. typed code selects timestamp and filename
    3. typed code serializes and validates the canonical fields
    4. typed code claims the final filename with an atomic hard link and never clobbers

  usage:
    emit-event "build-complete" "builder" "status=success"
    emit-event "agent-complete" "researcher"

  for user and agent prompts, prefer:
    mentiko emit "build-complete" "builder" "status=success"

  runless external ingress is exceptional and must be explicit:
    mentiko emit --scope ingress "custom-event" "operator"

  no missing-run compatibility path exists: default run scope fails closed
  when MENTIKO_RUN_ID and RUN_ID are absent.

list-events [--unprocessed]
  ---------------------------
  show all events, optionally filter unprocessed.

  output format:
    o  agent-complete              from: researcher               2026-03-12T10:00:00
    x  build-complete              from: builder                  2026-03-12T09:55:00

  icons:
    o  - unprocessed (processed: false)
    x  - processed (processed: true)

  flags:
    --unprocessed  show only unprocessed events

  usage:
    list-events
    list-events --unprocessed

mark-processed <event-file>
  --------------------------
  shell lifecycle helper that marks an event as processed. this direct mutation
  remains pending typed migration; it is not an event producer.

  args:
    event-file  - basename or full path to event file

  usage:
    mark-processed "20260312-100000-agent-complete.event"
    mark-processed "$EVENTS_DIR/20260312-100000-agent-complete.event"

archive-run-events <run-id> <source> [triggered-event-file]
  ----------------------------------------------------------
  archive only the explicitly owned event and other events belonging to the
  same run/source. sibling agents and other runs remain untouched.

archive-all-events [run-id source triggered-event-file]
  ------------------------------------------------------
  compatibility entrypoint that delegates to the same scoped archive behavior.
  with no arguments it uses ambient run/source identity; it is never a global
  sweep.

clean-events [days]
  ------------------
  remove archived events older than N days.

  default: 7 days

  flow: find EVENTS_DIR/archive/ -type f -mtime +N -delete

  usage:
    clean-events        # delete 7+ day old events
    clean-events 30     # delete 30+ day old events

event processing flow
=====================

1. agent completes
   agent writes AGENT_COMPLETE to output
   the declared event must already have been requested through `mentiko emit`

2. event written
   typed emitter validates and atomically writes under configured EVENTS_DIR
   processed: false

3. chain-watcher detects
   typed service polls the configured event root
   strictly parses required canonical fields and optional extension fields

4. trigger matching
   chain-watcher searches chain.json files for matching config.event_triggers

5. chain launched
   detached `bin/mentiko run` child starts with the matching chain
   event data available via EVENT_* env vars
   agent runs with event context

6. trigger marked handled
   chain-watcher records one durable handled marker per trigger
   the event's processed field is not changed by the watcher

7. lifecycle mutation (separate legacy surface)
   shell list/mark/archive helpers can still mutate owned event lifecycle state

event-driven chaining example
==============================

chain.json:
  {
    "name": "deploy-chain",
    "agents": [
      {
        "id": "test",
        "trigger": "manual-start",
        "emits": "tests-passed"
      },
      {
        "id": "deploy",
        "trigger": "tests-passed",
        "emits": "deployed"
      }
    ]
  }

flow:
  1. user starts chain -> test agent runs
  2. test completes -> mentiko emit "tests-passed" "test"
  3. chain-watcher detects event
  4. finds deploy agent with trigger "tests-passed"
  5. launches deploy agent
  6. deploy completes -> mentiko emit "deployed" "deploy"
  7. chain-watcher detects, finds no matching triggers
  8. chain complete

exported functions
==================

after sourcing, these functions are available in subshells:

  - emit-event
  - list-events
  - mark-processed
  - archive-run-events
  - archive-all-events
  - clean-events

related files
=============

lib/event-trigger.sh         this file
web/lib/runner-v2/event-emitter.ts canonical serializer and writer
web/lib/runner-v2/chain-watcher-service.ts typed watcher service
lib/chain-runner-complete.sh  matches declared events on agent completion
lib/chain-runner.sh           sources this for event functions
docs/tutorial/event-system.md user-facing event system guide

troubleshooting
===============

event not triggering chain?
  - check event file exists in EVENTS_DIR/
  - verify event name matches agent trigger
  - check `/api/schedules/daemon` reports the background worker and chain watcher running
  - inspect the event's per-trigger handled marker and last watcher error

chain-watcher not seeing events?
  - check EVENTS_DIR path (namespace-aware)
  - verify the background worker process can read the configured event root
  - check background-worker and chain-watcher logs for errors

old events triggering chains?
  - inspect per-trigger handled markers and watcher status
  - archive only with run/source ownership; do not sweep sibling events

event file format issues?
  - do not hand-write event files; use `mentiko emit`
  - required exactly once: event, source, run_id, timestamp, processed, data
  - optional extension fields must be lowercase, unique, and non-colliding
  - malformed, duplicate, missing, or noncanonical fields are rejected
