# watchdog.sh - stalled run detection

background daemon that catches stalled runs and updates their status.

see also:
  - [chain-runner-flow.md](./chain-runner-flow.md) - main orchestration
  - [chain-watcher.md](./chain-watcher.md) - event-driven chain triggers

overview
========

watchdog runs continuously (every 60s by default), checking all "running"
runs against live PTY sessions. when it detects a stalled run, it:

1. updates run.json status to "stopped"
2. emits a "run-stalled" event to EVENTS_DIR/
3. fires hooks (notifications, alerts)
4. optionally triggers a self-heal chain

usage
=====

  watchdog.sh              start the daemon (runs in foreground)
  watchdog.sh status       check if running
  watchdog.sh stop         stop the daemon

env vars:
  WATCHDOG_INTERVAL=60         check interval in seconds
  WATCHDOG_AUTO_HEAL=false     auto-trigger self-heal chain on stall
  WATCHDOG_CLEANUP_INTERVAL=300 orphan cleanup interval (5 min default)

startup
=======

1. source config.sh for paths (RUNS_DIR, EVENTS_DIR, CHAIN_DIR)
2. source session-transport.sh for PTY commands
3. handle subcommands: status, stop
4. load run-lib.sh for run tracking functions
5. ensure EVENTS_DIR exists
6. check if pty-manager is responsive (restart if needed)
7. enter main loop

main loop
=========

every iteration (every WATCHDOG_INTERVAL seconds):

1. check pty-manager is running
2. list all live PTY sessions
3. for each run in RUNS_DIR/run-*/:
   - check if stalled (see check_run below)
4. every CLEANUP_INTERVAL seconds:
   - cleanup orphaned sessions (see cleanup_orphaned_sessions below)
5. call task reconcile API (catches deleted runs, missed updates)
6. sleep INTERVAL

check_run logic
===============

called for each run directory:

1. read run.json
   --------------
   skip if status != "running"
   extract agents[] array

2. check each agent
   ----------------
   for each agent in agents[]:
   - if status == "running" and session exists in PTY:
     -> any_alive = true
   - if status == "running" and monitor session exists:
     -> any_alive = true (monitor still working, agent session may be dead)
   - if status == "running" but session not found:
     -> apply age-based grace period:
       - run started < 5 min ago: give monitor time to start
       - run started < 10 sec ago: give session time to register
     -> if grace period expired: stall detected
   - if status == "pending":
     -> any_pending = true
     -> track pending agent IDs

3. stall detection
   ----------------
   if any_alive == false and (any_running == true or any_pending == true):
   -> RUN IS STALLED

4. handle stalled run
   -------------------
   update run.json:
   - status = "stopped"
   - completed = now
   - agents with status=running -> status="stopped"
   - agents with status=pending -> status="cancelled"

   emit event to EVENTS_DIR/{timestamp}-run-stalled.event:
   ```
   event: run-stalled
   source: watchdog
   timestamp: {ISO}
   run_id: {runId}
   last_agent: {last_non_pending_agent_id}
   last_agent_status: {status}
   pending_agents: {comma_separated_list}
   processed: false
   ```

   fire hooks (run_hooks from hooks.sh):
   - notification hooks (slack, email)
   - alert hooks (pagerduty, etc)
   - custom scripts

   update linked task (if taskId in run.json):
   - update task metadata via task store API: {"last_run_status":"stopped",...}

   if AUTO_HEAL == true and self-heal chain exists:
   - launch self-heal chain in background

orphan session cleanup
======================

every CLEANUP_INTERVAL seconds (5 min default):

1. collect active run sessions
   ---------------------------
   scan all run-{timestamp}/run.json files with status="running"
   extract all session names from agents[].session

2. collect live PTY sessions
   --------------------------
   call transport_list_sessions to get all active sessions

3. kill orphans
   -------------
   for each live session:
   - skip mentiko-watchdog (don't kill self)
   - skip mentiko-chain-watcher (don't kill event watcher)
   - skip monitor-* (monitors are companion processes)
   - if session not in active run sessions list:
     -> transport_kill_session (orphan cleanup)

grace periods
=============

watchdog uses age-based grace periods to avoid false positives:

  < 10 sec old:   session may still be starting (not registered in PTY yet)
  < 5 min old:    monitor may still be initializing
  >= 5 min old:   if no live session, definitely stalled

this prevents watchdog from killing runs that are just starting up.

session types
============

watchdog tracks different session types:

  agent-*        primary agent session (tracked in run.json agents[].session)
  monitor-*      companion monitor session (not in run.json, but keep alive)
  mentiko-watchdog    watchdog itself (skip in orphan cleanup)
  mentiko-chain-watcher  event watcher (skip in orphan cleanup)

monitor sessions are kept alive because they handle:
  - watching for AGENT_COMPLETE
  - timeout detection
  - stall detection
  - calling chain-runner-complete.sh

when monitor dies but agent is still running, watchdog will
eventually mark the run as stalled (monitor grace period).

integration with chain-runner
==============================

chain-runner.sh starts watchdog automatically:

  ensure-watchdog() {
      if transport_has_session "mentiko-watchdog"; then
          return 0  # already running
      fi
      # kill dead session before respawning
      transport_kill_session "mentiko-watchdog" 2>/dev/null || true
      transport_new_session "mentiko-watchdog" bash "$SCRIPT_DIR/watchdog.sh" || true
  }

this is called in chain-runner.sh phase 0 (initialization).

related files
=============

lib/watchdog.sh                 this file
lib/chain-runner.sh             starts watchdog
lib/chain-runner-complete.sh    completion handler
lib/session-transport.sh        PTY abstraction
lib/run-lib.sh                  run tracking
lib/hooks.sh                    hook system
lib/config.sh                   path resolution

events emitted
==============

run-stalled     emitted when a run is detected as stalled

event fields:
  event: run-stalled
  source: watchdog
  timestamp: ISO timestamp
  run_id: stalled run ID
  last_agent: last non-pending agent
  last_agent_status: status of that agent
  pending_agents: comma-separated list of pending agents
  processed: false

self-heal chain can use event_triggers to respond:

  {
    "config": {
      "event_triggers": [
        {
          "event": "run-stalled",
          "source_chain": "watchdog",
          "condition": "",
          "pass_data": true
        }
      ]
    }
  }

troubleshooting
===============

watchdog not running?
  - check: watchdog.sh status
  - start: manually run watchdog.sh (or let chain-runner start it)

runs marked stalled but still running?
  - grace period too short? increase WATCHDOG_INTERVAL
  - monitor died? check monitor-* sessions
  - session naming mismatch? check run.json agents[].session matches PTY

orphan sessions accumulating?
  - cleanup interval too long? decrease WATCHDOG_CLEANUP_INTERVAL
  - watchdog not running? start it
  - sessions not tracked in run.json? check chain-runner agent registration
