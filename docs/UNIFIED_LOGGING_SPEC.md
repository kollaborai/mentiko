# unified logging spec

all orchestration scripts and API routes must log lifecycle events
to the system logger (system.jsonl) so they show up in /settings/logs.

## current state

we added `_sys_log` (bash) and `writeLog` (ts) to some stop/cancel
paths and phase breadcrumbs in chain-runner-complete.sh. the ERR trap
in chain-runner-complete.sh caught a crash at line 583 that had been
silently killing chain handoffs for days.

what's covered now:
  chain-runner-complete.sh  phase breadcrumbs (2b,3,4,5,5a,5b,6) + ERR trap
  chain-runner.sh           stop paths (budget, circuit breaker, approval)
  watchdog.sh               stall detection, orphan session kills
  run-reconciler.ts         orphaned run cleanup, grace period skips
  /api/runs/[id]/stop       user stop
  /api/runs/[id] DELETE     user cancel
  /api/system/stop-all      emergency stop
  /api/tasks/reconcile      task status reconciliation

what's NOT covered:
  chain-runner.sh           no ERR trap, no phase breadcrumbs, no agent launch/complete logs
  watchdog.sh               no ERR trap
  chain-runner.mjs          no logging at all (node version of chain-runner)
  launch-agent.sh           no logging (agent spawn)
  agent-activity-capture.sh no logging (artifact capture)
  session-log-resolver.sh   no logging (conversation file resolution)
  scheduler.sh              no logging (schedule checks)
  event-trigger.sh          no logging (event file creation)
  chain-event-watcher.sh    no logging (event-driven chain triggers)
  peer-manager (bin)        no logging (link/peer orchestration)
  job-runner.mjs            no logging (background job execution)

## goal

every script that touches run/agent lifecycle should log to system.jsonl.
when something breaks, /settings/logs should tell the full story without
needing to ssh in and grep through terminal output.

## requirements

### 1. ERR traps in all bash scripts

add to the top of every orchestration script (after sourcing run-lib.sh):

```bash
trap '_sys_log "error" "<script-name>" "CRASHED at line $LINENO (exit $?)" \
    "run: ${RUN_ID:-unknown}, agent: ${CURRENT_AGENT_ID:-unknown}"' ERR
```

scripts that need this:
  lib/chain-runner.sh
  lib/watchdog.sh
  lib/launch-agent.sh
  lib/agent-activity-capture.sh
  lib/chain-event-watcher.sh
  lib/scheduler.sh

chain-runner-complete.sh already has it.

### 2. phase breadcrumbs in chain-runner.sh

chain-runner.sh is the main orchestrator. add _sys_log at:
  - run creation (run ID, chain name, workspace)
  - each agent launch (agent id, session name)
  - agent monitor start
  - run completion (final status, agent count, duration)
  - error paths (already partially done)

level: "info" for normal flow, "warn" for stops, "error" for crashes

### 3. launch-agent.sh logging

log when:
  - agent PTY session created (session name, agent id, cli binary)
  - agent profile resolved (profile id, cli, model)
  - agent prompt injected
  - session creation failed

### 4. agent-activity-capture.sh logging

log when:
  - git diff captured (line count, before SHA)
  - conversation files found (count, paths)
  - capture failed (which step, error)

### 5. chain-runner.mjs logging — RETIRED, do not implement

chain-runner.mjs has been retired (moved to .trash). Production chains run
exclusively through bash lib/chain-runner.sh — every entry point (web /api/chains/run,
MCP, scheduler, webhooks, resume) spawns it via `mentiko run`. There is no node chain
runner to add logging to. Logging work belongs in chain-runner.sh (section 1).

### 6. event system logging

event-trigger.sh and chain-event-watcher.sh:
  - event file written (event name, source agent)
  - event processed (which chain/agent triggered)
  - event ignored (already processed, no matching trigger)

### 7. peer-manager logging

bin/peer-manager:
  - link run started (link id, agent pair)
  - relay message forwarded (direction, message length)
  - escalation triggered (reason)
  - link run completed/failed
  - session killed (which agent, why)

### 8. job-runner.mjs logging

  - job started (job id, type, template)
  - job completed (duration, output size)
  - job failed (error message)

### 9. scheduler logging

scheduler.sh and scheduler-service.ts:
  - schedule fired (schedule name, chain id, cron expression)
  - schedule skipped (snoozed, disabled)
  - chain launch failed (error)
  - next run calculated

## log format

all logs use the existing system-logger.ts format:

```json
{
  "ts": "2026-04-03T03:25:47.719Z",
  "level": "info|warn|error",
  "source": "chain-runner|watchdog|reconciler|launch-agent|...",
  "message": "short human-readable summary",
  "detail": "optional longer context (agent ids, session names, etc)"
}
```

### source naming convention

use the script/module name without extension:
  chain-runner, chain-runner-complete, launch-agent, watchdog,
  reconciler, task-reconciler, scheduler, event-trigger,
  chain-watcher, peer-manager, job-runner, activity-capture,
  stop-api, stop-all, run-api

### level guidelines

  info   normal lifecycle (agent launched, run created, event processed)
  warn   something stopped/cancelled/skipped (run stopped, orphan killed, grace period)
  error  crash, unhandled failure, data corruption

## implementation

### bash scripts

all bash scripts source run-lib.sh which defines `_sys_log()`.
it POSTs to /api/system/logs in the background (non-blocking).

```bash
_sys_log "info" "chain-runner" "agent launched: $agent_id" "session: $session_name"
```

### typescript

import writeLog from system-logger.ts:

```typescript
import { writeLog } from "@/lib/system-logger";
writeLog(config.namespaceId, config.orgId || "default", "info", "reconciler", "message", "detail");
```

### node scripts (mjs/cjs)

scripts that don't run inside next.js (chain-runner.mjs, job-runner.mjs)
should POST to /api/system/logs like the bash scripts do, using fetch
or curl. they can't import writeLog directly.

## UI

/settings/logs already displays system.jsonl with level and source filters.
no UI changes needed. the existing page will show all new log entries
automatically.

## testing

after implementation, run a chain and verify /settings/logs shows:
  - run created
  - agent 1 launched
  - agent 1 phase breadcrumbs (if chain-runner-complete)
  - agent 1 completed
  - agent 2 launched
  - agent 2 completed
  - run completed

kill a run mid-flight and verify the stop source is logged.
crash a script (e.g. bad jq) and verify the ERR trap fires.

## files to modify

  lib/chain-runner.sh              ERR trap + phase breadcrumbs
  lib/watchdog.sh                  ERR trap
  lib/launch-agent.sh              agent spawn logging
  lib/agent-activity-capture.sh    artifact capture logging
  lib/chain-event-watcher.sh       event processing logging
  lib/scheduler.sh                 schedule fire logging
  lib/event-trigger.sh             event write logging
  lib/chain-runner.mjs             full lifecycle logging (node version)
  lib/job-runner.mjs               job lifecycle logging
  bin/peer-manager                 link run lifecycle logging
  web/lib/scheduler-service.ts     schedule fire logging (ts version)
