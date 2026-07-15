# TypeScript watchdog - stalled run recovery

The active watchdog is `web/lib/runner-v2/watchdog.ts`. It is owned by the
long-lived TypeScript background worker in `web/server/background-worker.ts`.
It is not a PTY session and chain startup does not launch it.

See also:

- [chain-watcher.md](./chain-watcher.md) - event-triggered chain launch
- [../RUNNER_V2_ARCHITECTURE.md](../RUNNER_V2_ARCHITECTURE.md) - current runner ownership
- [contracts/watcher-watchdog.contract.json](./contracts/watcher-watchdog.contract.json) - binding contract

## Process ownership

The process manager starts one background worker:

- development: `npx tsx server/background-worker.ts` from `web/processes.dev.json`
- production: `node server/background-worker.js` from `web/processes.json`

At worker startup, `runTypedWatchdogScan()` runs once after the startup delay.
The worker then runs it every 60 seconds with an in-flight guard so watchdog
passes cannot overlap. Shutdown clears the interval as part of worker shutdown.

## Scan contract

Each pass:

1. Resolves runs, events, state, hooks, namespace, and organization from the
   configured project scope.
2. Lists PTY sessions. If the transport cannot answer, the pass fails closed:
   it records the error and does not mutate runs.
3. Reads each scoped `run-*/run.json` and assesses only runs whose status is
   `running`.
4. Treats live agent, monitor, completion-handler, process, recent resume,
   recent completion, and live typed-handoff evidence as active work.
5. Re-lists PTYs and re-reads `run.json` under the shared lock immediately
   before any terminal mutation.
6. Terminalizes only a still-proven stall.
7. Recovers any durable stall side effects left incomplete by an earlier worker
   crash.
8. Reaps only dead sessions referenced exclusively by terminal scoped runs,
   after a fresh PTY list confirms the candidate is still not alive.

Unknown and non-terminal run statuses are never orphan-reap candidates.
Unreferenced sessions are also left alone because the watchdog cannot prove
that it owns them.

## Grace windows

The typed watchdog preserves bounded launch and handoff grace:

- recent resume: 2 minutes
- newly missing session: 10 seconds
- exited-session completion handoff: 5 minutes
- sessionless active agent: 2 minutes
- pending run: 2 minutes
- recent agent completion before downstream launch: 5 minutes

A live PTY remains authoritative regardless of age.

## Stall mutation and recovery

For a proven stall, `updateRunJson()` performs the read-modify-write under the
shared run lock. The watchdog:

- sets the run to `stopped` and records `completed`,
- changes active agents to `stopped` or `cancelled`,
- stores a durable `runnerV2.watchdog` marker,
- emits a strict `run-stalled` runner event with stall details in `data`,
- appends task-status and notification work to `state/external-effects.jsonl`
  with stable per-run effect IDs; recovery scans pending, claimed, and audited
  records before enqueueing, so the watchdog enqueues each effect once,
- dispatches executable watchdog hooks with a stable key in both
  `MENTIKO_WATCHDOG_DISPATCH_KEY` and `details.dispatch_key`,
- removes only run-owned sessions that a fresh PTY read still reports as dead,
  then verifies removal.

The marker records each completed side effect. Internal outbox enqueue is
deduped by stable operation ID across the pending outbox, claimed files, and
dispatch audit. The notification and task sinks also consume that ID
idempotently if a worker dies between local delivery and its audit write.
External hooks use at-least-once delivery: a zero exit writes a
durable completed record and prevents another launch, while a crash after the
hook performs work but before that acknowledgement can retry it. Hooks must use
the exposed dispatch key if their own side effects require deduplication.

## Status and troubleshooting

The worker publishes watchdog state in the configured
`state/background-worker.json` file:

- `watchdog.lastCheck`
- `watchdog.checkCount`
- `watchdog.lastStalled`
- `watchdog.transportAvailable`
- `watchdog.lastError`

If scans stop, inspect the background-worker process and status file. If
`transportAvailable` is false, repair the configured PTY transport; the
watchdog intentionally leaves runs unchanged until liveness can be observed.

Focused coverage lives in:

- `web/lib/runner-v2/watchdog.test.ts`
- `web/lib/runner-v2/watcher-watchdog-cutover.binding.test.ts`
