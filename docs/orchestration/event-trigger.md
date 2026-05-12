# event-trigger.sh - File-based event system

file-based event system for mentiko. agents emit events to files,
chain-watcher daemon watches for events and triggers matching chains.

see also:
  - [chain-watcher.md](./chain-watcher.md) - daemon that watches these events
  - [chain-runner-complete.md](./chain-runner-complete.md) - event emission on completion

overview
========

event-driven chaining:
  1. agent completes, emits event (writes file to EVENTS_DIR/)
  2. chain-watcher daemon detects new file
  3. chain-watcher matches event against chain triggers
  4. matching chain launched with event context

event file format:
  event: agent-complete
  source: agent-id
  timestamp: 2026-03-12T10:00:00-07:00
  processed: false
  data: {...}

event flow:
  agent complete -> emit-event -> EVENTS_DIR/{timestamp}-{name}.event
    -> chain-watcher detects -> matches triggers -> chain-runner.sh

init
====

when sourced:
  - resolves EVENTS_DIR to {projectRoot}/namespaces/{ns}/events/
  - creates EVENTS_DIR if not exists
  - exports functions for subshells

path resolution
==============

namespace-aware:
  default:     ~/.mentiko/namespaces/default/events/
  non-default: ~/.mentiko/namespaces/{ns}/events/

finds project root via git rev-parse --show-toplevel or pwd.

functions
=========

emit-event <event-name> <source-agent> [data]
  --------------------------------------------
  write an event file to EVENTS_DIR/.

  args:
    event-name    - name of the event (e.g. "agent-complete")
    source-agent  - agent id or session name that emitted
    data          - optional json payload

  flow:
    1. generate timestamp: YYYYMMDD-HHMMSS
    2. create file: {timestamp}-{event-name}.event
    3. write event format with processed: false
    4. echo confirmation

  usage:
    emit-event "build-complete" "builder" "status=success"
    emit-event "agent-complete" "researcher"

  filename: 20260312-100000-agent-complete.event

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
  mark an event as processed.

  handles any format - agents write events unpredictably:
    - if file has "processed: false", flips to true
    - if file has no processed field, appends "processed: true"

  args:
    event-file  - basename or full path to event file

  usage:
    mark-processed "20260312-100000-agent-complete.event"
    mark-processed "$EVENTS_DIR/20260312-100000-agent-complete.event"

archive-all-events
  -----------------
  move all events to archive dir.

  called between chain steps to prevent stale event pickup.
  prevents old events from triggering new chains.

  flow:
    1. create EVENTS_DIR/archive/ if not exists
    2. move all event files to archive/
    3. count archived files

  usage: typically called by chain-watcher after processing

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
   monitor detects completion
   chain-runner-complete.sh calls emit-event

2. event written
   file: EVENTS_DIR/{timestamp}-{event-name}.event
   processed: false

3. chain-watcher detects
   daemon wakes (fsnotify or poll)
   finds unprocessed event files
   reads event: name, source, timestamp, data

4. trigger matching
   chain-watcher searches chain.json files for:
   - agents with triggers[] matching event name
   - branches[event-name] mappings
   - event_triggers at chain level

5. chain launched
   chain-runner.sh invoked with matching chain
   event data available via EVENT_* env vars
   agent runs with event context

6. event marked processed
   mark-processed called after chain launch
   prevents re-trigger on same event

7. archive (optional)
   archive-all-events moves processed events
   keeps EVENTS_DIR/ clean for new events

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
  2. test completes -> emit-event "tests-passed" "test"
  3. chain-watcher detects event
  4. finds deploy agent with trigger "tests-passed"
  5. launches deploy agent
  6. deploy completes -> emit-event "deployed" "deploy"
  7. chain-watcher detects, finds no matching triggers
  8. chain complete

exported functions
==================

after sourcing, these functions are available in subshells:

  - emit-event
  - list-events
  - mark-processed
  - archive-all-events
  - clean-events

related files
=============

lib/event-trigger.sh         this file
lib/chain-watcher.sh         daemon that watches events (see chain-watcher.md)
lib/chain-runner-complete.sh  emits events on agent completion
lib/chain-runner.sh           sources this for event functions
docs/tutorial/event-system.md user-facing event system guide

troubleshooting
===============

event not triggering chain?
  - check event file exists in EVENTS_DIR/
  - verify event name matches agent trigger
  - check chain-watcher daemon running
  - verify event not already marked processed

chain-watcher not seeing events?
  - check EVENTS_DIR path (namespace-aware)
  - verify daemon has read permissions
  - check daemon logs for errors

old events triggering chains?
  - run archive-all-events to cleanup
  - chain-watcher should mark events processed
  - check processed field in event file

event file format issues?
  - agents can write any format
  - only required fields: event, source, timestamp
  - processed field added if missing
  - data field optional (any text)
