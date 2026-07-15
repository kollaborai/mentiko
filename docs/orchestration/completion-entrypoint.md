# typed completion entrypoint

The completion owner is `web/lib/runner-v2/completion-entrypoint.ts`. The
compiled production entrypoint is `lib/runner-v2-complete.js`; development uses
`web/scripts/runner-v2-complete.cjs`.

The previous shell completion handler has been deleted. There is no shell
fallback when typed completion cannot start or cannot validate its context.

## launch boundary

Both the shell monitor boundary and `monitor-live-io.ts` call
`web/lib/runner-v2/completion-launch.ts`. That launcher:

1. copies only allowlisted completion context into an OS-temp directory with
   mode `0700` and a one-shot `context.json` with mode `0600`;
2. starts a separate `complete-*` PTY with only the random context path in argv;
3. requires the child to validate and merge the payload, then delete the file
   as its acceptance receipt;
4. removes the completion PTY and fails closed if acceptance is missing.

The child consumes the context before loading config or the completion module,
so code roots, run roots, event roots, namespace, org, and gateway credentials
are never inferred from the completion PTY's working directory.

## completion order

The durable order is:

1. resolve the exact run, agent, attempt, configured event root, and declared
   event;
2. capture completion evidence and reduce it to one typed verdict;
3. apply locked local state and queue idempotent external effects;
4. synchronously launch routed or fan-out targets and prove their run agent,
   session, and `AgentAttempt` state;
5. commit fan-in claims only after the target is accepted;
6. consume the explicit trigger and archive owned events only after effects and
   route targets are accepted;
7. remove the completed agent and monitor sessions, or persist retryable cleanup
   evidence.

This order is deliberate: a rejected or unproven downstream launch leaves the
parent event unprocessed so replay can safely retry it.

## event rules

`web/lib/runner-v2/event-lifecycle.ts` is the only completion event lifecycle
owner. Completion accepts one direct canonical `.event` file under the explicit
`EVENTS_DIR` with:

- exact nonempty `run_id`;
- exact declared `event`;
- guarded agent or session ownership;
- `processed: false`;
- one canonical copy of every required field.

Missing, ambiguous, malformed, diagnostic, runless, wrong-run, or sibling-owned
events do not satisfy a successful handoff. Completion never fabricates the
declared event. Compatible core-generation artifacts are the sole typed no-emit
completion exception.

## retry and loop storage

- retry attempts are `{runDir}/state/retry/retry_{runId}_{agentId}.json` and are
  read and written by `web/lib/runner-v2/adapters.ts`;
- unscoped `retry_{agentId}.count` files are rejected as ambiguous;
- `chain-loop-state.json` is authoritative; the typed loop-state module may
  mirror the line-oriented predecessor tracker while pre-cutover runs remain.

The enforceable contract is
[`completion-entrypoint.contract.json`](./contracts/completion-entrypoint.contract.json).
