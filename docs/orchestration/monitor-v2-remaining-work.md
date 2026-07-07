# Remaining Work — Runner-v2 / Monitor-v2 Migration & Open Threads

Honest, complete list of everything left. Written 2026-07-07 after porting the
monitor decision core to TypeScript. Nothing here is "done" until it is proven on
a live chain run.

Contracts: `docs/orchestration/contracts/monitor-v2-contract.json` (design + plan),
`monitor-v2.contract.json` (enforceable owns/invariants, bound in the switch gate).

---

## Blunt status

The typed monitor's **brain is built and tested; the body is half-built and wired
to nothing.** `buildMonitorCommand` still spawns the shell `monitor-chain-agent`.
**TASK-093's bug class is not fixed in any running code path.** The decision logic
+ the verifiable half of the I/O adapter are committed and green (47 tests). The
live-system half + the completion handoff + a live run remain.

Committed this session:
- `477ca11` runner-v2 contract: false-failure invariants recorded
- `a2f1001` / `4f7e1bb` monitor-v2 migration contract (+ scope correction)
- `8ece8e4` monitor decision core (reducer + driver + diagnostics)
- `1a0d4d5` review revisions (latch-before-death fix, binding wired, command contract)
- `3cbd4c3` adapter verifiable core (state persistence, event scan, latch composition)

---

## CRITICAL PATH — monitor-v2 migration (the TASK-093 fix)

### Done (committed, unit-tested)
- [x] Contract: `monitor-v2-contract.json` + enforceable `monitor-v2.contract.json`, bound in `runner-v2-contract.json` implementation_coverage, enforced by `switch-readiness.binding.test.ts`.
- [x] Reducer `classifyMonitorTick` (`web/lib/runner-v2/monitor-reducer.ts`) — full state machine: session-gone → latch (wins over death) → process-death → active/stale, durable nudge budget, echo grace.
- [x] Driver `runChainMonitor` (`web/lib/runner-v2/monitor.ts`) — poll loop over injected I/O.
- [x] Diagnostics (`web/lib/runner-v2/monitor-diagnostics.ts`) — event-first death, BLOCKED stall, `source: monitor` never the agent id.
- [x] Adapter verifiable core (`web/lib/runner-v2/monitor-io.ts`) — durable state persistence (restart-safe), completion-event scan (run/agent/processed/diagnostic filtering), latch composition, md5 capture hash.

### Remaining — the live-system layer (code is buildable; proof needs a live run)
- [ ] **1. PTY capture + hash wrapper** — thin, over `pty.capture(session, 20)` + `captureHash`. `web/lib/pty/pty-client.ts` already has `capture`/`sendKeys`.
- [ ] **2. Process-gone signal** — port `_monitor_agent_process_gone` (`agent-functions.sh:~700`): needs the pane pid (`transport_pid` equiv) + `pgrep -P <panePid>`, with the **arming** (seen-alive-once), **never-armed grace** (`MENTIKO_MONITOR_NEVER_ARMED_GRACE` default 5), and **1s debounce**. Live syscall.
- [ ] **3. Durable-transcript AGENT_COMPLETE marker (BUG-022)** — the subtle one. Port `_agent_transcript_jsonl` (`:295`) + `agent-complete-marker-durable` (`:319`) + `agent-complete-marker-seen`: extract session UUID from the capture, find the CLI transcript JSONL under `~/.claude/projects`, `~/.kollab/projects`, `~/.codex/sessions`, `~/.config/opencode`, `~/.gemini/antigravity-cli`, parse assistant text for a **standalone** `AGENT_COMPLETE` line. **Fail closed** (no transcript/jq → not latched, wait for the event file). Getting this wrong re-introduces false-latching off the rendered screen.
- [ ] **4. Nudge send wrapper** — `pty.sendKeys(session, msg)` + CR, mirroring `transport_send_raw` + `\r`.
- [ ] **5. Completion handoff (`onComplete`)** — port `launch-chain-runner-complete` (`:671`): spawn a **separate** PTY session running the completion command, with the exact env carry (`command_contract.env`), and the exit-64 fallback discipline. This is where the typed monitor invokes the typed completion bridge.
- [ ] **6. Death/stall effects (`onDied`/`onStalled`)** — write the diagnostic event file (from `buildMonitorDiagnosticEvent`) + update run+agent status via `run-state` (`updateRunAgent`/`updateRunStatus`). Death is event-first (`classifyDeath`), stall is BLOCKED (`classifyStall`).
- [ ] **7. `monitor-v2` CLI entry** (`web/lib/runner-v2/monitor-cli.ts`, mirror `complete-cli.ts`) — argv `session interval context chainPath maxStale` per `command_contract`, assemble `MonitorDriverIO` from the live wrappers (1–6), call `runChainMonitor`. Compile to a `.js`/`.cjs` the shell can exec.
- [ ] **8. Wire `buildMonitorCommand`** (`agent-bootstrap-plan.ts:326`) behind `MENTIKO_MONITOR_V2`: off → shell `monitor-chain-agent`, on → typed `monitor-v2`. Same env carry, same argv order.
- [ ] **9. THE fix — completion handoff wiring.** The typed monitor already only invokes completion on a genuine latch (reducer). Still must: connect **late-event recovery** (`recoverLateCompletionEvents`, built-but-unwired) and **feed liveness** to the completion bridge so a false `completion_failed` heals instead of spawning a dead/stalled decision loop. This is the runner-v2 `late_event_recovery` gap (see `runner-v2-contract.json` known_gaps).

### Acceptance — the gate I cannot fake in text
- [ ] **Live chain run**: a real stalled-but-alive agent is nudged/awaited and **never failed** (the TASK-093 shape). Drive it on the dev server (`localhost:3200`), `MENTIKO_MONITOR_V2=1`.
- [ ] Parity spot-checks live: latch on marker-only, latch on event-only, restart mid-run preserves nudge budget, remote (ssh) run ignores process death.
- [ ] **Flip the flag**: `MENTIKO_MONITOR_V2` default on — only after live parity passes.
- [ ] **Delete the shell**: `monitor-chain-agent` + its helpers in `agent-functions.sh` + `monitor-completion.sh`. (Standalone `mentiko-monitor.sh` is a separate concern — not deleted here.)
- [ ] This flips the last binding gap (`monitor-v2.contract.json` handoff invariant) red→covered, which **unblocks the runner-v2 default switch** (currently blocked by it — intentional).

### Reviewer's 10 required tests
- [x] monitor-v2 included in switch-readiness binding
- [x] processGone + latched → completes normally
- [x] alive + producing + no event → never invokes completion
- [x] remote workspace ignores local process death
- [x] wrong run id / wrong agent id completion event rejected (`monitor-io.test.ts`)
- [x] monitor restart preserves latch/nudge state (`monitor-io.test.ts`)
- [ ] flag off emits shell `monitor-chain-agent` (needs #8)
- [ ] flag on emits typed monitor command with exact env (needs #8)
- [ ] rendered transcript instruction echo does NOT count as completion (needs #3)
- [ ] late completion event recovers instead of a dead/stalled loop (needs #9, integration)

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
- BUILT-BUT-NOT-FED: liveness-aware exhaustion — no `liveness` input at the live call site, so `evaluateAgentLiveness(undefined)` → "dead", the await branch never fires.
- BUILT-BUT-NOT-WIRED: `recoverLateCompletionEvents` — zero callers.
- These overlap monitor-v2 item #9; fixing the monitor handoff is where they get wired.

### task-lifecycle-reducer plan — revised, implementation not started
- Plan + spec revised and committed (Task 0 + contract corrections C1–C8). Reducer core exists (`bb25e0b`).
- Retry-conflation fix landed (Codex, verified: `execution_retries` only, `EXECUTION_RETRY_LIMIT=2`).
- Open question you raised: execution-retry budget should source from the **chain** (`routing.default_retry.max_retries` / `agent.retry`), not a constant.

### Runner-v2 default switch — intentionally blocked
- `assessRunnerV2SwitchReadiness()` now returns `blocked` on the monitor-v2 handoff gap. Correct: flipping runner-v2 default while the monitor split-brain is live ships TASK-093. Unblocks when critical-path #9 + live proof land.

---

## Shared-checkout hazard
`~/dev/platform/mentiko` is shared with Codex + worktrees. Stage explicitly, don't
switch branches, and coordinate on the Codex-owned files above (task-visibility,
task-decision-link, reconcile, completion-audit-apply).
