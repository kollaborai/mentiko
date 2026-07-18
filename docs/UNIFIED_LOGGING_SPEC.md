# unified logging spec

This spec began as a shell-era incident note. The shell completion handler it
mentions was subsequently deleted; current completion logging belongs in
`web/lib/runner-v2/completion-entrypoint.ts` and its typed adapters.

all orchestration scripts and API routes must log lifecycle events
to the system logger (system.jsonl) so they show up in /settings/logs.

## current state

we added `_sys_log` (bash) and `writeLog` (ts) to some stop/cancel paths. A
pre-cutover shell completion ERR trap historically exposed a crash that had
been silently killing chain handoffs.

what's covered now:
  completion-entrypoint.ts  typed completion and adapter diagnostics
  chain-runner.sh           ERR trap (reports src_file:src_line), run created,
                            agent launched, monitor started, stop paths
                            (circuit breaker, approval)
  run-reconciler.ts         orphaned run cleanup, grace period skips
  launch-agent.sh           ERR trap, session created, prompt injected
  runner-v2/job-worker.ts   job started/completed/failed (via POST /api/system/logs)
  /api/runs/[id]/stop       user stop
  /api/runs/[id] DELETE     user cancel
  /api/system/stop-all      emergency stop
  /api/tasks/reconcile      task status reconciliation

what's NOT covered:
  runner-v2/watchdog.ts     no system.jsonl lifecycle logging
  chain-watcher-service.ts  no system.jsonl lifecycle logging
  agent-activity-capture.sh no logging (artifact capture)
  session-log-resolver.sh   no logging (conversation file resolution)
  scheduler.sh              no logging — but it is only a compatibility surface;
                            the typed background worker owns the scheduler loop
  event-emitter.ts          no system.jsonl logging (event file creation)
  event-lifecycle.ts        no system.jsonl logging (lookup/consume/archive)
  peer-manager (bin)        no logging (link/peer orchestration)

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
  lib/chain-runner.sh              DONE — reports src_file:src_line, not $LINENO
  lib/launch-agent.sh              DONE
  lib/agent-activity-capture.sh    still missing
  lib/scheduler.sh                 not needed — compatibility surface only

the typed completion owner must use structured TypeScript logging instead.

Note: a bare `$LINENO` in an ERR trap reports the trap's own line, not the
failing one. chain-runner.sh resolves the real source file and line; copy that
pattern rather than the snippet above.

### 2. phase breadcrumbs in chain-runner.sh

chain-runner.sh is the main orchestrator. _sys_log coverage:
  - run creation (run ID, chain name, workspace)     DONE
  - each agent launch (agent id, session name)       DONE
  - agent monitor start                              DONE
  - error paths                                      DONE (ERR trap + stop paths)
  - run completion (final status, agent count, duration)  MISSING

level: "info" for normal flow, "warn" for stops, "error" for crashes

### 3. launch-agent.sh logging

log when:
  - agent PTY session created (session name, agent id, cli binary)  DONE
  - agent prompt injected                                           DONE
  - agent profile resolved (profile id, cli, model)                 MISSING
  - session creation failed                                         MISSING

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

web/lib/runner-v2/event-emitter.ts,
web/lib/runner-v2/event-lifecycle.ts,
web/lib/runner-v2/chain-watcher-service.ts, and web/server/background-worker.ts:
  - event file written (event name, source agent)
  - completion event consumed (run, source, trigger, archived count)
  - invalid lifecycle file rejected (path, strict issue codes)
  - trigger handled (which chain launched)
  - event ignored (handled marker exists, no matching trigger, or strict parse failed)

The background worker is the only watcher/watchdog lifecycle owner. Logging
work must not introduce a shell lifecycle path.

### 7. peer-manager logging

bin/peer-manager:
  - link run started (link id, agent pair)
  - relay message forwarded (direction, message length)
  - escalation triggered (reason)
  - link run completed/failed
  - session killed (which agent, why)

### 8. job worker logging — DONE

Implemented in `web/lib/runner-v2/job-worker.ts` (bundled as
`lib/runner-job-worker.js`), which posts to `/api/system/logs`:

  - job started (job id, type, template)
  - job completed (duration, output size)
  - job failed (error message)

### 9. scheduler logging

`web/lib/schedules/scheduler-service.ts` only — the typed background worker owns
the scheduler loop. `lib/scheduler.sh` is a compatibility surface that forwards
to `runner-schedule-contract.js`; do not add a shell scheduler logging path.

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
  chain-runner, runner-v2-completion, launch-agent, watchdog,
  reconciler, task-reconciler, scheduler, event-emitter, event-lifecycle,
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
import { writeLog } from "@/lib/system/system-logger";
writeLog(config.namespaceId, config.orgId || "default", "info", "reconciler", "message", "detail");
```

### detached processes and compiled bundles

Processes that start outside the Next.js module graph have two options, and the
repo uses both:

  - POST to /api/system/logs. `web/lib/runner-v2/job-worker.ts` does this with a
    fire-and-forget fetch, so a logging outage cannot stall a job.
  - Invoke the compiled `lib/runner-system-log.js` bundle, built from
    `web/lib/system/system-log-cli.ts`. `lib/run-lib.sh` uses this path.

Prefer the bundle for shell boundaries and the HTTP post where a blocking write
would be harmful. Do not add a third mechanism.

## UI

/settings/logs already displays system.jsonl with level and source filters.
no UI changes needed. the existing page will show all new log entries
automatically.

## testing

after implementation, run a chain and verify /settings/logs shows:
  - run created
  - agent 1 launched
  - agent 1 typed completion breadcrumbs
  - agent 1 completed
  - agent 2 launched
  - agent 2 completed
  - run completed

kill a run mid-flight and verify the stop source is logged.
crash a script (e.g. bad jq) and verify the ERR trap fires.

## files to modify

  lib/agent-activity-capture.sh    artifact capture logging
  web/lib/runner-v2/event-emitter.ts event write logging
  web/lib/runner-v2/event-lifecycle.ts event consume/archive logging
  web/lib/runner-v2/watchdog.ts    typed stalled-run lifecycle logging
  web/lib/runner-v2/chain-watcher-service.ts typed event processing logging
  web/server/background-worker.ts typed service lifecycle logging
  bin/peer-manager                 link run lifecycle logging
  web/lib/schedules/scheduler-service.ts schedule fire logging (the typed
                                   worker owns the scheduler loop; scheduler.sh
                                   is a compatibility surface and needs none)

done: lib/chain-runner.sh (ERR trap + breadcrumbs), lib/launch-agent.sh (agent
spawn), web/lib/runner-v2/job-worker.ts (job lifecycle).
