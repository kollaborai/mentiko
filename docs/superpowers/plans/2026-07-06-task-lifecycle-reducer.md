# Task Lifecycle Reducer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a central reducer-owned task lifecycle contract so auto-run, reconcile, summaries, decisions, deletion, and unblocking follow one state machine — **fed by execution facts that are actually true.**

**Architecture:** Add a pure reducer that converts lifecycle events into next state plus explicit effects. Add a service adapter that applies those effects using existing Mentiko services. Migrate existing routes gradually so runtime behavior follows the reducer without rewriting the chain runner.

**Tech Stack:** TypeScript, Jest, Next.js route handlers, existing SQLite task store, existing run/decision services.

---

## Producer dependency — read before Task 1

The reducer consumes `execution.completed` / `execution.failed`. Those facts are produced by the runner-v2 completion layer and surfaced to the reducer through `reconcile`, which **adopts `run.json` status verbatim** (`web/app/api/tasks/reconcile/route.ts:130`). That status is written by runner-v2 completion detection (`web/lib/runner-v2/completion-runner.ts:166`).

That producer is currently unreliable. Verified live on `TASK-093` / `run-1783376956767-0f954d43`:

- the agent `api-route-architect` emitted a **valid** completion event — `event: architecture-designed`, `source: api-route-architect`, `run_id` matches, `processed: false` — which passes every check in `rejectCompletionEvent` (`web/lib/runner-v2/completion.ts:41-63`).
- but the runnerV2 attempt was terminalized `completion_failed / retries_exhausted` ("declared completion event missing; retries exhausted") at `22:31:49Z`, while the event was written at `22:36:14Z` — **~4.5 minutes later.** The no-event retry budget exhausted before the slow agent produced its event.
- `runDir/events` does not exist; the event lives only in the project events dir, so the typed matcher (`completion-entrypoint.ts:64,68` reads `env.EVENTS_DIR` + `runDir/events`) depends entirely on `EVENTS_DIR` being correct.

**Consequence:** a reducer fed a false `execution.failed` faithfully retries an agent that already succeeded — which is exactly the observed "pipeline ran 3×, all stopped." Building the reducer on this producer just makes a cleaner machine confidently process lies.

**Sequencing (mandatory):**

1. **Task 0** — fix the producer (premature completion-exhaustion). Gate everything else behind it.
2. **Tasks 1–3 + Contract corrections** — close the state-machine rule layer.
3. **Tasks 4–9** — wire adapters (Tasks 4 and 8 are behavior *changes*, not migrations — see each).
4. **Task 10** — verify; do **not** remove legacy transition checks until Task 0 lands and parity tests pass.

---

## File Structure

- Create: `web/lib/orchestration/task-lifecycle-types.ts` — lifecycle phases, state, events, effects, constants
- Create: `web/lib/orchestration/task-lifecycle-reducer.ts` — pure reducer and transition helpers
- Create: `web/lib/orchestration/task-lifecycle-hydrate.ts` — `hydrateLifecycleState(taskMetadata)` (the state source; see B5)
- Create: `web/lib/orchestration/task-lifecycle-service.ts` — effect application adapter over existing services
- Create: `web/lib/orchestration/__tests__/task-lifecycle-reducer.test.ts` — pure contract tests
- Create: `web/lib/orchestration/__tests__/task-lifecycle-service.test.ts` — mocked effect application tests
- Modify (Task 0): `web/lib/runner-v2/completion-runner.ts`, `web/lib/runner-v2/completion-entrypoint.ts`, `web/lib/runner-v2/completion.ts` (+ a late-event recovery pass and tests)
- Modify: `web/app/api/tasks/reconcile/route.ts` + `route.test.ts` — branch terminal status, compute fingerprint, route through the service (**behavior change**, see Task 4)
- Modify: `web/lib/tasks/task-outcome-audit.ts` — enforce summary eligibility through lifecycle guard
- Modify: `web/app/api/tasks/[id]/outcome-summary/route.ts` — reject/defer retryable failed execution summaries under budget
- Modify: `web/lib/tasks/completion-audit-apply.ts` — report summary verdicts to lifecycle; keep `RETRY_CAP` semantics (see B3)
- Modify: `web/lib/tasks/task-decision-link.ts` — stamp decision idempotency fields
- Modify: `web/lib/decisions/decision-resolution.ts` — **add** block/clear/resume rules (net-new, see Task 8)
- Create: `web/lib/decisions/decision-entity.ts` — `deleteDecisionEntity` cascade contract
- Modify: `web/app/api/decisions/[id]/route.ts` — delegate DELETE to `deleteDecisionEntity`

## Contract corrections (fold into the spec + types before building)

These close blockers found in review. The reducer types in Task 1 and the spec (`docs/orchestration/task-lifecycle-reducer-spec.md`) must both reflect them.

- **C1 — retry counter (B3).** Use one dedicated counter `executionRetryCount` backed by a new metadata key `execution_retries`, **separate from `auto_run_retries`** (which is also incremented on generation/analysis failures — `web/lib/runs/auto-run.ts:573,594,628,650,822,917,974`). Pin the same comparison on both the failure path and the summary-retry path. **Keep the budget at 2 retries** (parity with current `RETRY_CAP = 2`, `completion-audit-apply.ts:16`, used as `retryCount(metadata) >= RETRY_CAP` at `:233`). Do **not** silently move to 3. `MIN_EXECUTION_RETRIES_BEFORE_SUMMARY` is renamed for honesty — see C2.
- **C2 — bounded summary-retry (B1-machine).** `summary.completed` verdict `retry` **increments `executionRetryCount`** before the budget check; otherwise success→summary→retry loops forever (nothing else increments it on the success path). Reset `executionRetryCount` on `execution.started`.
- **C3 — state hydration (B5).** The reducer is pure; its `TaskLifecycleState` must be built from task metadata on every adapter entry via `hydrateLifecycleState(taskMetadata)`. Without it, every call rebuilds a near-default state (`retryCount = 0`, empty fingerprints) and all capping/dedup silently void in production despite green unit tests. This is the first deliverable of Task 3.
- **C4 — dedup by set, not single field (B7).** State carries `summarizedFingerprints: string[]` and `gatedFingerprints: string[]` (not single-valued `summaryRunId`/`decisionTaskId`). `execution.completed` **and** `execution.failed` dedup on `(runId, fingerprint)`. Gate creation records the fingerprint in `gatedFingerprints` in the **same** transition that emits `create_decision_gate`; `decision.created` only backfills `decisionTaskId` and emits `block_on_decision`.
- **C5 — no dead states (B5-machine).** Implement all 12 events. `analysis.completed → chain_ready`; `chain.generated → chain_ready`; `execution.started → executing` (set `currentRunId`, reset `executionRetryCount`); `task.closed → closed`. Otherwise delete `analyzing`/`chain_ready`/`closing` from the phase union. Do not ship declared-but-unreachable phases.
- **C6 — no-follow-up resume (B6).** `decision.resolved` with no follow-ups sets `phase = resuming` and emits `resume_original_task` (+ `scan_unblocked_auto_run_tasks`), mirroring `followups.completed`. Otherwise the common approve-and-continue case parks forever.
- **C7 — concurrent-execution guard (M6).** `start_execution` is a no-op when `currentRunStatus === "running"`.
- **C8 — auto_run_tick scope (m7/M1).** For v1, **drop `task.auto_run_tick` from the reducer.** Reconcile/auto-run keep owning admission (the reducer's job is post-execution lifecycle). The real `triggerAutoRun` has resume-vs-restart, in-flight-job guards, and a concurrency ceiling (`auto-run.ts:143-167,227-255`) that the 6-branch tick model omits; modeling it now is divergent duplication, not consolidation. Revisit in a follow-up if consolidation is wanted.

## Task 0: Fix runner-v2 premature completion-exhaustion (BLOCKER — do first)

**Files:**
- Modify: `web/lib/runner-v2/completion-runner.ts`, `web/lib/runner-v2/completion-entrypoint.ts`, `web/lib/runner-v2/completion.ts`
- Create: late-event recovery pass (reconcile-side or a runner-v2 sweep) + `web/lib/runner-v2/__tests__/completion-late-event.test.ts`

Root cause (verified, see "Producer dependency" above): the no-event retry budget can exhaust **before** a slow agent emits its declared completion event; the agent is then falsely marked `completion_failed / "declared completion event missing"` while a valid event later lands `processed: false` in the events dir.

- [ ] **Step 1: Liveness-aware exhaustion.** Do not terminalize as "completion event missing; retries exhausted" while the agent **process is alive and producing output**. Parity target: `lib/agent-functions.sh` already checks for a genuine completion event before declaring an agent dead ("process gone but ln exists … completing normally"). Reset/extend the no-event retry budget on observed liveness in the typed path.
- [ ] **Step 2: Late-event recovery.** Add a pass that adopts an unprocessed valid completion event matching a `completion_failed` attempt and re-completes it. This recovers `TASK-093` and any already-stuck task. Test: seed a `completion_failed` attempt + a matching `processed:false` event → attempt recovers to complete and routes downstream.
- [ ] **Step 3: Harden events-dir resolution.** The matcher must always include the project/namespace events dir, not rely solely on `env.EVENTS_DIR` (`runDir/events` does not exist). Test: event present **only** in the project events dir → matches.
- [ ] **Step 4: Regression test.** Valid-but-late event (emitted after the first no-event check) → agent completes, not failed.

**Gate:** do not start Task 4 rollout until Task 0 tests pass and re-running `TASK-093`'s pipeline recovers (or the late-event pass recovers the existing stuck run).

## Task 1: Add Reducer Types

**Files:**
- Create: `web/lib/orchestration/task-lifecycle-types.ts`
- Test: `web/lib/orchestration/__tests__/task-lifecycle-reducer.test.ts`

- [ ] **Step 1: Create the type file** (reflects C1–C7)

```ts
// Budget is expressed as retries. 2 retries = 3 execution attempts, matching the
// current auditor RETRY_CAP=2 (>=) semantics. Do not change to 3 without a deliberate call.
export const MAX_EXECUTION_RETRIES_BEFORE_SUMMARY = 2;

export type TaskLifecyclePhase =
  | "idle"
  | "analyzing"
  | "chain_ready"
  | "executing"
  | "retrying"
  | "summarizing"
  | "decision_blocked"
  | "followup_blocked"
  | "resuming"
  | "closing"
  | "closed";

export interface TaskLifecycleState {
  phase: TaskLifecyclePhase;
  taskId: string;
  chainId?: string;
  currentRunId?: string;
  currentRunStatus?: "running" | "completed" | "failed" | "stopped";
  executionRetryCount: number;   // C1: backed by metadata.execution_retries, NOT auto_run_retries
  retryBudget: number;           // default MAX_EXECUTION_RETRIES_BEFORE_SUMMARY
  summarizedFingerprints: string[]; // C4: set-based dedup, not single-valued
  gatedFingerprints: string[];      // C4
  decisionTaskId?: string;
  followUpTaskIds: string[];
  blockedByTaskIds: string[];
  lastError?: string;
}

export type TaskLifecycleEvent =
  | { type: "analysis.completed"; taskId: string; recommendationRunId: string; recommendedChainId?: string; requiresGeneration: boolean }
  | { type: "chain.generated"; taskId: string; chainId: string; generationRunId: string }
  | { type: "execution.started"; taskId: string; runId: string; chainId: string }
  | { type: "execution.completed"; taskId: string; runId: string; fingerprint: string }
  | { type: "execution.failed"; taskId: string; runId: string; fingerprint: string; reason: string; nonRetryable?: boolean }
  | { type: "summary.completed"; taskId: string; summaryRunId: string; sourceRunId: string; verdict: "close" | "retry" | "decision"; followUpTaskIds?: string[]; decisionTaskId?: string }
  | { type: "decision.created"; taskId: string; decisionTaskId: string; sourceRunId: string; fingerprint: string }
  | { type: "decision.resolved"; taskId: string; decisionTaskId: string; followUpTaskIds: string[] }
  | { type: "followups.completed"; taskId: string; followUpTaskIds: string[] }
  | { type: "decision.deleted"; taskId: string; decisionTaskId?: string; decisionId?: string }
  | { type: "task.closed"; taskId: string };
  // NOTE: task.auto_run_tick dropped from v1 scope (C8). Auto-run admission stays in reconcile/auto-run.

export type TaskLifecycleEffect =
  | { type: "start_analysis"; taskId: string }
  | { type: "start_chain_generation"; taskId: string }
  | { type: "start_execution"; taskId: string; chainId: string }
  | { type: "retry_execution"; taskId: string; previousRunId: string; reason: string }
  | { type: "start_outcome_summary"; taskId: string; sourceRunId: string; fingerprint: string }
  | { type: "create_decision_gate"; taskId: string; sourceRunId: string; fingerprint: string }
  | { type: "block_on_decision"; taskId: string; decisionTaskId: string }
  | { type: "create_followup_dependencies"; taskId: string; followUpTaskIds: string[] }
  | { type: "resume_original_task"; taskId: string }
  | { type: "close_task"; taskId: string }
  | { type: "clear_decision_gate"; taskId: string; decisionTaskId?: string }
  | { type: "scan_unblocked_auto_run_tasks" };

export interface TaskLifecycleTransition {
  state: TaskLifecycleState;
  effects: TaskLifecycleEffect[];
}
```

- [ ] **Step 2: Add a placeholder failing import test**

```ts
import { MAX_EXECUTION_RETRIES_BEFORE_SUMMARY } from "../task-lifecycle-types";

test("shared retry budget is 2 (3 attempts)", () => {
  expect(MAX_EXECUTION_RETRIES_BEFORE_SUMMARY).toBe(2);
});
```

- [ ] **Step 3: Run the test**

Run: `npm test -- --runTestsByPath web/lib/orchestration/__tests__/task-lifecycle-reducer.test.ts --runInBand`

Expected: pass after the type file exists.

## Task 2: Implement Pure Reducer

**Files:**
- Create: `web/lib/orchestration/task-lifecycle-reducer.ts`
- Modify: `web/lib/orchestration/__tests__/task-lifecycle-reducer.test.ts`

- [ ] **Step 1: Add reducer tests** covering the corrected contract:

```ts
import { reduceTaskLifecycle } from "../task-lifecycle-reducer";
import type { TaskLifecycleState } from "../task-lifecycle-types";

function baseState(overrides: Partial<TaskLifecycleState> = {}): TaskLifecycleState {
  return {
    phase: "executing",
    taskId: "TASK-093",
    executionRetryCount: 0,
    retryBudget: 2,
    summarizedFingerprints: [],
    gatedFingerprints: [],
    followUpTaskIds: [],
    blockedByTaskIds: [],
    ...overrides,
  };
}

test("failed execution under retry budget retries instead of summarizing", () => {
  const result = reduceTaskLifecycle(baseState({ executionRetryCount: 0 }), {
    type: "execution.failed", taskId: "TASK-093", runId: "run-1", fingerprint: "failed:1", reason: "agent failed",
  });
  expect(result.state.phase).toBe("retrying");
  expect(result.state.executionRetryCount).toBe(1);
  expect(result.effects).toEqual([
    { type: "retry_execution", taskId: "TASK-093", previousRunId: "run-1", reason: "agent failed" },
  ]);
});

test("failed execution at retry budget starts summary", () => {
  const result = reduceTaskLifecycle(baseState({ executionRetryCount: 2 }), {
    type: "execution.failed", taskId: "TASK-093", runId: "run-3", fingerprint: "failed:3", reason: "agent failed",
  });
  expect(result.state.phase).toBe("summarizing");
  expect(result.effects).toEqual([
    { type: "start_outcome_summary", taskId: "TASK-093", sourceRunId: "run-3", fingerprint: "failed:3" },
  ]);
});

test("nonRetryable failure summarizes immediately regardless of budget", () => {
  const result = reduceTaskLifecycle(baseState({ executionRetryCount: 0 }), {
    type: "execution.failed", taskId: "TASK-093", runId: "run-1", fingerprint: "failed:1", reason: "bad chain", nonRetryable: true,
  });
  expect(result.effects[0].type).toBe("start_outcome_summary");
});

test("summary verdict=retry increments the counter (bounded loop)", () => {
  const s = baseState({ phase: "summarizing", executionRetryCount: 0 });
  const r = reduceTaskLifecycle(s, { type: "summary.completed", taskId: "TASK-093", summaryRunId: "sum-1", sourceRunId: "run-1", verdict: "retry" });
  expect(r.state.executionRetryCount).toBe(1);        // C2: must increment, else infinite
  expect(r.effects[0].type).toBe("retry_execution");
});

test("duplicate execution.completed for same fingerprint does not re-summarize", () => {
  const s = baseState({ phase: "summarizing", summarizedFingerprints: ["ok:1"] });
  const r = reduceTaskLifecycle(s, { type: "execution.completed", taskId: "TASK-093", runId: "run-1", fingerprint: "ok:1" });
  expect(r.effects).toEqual([]);                        // C4: idempotent
});

test("execution.started resets the execution retry counter and sets executing", () => {
  const r = reduceTaskLifecycle(baseState({ phase: "resuming", executionRetryCount: 2 }), {
    type: "execution.started", taskId: "TASK-093", runId: "run-9", chainId: "c",
  });
  expect(r.state.phase).toBe("executing");
  expect(r.state.executionRetryCount).toBe(0);         // C2/C5
  expect(r.state.currentRunId).toBe("run-9");
});

test("decision.resolved with no follow-ups resumes the task", () => {
  const r = reduceTaskLifecycle(baseState({ phase: "decision_blocked" }), {
    type: "decision.resolved", taskId: "TASK-093", decisionTaskId: "DEC-1", followUpTaskIds: [],
  });
  expect(r.state.phase).toBe("resuming");              // C6: not stranded
  expect(r.effects.map((e) => e.type)).toContain("resume_original_task");
});
```

- [ ] **Step 2: Implement the reducer** for all 12 events (C5), with:
  - failure + summary-retry sharing `executionRetryCount` and one operator (C1/C2)
  - fingerprint-set dedup on completed **and** failed (C4)
  - no-follow-up resume (C6) and concurrent-execution guard (C7)

- [ ] **Step 3: Run reducer tests** — expected: pass.

## Task 3: Add Lifecycle Service Adapter

**Files:**
- Create: `web/lib/orchestration/task-lifecycle-hydrate.ts`
- Create: `web/lib/orchestration/task-lifecycle-service.ts`
- Create: `web/lib/orchestration/__tests__/task-lifecycle-service.test.ts`

- [ ] **Step 1: Implement `hydrateLifecycleState(taskMetadata)` FIRST (C3).** Map real metadata → `TaskLifecycleState`: `execution_retries → executionRetryCount`, `last_run_id → currentRunId`, `last_run_status → currentRunStatus`, `last_run_decision_required`/`decision_subtask_id → decisionTaskId`, `completion_audit_run_fingerprint`/`task_outcome_summary_run_fingerprint → summarizedFingerprints`. Add a test: hydrating `TASK-093`'s stuck metadata (open, 3 stopped runs) yields a sane phase, not default.

- [ ] **Step 2: Service interface.** Accepts a hydrated `TaskLifecycleState`, an event, and injectable dependency functions. Note the **`Request` boundary (M5):** the "pure" boundary stops at the reducer. Effect application needs a live `Request` — `startTaskOutcomeAudit` (`task-outcome-audit.ts:147`) and `applyCompletionAudit → createDecisionSubtask → startDecisionResearch` (`completion-audit-apply.ts:116`) all require one. Reconcile/auto-run have a `NextRequest`; specify a shim for the delete/decision-resolution entry points.

- [ ] **Step 3: Effect → real function mapping (M4).** Document exact signatures:
  - `start_outcome_summary` → `startTaskOutcomeAudit({ request, namespaceId, orgId, taskId })`. The effect's `sourceRunId`/`fingerprint` are **advisory** — the fn derives `sourceRunId` from `metadata.last_run_id` (`:51`) and computes the fingerprint itself (`:54`). If summarizing a run other than `last_run_id` is ever required, add an explicit `sourceRunId` param to `startTaskOutcomeAudit` as its own step.
  - `close_task` → `taskClose(orgId, id, reason?, namespaceId?)` (`web/lib/tasks/task-store.ts:528`), then `scan_unblocked_auto_run_tasks`.
  - `block_on_decision` / `create_followup_dependencies` → `taskAddDep(orgId, taskId, dependsOnId, namespaceId?, workspaceId?)` (`task-store.ts:557`).
  - `scan_unblocked_auto_run_tasks` → `getAutoRunCandidates` + start path (`web/lib/runs/auto-run.ts:232`), or document as a nudge to the existing 60s poller (`web/lib/runs/auto-run-service.ts:49`).
  - `clear_decision_gate` → `deleteDecisionEntity` (Task 7).

- [ ] **Step 4: Implement the adapter.** Do not move route logic yet. Only make the service callable.

## Task 4: Reconcile Failed/Stopped Handling — BEHAVIOR CHANGE (not a migration)

**Files:**
- Modify: `web/app/api/tasks/reconcile/route.ts`
- Modify: `web/app/api/tasks/reconcile/route.test.ts`

> **This reverses a deliberate, tested design.** Today reconcile hands **every** terminal run (completed/failed/stopped) to the auditor (`route.ts:184-194,214-259`); `route.test.ts:583-587` asserts *"Terminal failure now routes through the auditor (which owns retry vs decision vs close), not a blind reconcile retry."* Moving retry to pre-summary in the reducer changes this contract. State it as a change, not a cleanup.

- [ ] **Step 1: Add failing tests** — failed run under budget → `retry_execution`, no summary; failed at budget → summary; completed → summary; non-execution run → no summary.

- [ ] **Step 2: Branch + fingerprint + route.** Reconcile currently lumps all terminals together and lets `startTaskOutcomeAudit` compute the fingerprint. It must now (a) branch on `run.status` to emit `execution.completed` vs `execution.failed`, and (b) compute `currentRunTerminalFingerprint(namespaceId, orgId, runId)` (`web/lib/tasks/run-outcome-evidence.ts:43`) **itself** before emitting, so the reducer's dedup has a real key (C4).

- [ ] **Step 3: Reconcile the two retry loops.** The reducer's execution-level `retry_execution` and the auditor's verdict-level `retry` must not both fire on one counter. Route failed/stopped execution runs through the reducer; ensure the auditor no longer independently retries the same run (single `executionRetryCount`, C1).

- [ ] **Step 4: Rewrite `route.test.ts:530-589`** to the new contract, and run:
`npm test -- --runTestsByPath web/app/api/tasks/reconcile/route.test.ts web/lib/orchestration/__tests__/task-lifecycle-reducer.test.ts --runInBand`

## Task 5: Guard Manual Outcome Summary

**Files:**
- Modify: `web/app/api/tasks/[id]/outcome-summary/route.ts` + `route.test.ts`

- [ ] **Step 1:** Failing test — manual summary for a failed/stopped run under budget returns `400`/deferred and creates no summary job.
- [ ] **Step 2:** Implement the guard using `hydrateLifecycleState` + `executionRetryCount`. Completed execution stays eligible.
- [ ] **Step 3:** Run `npm test -- --runTestsByPath 'web/app/api/tasks/[id]/outcome-summary/route.test.ts' --runInBand`.

## Task 6: Migrate Summary Verdict Handling

**Files:**
- Modify: `web/lib/tasks/completion-audit-apply.ts` + `completion-audit-apply.test.ts`

- [ ] **Step 1: Failing tests** — retry verdict under budget emits retry (bounded, increments counter, C2); retry cap stays **2** (`RETRY_CAP` semantics, C1); decision verdict blocks the parent from open/in_progress not only closed; decision gate adds a dependency; duplicate source-run/fingerprint reuses the existing open gate via `gatedFingerprints` (C4).
- [ ] **Step 2: Implement** lifecycle-backed verdict handling. Keep existing audit parsing; move transition decisions to reducer/service. Keep `RETRY_CAP = 2` — do **not** rename-and-bump to 3.
- [ ] **Step 3: Run** `npm test -- --runTestsByPath web/lib/tasks/completion-audit-apply.test.ts web/lib/orchestration/__tests__/task-lifecycle-reducer.test.ts --runInBand`.

## Task 7: Add Decision Entity Delete Contract

**Files:**
- Create: `web/lib/decisions/decision-entity.ts`
- Modify: `web/app/api/decisions/[id]/route.ts` + `route.test.ts`

Verified: the route-local cascade at `decisions/[id]/route.ts:147-221` (JSON delete + linked DEC-task delete + parent-pointer clear for `decision_subtask_id`/`decision_id`/superseded arrays + `last_run_decision_required` clear) is accurate — the extraction is well-grounded. `metadata.decision_id` is real (`task-decision-link.ts:66`).

- [ ] **Step 1: Domain tests** — deletes JSON + linked DEC task; clears parent pointers; prunes superseded arrays; clears `last_run_decision_required` when no live gate; the orphan-by-`metadata.decision_id` lookup (**new**, not in the route today); idempotent when both are already gone.
- [ ] **Step 2:** Extract into `deleteDecisionEntity(nsId, orgId, decisionId, workspacePath)`; route calls only that. Delete → `idle` vs `resuming` determined by `currentRunStatus === "running"` (m1).
- [ ] **Step 3:** Run `npm test -- --runTestsByPath 'web/app/api/decisions/[id]/route.test.ts' --runInBand`.

## Task 8: Decision Resolution Resume Rules — NEW implementation (not a migration)

**Files:**
- Modify: `web/lib/decisions/decision-resolution.ts` + `decision-resolution.test.ts`

> **These rules do not exist to migrate — this is net-new.** `resolveDecisionToTasks` closes the decision task (`:328-343`), creates follow-ups under the **epic ancestor** (`resolveEpicAncestor`, `:181-183`), and wires deps **only between plan tasks** (`:225-303`). It never blocks the original/parent task, never touches `last_run_decision_required`, and has no resume concept. Add all of it.

- [ ] **Step 1: Failing tests** — resolving with follow-ups adds deps from the **original task** to the follow-ups; original stays blocked while any follow-up is open; original clears `last_run_decision_required` and resumes only after follow-ups close.
- [ ] **Step 2: Implement.** Pin "original task" = `decision.parentTaskId` (the completion-audit parent where the gate was set), **not** the epic ancestor tasks are re-parented under (`:181-183` vs `:313` — this ambiguity is real). Emit `decision.resolved` then `followups.completed` through the service.
- [ ] **Step 3: Run** `npm test -- --runTestsByPath web/lib/decisions/decision-resolution.test.ts web/lib/orchestration/__tests__/task-lifecycle-reducer.test.ts --runInBand`.

## Task 9: Shared Hidden Decision Gate Visibility

**Files:**
- Create: `web/lib/tasks/task-visibility.ts`
- Modify: `web/components/task/task-detail.tsx`, `web/app/api/tasks/[id]/deps/route.ts`, `web/app/api/tasks/graph/route.ts`, `web/app/api/tasks/epics/route.ts`

Verified: the helper's dual `issue_type?/type?` is required, not a guess — `TaskRecord` uses `issue_type` (`task-store-types.ts:11`), the UI `Task`/`task-detail.tsx` use `.type` (`:82,:114,:278`), graph nodes expose `type` (`graph/route.ts:253`).

- [ ] **Step 1: Tests** — superseded gates don't show as active subtasks/graph nodes/epic children; with explicit closed/history mode they may show as closed history.
- [ ] **Step 2: Implement** `isSupersededDecisionGate(task, parentMetadata?)`.
- [ ] **Step 3: Wire** detail, deps, graph, epics through the helper.

## Task 10: Verification Sweep

- [ ] **Step 1: Targeted tests**

```bash
npm test -- --runTestsByPath \
  web/lib/runner-v2/__tests__/completion-late-event.test.ts \
  web/lib/orchestration/__tests__/task-lifecycle-reducer.test.ts \
  web/lib/orchestration/__tests__/task-lifecycle-service.test.ts \
  web/app/api/tasks/reconcile/route.test.ts \
  'web/app/api/tasks/[id]/outcome-summary/route.test.ts' \
  web/lib/tasks/completion-audit-apply.test.ts \
  'web/app/api/decisions/[id]/route.test.ts' \
  web/lib/decisions/decision-resolution.test.ts \
  --runInBand
```

- [ ] **Step 2: Static checks**

```bash
npx eslint web/lib/runner-v2 web/lib/orchestration web/lib/decisions/decision-entity.ts web/app/api/tasks/reconcile/route.ts 'web/app/api/tasks/[id]/outcome-summary/route.ts' web/lib/tasks/completion-audit-apply.ts 'web/app/api/decisions/[id]/route.ts'
npx tsc --noEmit --pretty false
git diff --check
```

- [ ] **Step 3: Live local verification**

- **`TASK-093` recovers** — the stuck run completes via Task 0's late-event pass (or a re-run no longer false-fails).
- failed execution under retry budget creates no summary job.
- exhausted execution creates exactly one summary job.
- summary decision creates exactly one decision gate (dedup holds under a repeated reconcile sweep, C4).
- deleting the decision removes the linked DEC task and parent pointer.
- closing a task lets the next auto-run eligible task start on the next scan.
- **Legacy removal is gated:** do not delete legacy transition checks until Task 0 passes and reducer/legacy parity is proven (avoids a double-apply window).

## Self-Review

- **Producer first:** Task 0 fixes the false `execution.failed` at its source (`runner-v2` completion detection) before the reducer consumes it. Without it, the reducer formalizes the `TASK-093` failure loop.
- **Corrected coverage:** retry-before-summary now uses one counter with a bounded summary-retry (C1/C2); state hydration is defined (C3); dedup is set-based (C4); no dead phases (C5); no-follow-up resume (C6); concurrent-execution guard (C7); `auto_run_tick` scoped out of v1 (C8).
- **Reframed, not mislabeled:** Task 4 (reconcile) and Task 8 (decision resolution) are behavior changes / net-new, not migrations, and say so.
- **Type consistency:** reducer types here match `docs/orchestration/task-lifecycle-reducer-spec.md` after both are updated for C1–C8 (the spec update is a prerequisite, not an afterthought).
- **Shared checkout:** the Modify targets overlap in-flight runner-v2 work in a shared checkout — rebase/coordinate and stage explicitly before editing; do not clobber uncommitted changes.
- **Placeholder scan:** no step says TBD/TODO/fill later.
