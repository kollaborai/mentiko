# agent-functions.sh - PTY command boundary

`lib/agent-functions.sh` is a sourced shell boundary for direct PTY operations only.
It does not own monitor state, completion detection, lifecycle mutation, event parsing,
or diagnostic emission.

## exported boundaries

- `new_pty_session <session_name>` forwards a session creation request to the PTY transport.
- `send-message <session_name> <message>` sends text and Enter to an existing PTY, then captures its tail.
- `peek-session <session_name> [tail_lines]` captures a PTY session.
- `new-agent-from-spec <spec_file> [--monitor]` forwards unchanged arguments to compiled `lib/runner-v2-standalone-agent-launch.js`. It does not parse the spec, derive session identity, create a PTY, mutate state, inject instructions, or start a monitor.
- `mentiko-monitor <session_name> "end state" [profile] [interval]` forwards primitive arguments to compiled `lib/runner-manual-monitor.js`.

There is deliberately no generic shell `new-agent-session` launcher. Typed launch
owners validate agent/profile input, create the PTY, inject instructions, publish
state, and start monitoring as one fail-closed operation. The three direct PTY
helpers above remain only because invoking the external PTY transport is itself
the product boundary.

## monitor ownership

Typed bootstrap and typed routed launch start the compiled TypeScript monitor directly. `lib/chain-runner.sh` does not create a monitor PTY; it only execs the typed direct-run CLI. The owner is `web/lib/runner-v2/monitor.ts` with its live I/O adapter in `web/lib/runner-v2/monitor-live-io.ts`.

Standalone specs use `web/lib/runner-v2/standalone-monitor-cli.ts`; the manual command uses `web/lib/runner-v2/manual-monitor-cli.ts`. These typed owners validate inputs, persist monitor state, classify stale/dead sessions, write diagnostics, and launch typed completion. Missing typed runtime or a typed failure fails closed; there is no shell monitor or completion fallback.

## related files

- `lib/session-transport.sh` — external PTY CLI transport boundary
- `web/lib/runner-v2/bootstrap-executor.ts` and `web/lib/runner-v2/launch-agent.ts` — typed initial/routed launch and monitor PTY creation
- `web/lib/runner-v2/monitor.ts` — monitor decision loop
- `web/lib/runner-v2/monitor-live-io.ts` — monitor persisted state and lifecycle effects
- `web/lib/runner-v2/completion-launch.ts` — typed completion PTY handoff
