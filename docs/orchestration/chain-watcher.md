# TypeScript chain watcher - event-triggered chain launch

The active chain watcher is
`web/lib/runner-v2/chain-watcher-service.ts`. The TypeScript background worker
starts it once, reports its status, and stops it during worker shutdown. It is
not a PTY session and chain startup does not launch it.

See also:

- [watchdog.md](./watchdog.md) - stalled run recovery
- [event-trigger.md](./event-trigger.md) - typed runner event lifecycle
- [../RUNNER_V2_ARCHITECTURE.md](../RUNNER_V2_ARCHITECTURE.md) - current runner ownership
- [contracts/watcher-watchdog.contract.json](./contracts/watcher-watchdog.contract.json) - binding contract

## Process ownership

The process manager starts one background worker:

- development: `npx tsx server/background-worker.ts` from `web/processes.dev.json`
- production: `node server/background-worker.js` from `web/processes.json`

`startChainWatcherService()` starts the watcher during worker boot.
`getChainWatcherServiceStatus()` feeds the worker status file, and
`stopChainWatcherService()` aborts the filesystem wait and is awaited during
shutdown. An unexpected watcher failure requests a non-zero worker shutdown;
process-manager then restarts the worker and all of its background services.

`lib/chain-event-watcher.sh` remains only as a migration parity reference. No
active launch surface starts it and there is no shell fallback.

## Scope and singleton contract

The default service resolves exactly one configured scope:

- events: `config.eventsDir`
- chains: `config.chainsDir`
- state: `<config.projectRoot>/runtime/chain-watcher`

Another namespace or organization requires explicit paths. The service uses an
in-process singleton guard plus a per-namespace/org directory lock containing
the live worker PID. A live holder blocks a duplicate; a dead holder can be
reclaimed. Shutdown releases the lock.

## Event loop

The watcher:

1. Loads enabled `config.event_triggers[]` from valid chain definitions.
2. Strictly parses `.event` files from the configured event root.
3. Ignores malformed and already-processed events without poisoning them.
4. Matches event name, optional source, and optional condition.
5. Starts each matched chain once.
6. Persists per-event, per-trigger handled state atomically.
7. Waits on the filesystem and uses a 10-second timeout as the poll path.

Triggers reload every six iterations. Handled-state cleanup runs every 60
iterations with a 24-hour TTL, but a marker is retained while its unprocessed
event still exists.

The watcher never rewrites the event's `processed` field. Its own idempotency is
the JSON marker under `runtime/chain-watcher/handled/`. If one of several
matching launches fails, successful trigger keys remain durable and the next
pass retries only the failed sibling.

## Trigger contract

Chains define triggers under `config.event_triggers`:

```json
{
  "event": "deployment-complete",
  "source_chain": "deploy",
  "condition": "$data == \"success\"",
  "pass_data": true,
  "enabled": true
}
```

- `event` is required and case-sensitive.
- `source_chain` optionally matches the event source.
- `condition` uses a narrow comparison grammar.
- `pass_data` controls whether event data becomes `CHAIN_INPUT`.
- `enabled: false` excludes the trigger.

Condition evaluation is fail-closed. It supports simple string, glob, regex,
numeric, and `-n`/`-z` comparisons. Command substitution, backticks, shell
control metacharacters, bracket breakout, process substitution, newlines,
unsafe regex forms, and malformed expressions do not match.

## Launch contract

A matched trigger starts a detached child:

```text
bin/mentiko run <chain-path>
```

The TypeScript launcher writes output under
`runtime/chain-watcher/runs/`, strips inherited `BASH_FUNC_*` entries, and sets:

- `NAMESPACE_ID`
- `ORG_ID`
- `CHAIN_TRIGGER_EVENT`
- `CHAIN_TRIGGER_SOURCE`
- `CHAIN_INPUT` only when `pass_data` is true
- `MENTIKO_RUNNER_V2=1`
- `MENTIKO_RUNNER_V2_COMPLETION=1`

## Status and troubleshooting

The worker publishes chain-watcher state in the configured
`state/background-worker.json` file:

- `chainWatcher.status`
- `chainWatcher.startedAt`
- `chainWatcher.lastCheck`
- `chainWatcher.checkCount`
- `chainWatcher.lastError`

If events stop launching chains, inspect that status, validate the raw event,
confirm the configured events/chains roots, and inspect the handled marker for
that filename. Do not start a second watcher manually; a duplicate should lose
the singleton lock.

Focused coverage lives in:

- `web/lib/runner-v2/chain-watcher-service.test.ts`
- `web/lib/runner-v2/watcher-watchdog-cutover.binding.test.ts`
