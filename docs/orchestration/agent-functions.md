# agent-functions.sh - PTY command boundary

`lib/agent-functions.sh` is a sourced shell boundary for direct PTY operations only.
It does not own monitor state, completion detection, lifecycle mutation, event parsing,
or diagnostic emission.

## exported boundaries

- `new_pty_session <session_name>` forwards a session creation request to the PTY transport.
- `send-message <session_name> <message>` sends text and Enter to an existing PTY, then captures its tail.
- `peek-session <session_name> [tail_lines]` captures a PTY session.
- `new-agent-session <session_name> <agent_name> <task_description>` creates a PTY and starts the configured external agent CLI.
- `new-agent-from-spec <spec_file> [--monitor]` is a legacy standalone-spec launcher. When monitoring is requested, it starts compiled `lib/runner-v2-standalone-monitor.js` directly.
- `mentiko-monitor <session_name> "end state" [profile] [interval]` forwards primitive arguments to compiled `lib/runner-manual-monitor.js`.

## monitor ownership

Chain execution starts the compiled TypeScript monitor directly: `lib/chain-runner.sh` creates the monitor PTY with `node ${MENTIKO_CODE_ROOT}/lib/monitor-v2.js`. The owner is `web/lib/runner-v2/monitor.ts` with its live I/O adapter in `web/lib/runner-v2/monitor-live-io.ts`.

Standalone specs use `web/lib/runner-v2/standalone-monitor-cli.ts`; the manual command uses `web/lib/runner-v2/manual-monitor-cli.ts`. These typed owners validate inputs, persist monitor state, classify stale/dead sessions, write diagnostics, and launch typed completion. Missing typed runtime or a typed failure fails closed; there is no shell monitor or completion fallback.

## related files

- `lib/session-transport.sh` — external PTY CLI transport boundary
- `lib/chain-runner.sh` — routed launch and direct typed monitor PTY creation
- `web/lib/runner-v2/monitor.ts` — monitor decision loop
- `web/lib/runner-v2/monitor-live-io.ts` — monitor persisted state and lifecycle effects
- `web/lib/runner-v2/completion-launch.ts` — typed completion PTY handoff
