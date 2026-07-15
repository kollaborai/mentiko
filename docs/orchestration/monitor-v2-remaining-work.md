# Remaining Work — Runner-v2 / Monitor-v2 Migration & Open Threads

Honest, complete list of everything left. Written 2026-07-07 after porting the
monitor decision core to TypeScript. Nothing here is "done" until it is proven on
a live chain run.

Contracts: `docs/orchestration/contracts/monitor-v2.design.json` (design + plan),
`monitor-v2.contract.json` (enforceable owns/invariants, bound in the switch gate).

---

## Blunt status

The typed monitor's **brain and first live bridge are built, tested, and proven
on a live TASK-093-shaped run.** `buildMonitorCommand` and the shell routed-agent
monitor script select `monitor-v2` by default via `MENTIKO_MONITOR_V2`, with
explicit opt-out. Completion is now unconditionally typed and fail-closed:
missing context, exit 64, PTY spawn failure, or missing child acceptance has no
shell fallback. The remaining risk is monitor parity breadth, not completion ownership.

Committed this session:
- `477ca11` runner-v2 contract: false-failure invariants recorded
- `a2f1001` / `4f7e1bb` monitor-v2 migration contract (+ scope correction)
- `8ece8e4` monitor decision core (reducer + driver + diagnostics)
- `1a0d4d5` review revisions (latch-before-death fix, binding wired, command contract)
- `3cbd4c3` adapter verifiable core (state persistence, event scan, latch composition)

---

## CRITICAL PATH — monitor-v2 migration (the TASK-093 fix)

### Done (committed, unit-tested)
- [x] Contract: `monitor-v2.design.json` + enforceable `monitor-v2.contract.json`, bound in `runner-v2-contract.json` implementation_coverage, enforced by `switch-readiness.binding.test.ts`.
- [x] Reducer `classifyMonitorTick` (`web/lib/runner-v2/monitor-reducer.ts`) — full state machine: session-gone → latch (wins over death) → process-death → active/stale, durable nudge budget, echo grace.
- [x] Driver `runChainMonitor` (`web/lib/runner-v2/monitor.ts`) — poll loop over injected I/O.
- [x] Diagnostics (`web/lib/runner-v2/monitor-diagnostics.ts`) — event-first death, BLOCKED stall, `source: monitor` never the agent id.
- [x] Adapter verifiable core (`web/lib/runner-v2/monitor-io.ts`) — durable state persistence (restart-safe), completion-event scan (run/agent/processed/diagnostic filtering), latch composition, md5 capture hash.

### Remaining — the live-system layer (code is buildable; proof needs a live run)
- [x] **1. PTY capture + hash wrapper** — `monitor-live-io.ts` uses `pty.capture(session, 20)` + `captureHash`.
- [x] **2. Process-gone signal** — `monitor-live-io.ts` ports pane pid + `pgrep -P`, arming, never-armed grace, and 1s debounce.
- [x] **3. Durable-transcript AGENT_COMPLETE marker (BUG-022)** — `monitor-live-io.ts` resolves transcript JSONL by UUID and only latches standalone assistant `AGENT_COMPLETE`; unresolved transcript fails closed to event-file latch.
- [x] **4. Nudge send wrapper** — `monitor-live-io.ts` uses raw PTY send + CR.
- [x] **5. Completion handoff (`onComplete`)** — `monitor-live-io.ts` spawns a separate completion PTY; with `MENTIKO_RUNNER_V2_COMPLETION` enabled, typed completion is the only owner and exit-64/malformed context fails closed.
- [x] **6. Death/stall effects (`onDied`/`onStalled`)** — `monitor-live-io.ts` writes monitor diagnostic events and updates run+agent status via `run-state`.
- [x] **7. `monitor-v2` CLI entry** — `web/lib/runner-v2/monitor-cli.ts` mirrors `complete-cli.ts` and calls `runChainMonitor`.
- [x] **8. Wire monitor command selection** — typed bootstrap and shell routed-agent monitors carry `MENTIKO_MONITOR_V2`; Docker compiles `/context/lib/monitor-v2.js`.
- [x] **9. THE proof — live completion handoff behavior.** Proven with `MENTIKO_MONITOR_V2=1 node web/scripts/runner-v2-watched-proof.cjs /tmp/runner-v2-watched-monitor-v2-proof.json`, then re-proven after default-on with `env -u MENTIKO_MONITOR_V2 MENTIKO_RUNNER_V2=1 MENTIKO_RUNNER_V2_COMPLETION=1 node web/scripts/runner-v2-watched-proof.cjs /tmp/runner-v2-watched-monitor-v2-default-on-proof.json`: typed plan launched, event latch fired, completion PTY spawned, attempt reached `completed_from_event`, run completed. The legacy/stuck-run safety net is now connected: reconcile invokes `recoverLateCompletionEvents` before terminal retry/audit handling and relaunches downstream through the typed executor plan.

### Acceptance — the gate I cannot fake in text
- [x] **Live chain run**: a TASK-093-shaped live watched run completed through typed monitor-v2 and typed completion; proof files: `/tmp/runner-v2-watched-monitor-v2-proof.json` and `/tmp/runner-v2-watched-monitor-v2-default-on-proof.json`.
- [x] Live parity spot-checks: `MENTIKO_RUNNER_V2=1 MENTIKO_RUNNER_V2_COMPLETION=1 MENTIKO_MONITOR_V2=1 web/e2e/engine/engine-e2e-monitor.sh` passed 28/28: dead-without-event fails with monitor diagnostic, quiet-but-working completes without premature force, chatty/event-file latch completes after marker scroll, never-ready sessions receive no task/nudge, startup recovery completes, echo-stall escalates via durable nudge budget.
- [x] **Flip the flag**: `MENTIKO_MONITOR_V2` default on, with explicit opt-out (`0`/off).
- [ ] **Delete the shell**: `monitor-chain-agent` + its helpers in `agent-functions.sh` + `monitor-completion.sh`. (Standalone `mentiko-monitor.sh` is a separate concern — not deleted here.)
- [x] The last binding gap (`monitor-v2.contract.json` late-event recovery invariant) is red→covered: `recoverLateCompletionEvents` is wired through reconcile and route-level tests prove it runs before retry/audit handling.

### Reviewer's 10 required tests
- [x] monitor-v2 included in switch-readiness binding
- [x] processGone + latched → completes normally
- [x] alive + producing + no event → never invokes completion
- [x] remote workspace ignores local process death
- [x] wrong run id / wrong agent id completion event rejected (`monitor-io.test.ts`)
- [x] monitor restart preserves latch/nudge state (`monitor-io.test.ts`)
- [x] flag off emits shell `monitor-chain-agent`
- [x] flag on emits typed monitor command with exact env
- [x] rendered transcript instruction echo does NOT count as completion (`monitor-live-io.test.ts` durable assistant transcript latch)
- [x] late completion event recovers instead of a dead/stalled loop (`app/api/tasks/reconcile/route.test.ts` route-level integration; `completion-late-event.test.ts` recovery core)

---

## OTHER OPEN THREADS (from this session)

### TASK-093 — closed, minor cleanup left
- Closed manually (verified: `route.ts` 16.7k + tests 22k + doc 15.5k present; summary verdict `close`). DB backup in scratchpad.
- Stale metadata still on the row: `auto_run_paused_reason` referencing deleted `DEC-038`, `last_audit_verdict: decision`. Harmless on a closed task; clean if you want hygiene.

### Decision-gate visibility — TASK-117 shows 6 gates, should show 1
- Root: supersession is never marked on real data (`isHiddenDecisionGate` only hides explicitly-marked gates).
- Fix (2 parts): (a) helper hides any gate whose parent's `decision_subtask_id` ≠ it — live-pointer wins (`web/lib/tasks/task-visibility.ts`); (b) producer marks displaced gates superseded when a new one goes live (`web/lib/tasks/task-decision-link.ts`).
- **Ownership: Codex's in-flight files** — coordinate, don't clobber. Was routed to Codex.

### Task 0 (runner-v2 completion) — built, partly unwired
- LIVE: events-dir hardening (`completion-entrypoint.ts:75`), generalized artifact salvage (`completion-runner.ts:108`).
- BUILT-BUT-NOT-FED: liveness-aware exhaustion — no `liveness` input at the live call site, so `evaluateAgentLiveness(undefined)` → "dead", the await branch never fires. Monitor-v2 now gates completion invocation on genuine done, so this is cleanup, not a monitor-v2 default blocker.
- LIVE: `recoverLateCompletionEvents` is wired through reconcile for stale terminal auto-runs and relaunches downstream through typed executor plans.

### task-lifecycle-reducer plan — revised, implementation not started
- Plan + spec revised and committed (Task 0 + contract corrections C1–C8). Reducer core exists (`bb25e0b`).
- Retry-conflation fix landed (Codex, verified: `execution_retries` only, `EXECUTION_RETRY_LIMIT=2`).
- Open question you raised: execution-retry budget should source from the **chain** (`routing.default_retry.max_retries` / `agent.retry`), not a constant.

### Runner-v2 default switch — readiness re-run required
- The monitor-v2 handoff proof, broader monitor e2e parity, typed fan-group accounting, and late-event recovery hookup have landed. `assessRunnerV2SwitchReadiness()` reports `ready`, and `MENTIKO_MONITOR_V2` now defaults on. Shell monitor deletion remains separate and must wait until after the default-on bake.

### Shell completion fallback removal — done unconditionally
- Typed fan-group member accounting now exists: typed completion reads live fan-group membership, suppresses normal member routing, updates `.state`/`.json` fan groups under lock, and launches fan-in only from the claim winner.
- Live proof: `MENTIKO_RUNNER_V2=1 MENTIKO_RUNNER_V2_COMPLETION=1 MENTIKO_MONITOR_V2=1 web/e2e/engine/engine-e2e-events.sh` produced run `run-1783437332756-3693ab01`; the legacy shell-oriented script failed two stale assertions, but the typed artifact verifier passed against `state/fan-groups/dispatch-done-1783437361464.json` (`completed: 2`, members `worker_a`/`worker_b`, collector completed exactly once).
- Default-on proof: `env -u MENTIKO_MONITOR_V2 MENTIKO_RUNNER_V2=1 MENTIKO_RUNNER_V2_COMPLETION=1 web/e2e/engine/engine-e2e-events.sh` passed 24/24 and produced run `run-1783446649710-698fc703`; fan-group state `dispatch-done-1783446679178.json` completed both workers and launched the collector exactly once.
- Fallback-removal proof: `bash tests/bash/test-monitor-completion.sh` asserts no shell exec fallback after typed exit 64 and no shell nohup fallback after completion PTY spawn failure. Live watched proof passed at `/tmp/runner-v2-watched-no-shell-completion-fallback-proof.json`; live fan-out/fan-in proof passed 24/24 with run `run-1783450309286-43e92f47` and fan-group state `dispatch-done-1783450338921.json`.

---

## Shared-checkout hazard
`~/dev/platform/mentiko` is shared with Codex + worktrees. Stage explicitly, don't
switch branches, and coordinate on the Codex-owned files above (task-visibility,
task-decision-link, reconcile, completion-audit-apply).
