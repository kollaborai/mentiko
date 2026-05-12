# chain-event-watcher.sh - event-driven chain triggers

daemon that watches EVENTS_DIR/ for new events and triggers chains
based on their event_triggers config.

see also:
  - [chain-runner-flow.md](./chain-runner-flow.md) - main orchestration
  - [watchdog.md](./watchdog.md) - stalled run detection

overview
========

chain-event-watcher enables cross-chain automation:

1. agents emit events (write .event files to EVENTS_DIR/)
2. chain-event-watcher detects new events
3. matches events against chain event_triggers configs
4. launches matching chains automatically

this enables:
  - chain chaining (agent A finishes, chain B starts)
  - notifications (event triggers alert chain)
  - pipelines (each stage is a separate chain)

usage
=====

  chain-event-watcher.sh              start daemon (default 10s interval)
  chain-event-watcher.sh --interval 5  custom poll interval
  chain-event-watcher.sh --namespace ns  specific namespace
  chain-event-watcher.sh --oneshot      process events once and exit

env vars:
  CHAIN_WATCHER_INTERVAL=10   poll interval in seconds
  NAMESPACE_ID=default        namespace to watch

chain.json config
=================

chains define event_triggers in config:

  {
    "name": "notification-chain",
    "config": {
      "event_triggers": [
        {
          "event": "deployment-complete",
          "source_chain": "deploy",
          "condition": "",
          "pass_data": true
        },
        {
          "event": "run-stalled",
          "source_chain": "watchdog",
          "condition": "",
          "pass_data": false
        }
      ],
      "agents": [...]
    }
  }

trigger fields:

  event (required)       event name to match
  source_chain (optional) only match if from this chain
  condition (optional)   bash expression evaluated with event data in scope
  pass_data (optional)   pass event data as CHAIN_INPUT env var

startup
=======

1. source config.sh for paths (EVENTS_DIR, CHAINS_DIR, RUNTIME_DIR)
2. parse args (--interval, --namespace, --oneshot)
3. create watcher state dir: RUNTIME_DIR/chain-watcher/
4. start main loop

main loop
=========

every iteration (every POLL_INTERVAL seconds):

1. reload triggers (every 6 iterations)
   ------------------------------------
   scan all chains in CHAINS_DIR/*/
   extract event_triggers from each chain.json
   build JSON array of triggers:
   ```
   [{
     chain_name: "...",
     chain_path: "...",
     event: "...",
     source_chain: "...",
     condition: "...",
     pass_data: true/false
   }]
   ```

2. process new events
   -------------------
   for each .event file in EVENTS_DIR/:
   - parse event fields (event, source, data, processed)
   - skip if processed == true
   - skip if already handled (check watcher state dir)
   - match against all triggers
   - fire matching triggers

3. cleanup handled state
   ----------------------
   every 60 iterations:
   - delete handled state files older than 24h

4. sleep INTERVAL

event file format
=================

events are simple text files (key: value format):

  event: agent-complete
  source: researcher
  timestamp: 2026-03-12T10:00:00-07:00
  data: {"output": "/path/to/report.md"}
  processed: false

fields:
  event      event name (matched against trigger.event)
  source     which agent/chain emitted it
  data       optional JSON data
  processed  set to true after handling (idempotency)

match_trigger logic
===================

1. check event name matches
   ------------------------
   trigger.event == event_file.event
   case-sensitive match required

2. check source_chain filter
   --------------------------
   if trigger.source_chain set:
   trigger.source_chain == event_file.source
   optional filter to only match events from specific chain

3. evaluate condition (optional)
   ------------------------------
   if trigger.condition set:
   eval "[[ ${condition} ]]" with event data in scope
   example conditions:
   - '$data == "success"'
   - '$data | grep -q "production"'

4. return 0 (match) or 1 (no match)

process_event flow
==================

for each matching trigger:

1. verify chain exists
   --------------------
   check trigger.chain_path exists

2. spawn the chain
   ---------------
   nohup bash chain-runner.sh {chain_path} > watcher.log 2>&1 &
   disown (detach from parent, survives watcher restart)

3. pass event data (if pass_data == true)
   ---------------------------------------
   set env vars for chain:
   - CHAIN_INPUT={event_data}
   - CHAIN_TRIGGER_EVENT={event_name}
   - CHAIN_TRIGGER_SOURCE={event_source}

   chain can use these in prompts via {CHAIN_INPUT} placeholder.

4. record as handled
   ------------------
   create WATCHER_STATE_DIR/handled/{event_filename}
   prevents double-firing on same event

example workflow
================

1. chain "deploy" finishes, agent emits:
   EVENTS_DIR/20260312-100000-agent-complete.event:
     event: agent-complete
     source: deploy
     data: {"status": "success", "environment": "production"}

2. chain-event-watcher detects event, matches against triggers

3. chain "notify-slack" has trigger:
   {
     "event": "agent-complete",
     "source_chain": "deploy",
     "condition": "",
     "pass_data": true
   }

4. chain-event-watcher launches notify-slack chain with:
   CHAIN_INPUT='{"status":"success","environment":"production"}'
   CHAIN_TRIGGER_EVENT='agent-complete'
   CHAIN_TRIGGER_SOURCE='deploy'

5. notify-slack agent reads CHAIN_INPUT, sends slack message

integration with chain-runner
==============================

chain-runner.sh starts chain-watcher automatically:

  ensure-chain-watcher() {
      if transport_has_session "mentiko-chain-watcher"; then
          return 0  # already running
      fi
      # kill dead session before respawning
      transport_kill_session "mentiko-chain-watcher" 2>/dev/null || true
      transport_new_session "mentiko-chain-watcher" \
          bash "$SCRIPT_DIR/chain-event-watcher.sh" \
          --namespace "${NAMESPACE_ID:-default}" || true
  }

this is called in chain-runner.sh phase 0 (initialization).

agent emits event via chain-runner-complete.sh:

1. agent completes, writes event file:
   echo "event: {emits}" > EVENTS_DIR/{session}-{emits}.event
   echo "source: {session_prefix}" >> EVENTS_DIR/{session}-{emits}.event
   echo "timestamp: $(date -Iseconds)" >> EVENTS_DIR/{session}-{emits}.event
   echo "processed: false" >> EVENTS_DIR/{session}-{emits}.event

2. chain-event-watcher detects event on next poll

3. chain-event-watcher matches triggers, launches next chain

related files
=============

lib/chain-event-watcher.sh     this file
lib/chain-runner.sh            starts watcher, emits events
lib/chain-runner-complete.sh   completion handler (emits events)
lib/config.sh                  path resolution
lib/session-transport.sh       PTY abstraction

state directory
===============

RUNTIME_DIR/chain-watcher/
  watcher.log                    watcher output
  handled/{event-filename}       state files for processed events
  runs/{chain-name}-{timestamp}.log  individual chain run logs

common triggers
===============

agent lifecycle:
  - agent-complete    agent finished successfully
  - agent-failed      agent failed
  - agent-timeout     agent timed out

chain lifecycle:
  - chain-started     chain started
  - chain-complete    all agents finished
  - chain-failed      chain failed

system events:
  - run-stalled       watchdog detected stalled run
  - deployment-*      custom deployment events
  - alert-*           custom alert events

troubleshooting
===============

chain not triggering on event?
  - check chain.json event_triggers config matches event name
  - check event file processed != false
  - check watcher state dir (already handled?)
  - check watcher.log for errors

event not being written?
  - check EVENTS_DIR/ exists
  - check chain-runner-complete.sh is being called
  - check agent emitted event (grep EVENTS_DIR/)

watcher not running?
  - check: transport_has_session "mentiko-chain-watcher"
  - start: manually run chain-event-watcher.sh

chain started but failing?
  - check watcher runs/{chain-name}-*.log for output
  - check chain.json is valid (jq empty chain.json)
  - check chain.json agents have triggers matching event
