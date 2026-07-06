# Task Lifecycle Reducer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a central reducer-owned task lifecycle contract so auto-run, reconcile, summaries, decisions, deletion, and unblocking follow one state machine.

**Architecture:** Add a pure reducer that converts lifecycle events into next state plus explicit effects. Add a service adapter that applies those effects using existing Mentiko services. Migrate existing routes gradually so runtime behavior follows the reducer without rewriting the chain runner.

**Tech Stack:** TypeScript, Jest, Next.js route handlers, existing SQLite task store, existing run/decision services.

---

## File Structure

- Create: `web/lib/orchestration/task-lifecycle-types.ts`
  - lifecycle phases, state, events, effects, constants
- Create: `web/lib/orchestration/task-lifecycle-reducer.ts`
  - pure reducer and transition helpers
- Create: `web/lib/orchestration/task-lifecycle-service.ts`
  - effect application adapter over existing services
- Create: `web/lib/orchestration/__tests__/task-lifecycle-reducer.test.ts`
  - pure contract tests
- Create: `web/lib/orchestration/__tests__/task-lifecycle-service.test.ts`
  - mocked effect application tests
- Modify: `web/app/api/tasks/reconcile/route.ts`
  - route terminal execution events through lifecycle service
- Modify: `web/lib/tasks/task-outcome-audit.ts`
  - enforce summary eligibility through lifecycle guard
- Modify: `web/app/api/tasks/[id]/outcome-summary/route.ts`
  - reject/defer retryable failed execution summaries under budget
- Modify: `web/lib/tasks/completion-audit-apply.ts`
  - report summary verdicts to lifecycle, align retry cap to shared constant
- Modify: `web/lib/tasks/task-decision-link.ts`
  - stamp decision idempotency fields
- Modify: `web/lib/decisions/decision-resolution.ts`
  - report decision resolution/follow-up tasks to lifecycle
- Create: `web/lib/decisions/decision-entity.ts`
  - `deleteDecisionEntity` cascade contract
- Modify: `web/app/api/decisions/[id]/route.ts`
  - delegate DELETE to `deleteDecisionEntity`

## Task 1: Add Reducer Types

**Files:**
- Create: `web/lib/orchestration/task-lifecycle-types.ts`
- Test: `web/lib/orchestration/__tests__/task-lifecycle-reducer.test.ts`

- [ ] **Step 1: Create the type file**

```ts
export const MIN_EXECUTION_RETRIES_BEFORE_SUMMARY = 3;

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
  retryCount: number;
  retryBudget: number;
  summaryRunId?: string;
  sourceRunFingerprint?: string;
  decisionTaskId?: string;
  followUpTaskIds: string[];
  blockedByTaskIds: string[];
  lastError?: string;
}

export type TaskLifecycleEvent =
  | { type: "task.auto_run_tick"; taskId: string; isOpen: boolean; isBlocked: boolean; autoRun: boolean; hasChain: boolean; hasGeneratedChain: boolean; hasRecommendation: boolean }
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
import { MIN_EXECUTION_RETRIES_BEFORE_SUMMARY } from "../task-lifecycle-types";

test("shared retry budget is 3", () => {
  expect(MIN_EXECUTION_RETRIES_BEFORE_SUMMARY).toBe(3);
});
```

- [ ] **Step 3: Run the test**

Run: `npm test -- --runTestsByPath web/lib/orchestration/__tests__/task-lifecycle-reducer.test.ts --runInBand`

Expected: pass after the type file exists.

## Task 2: Implement Pure Reducer

**Files:**
- Create: `web/lib/orchestration/task-lifecycle-reducer.ts`
- Modify: `web/lib/orchestration/__tests__/task-lifecycle-reducer.test.ts`

- [ ] **Step 1: Add reducer tests for retry-before-summary**

```ts
import { reduceTaskLifecycle } from "../task-lifecycle-reducer";
import type { TaskLifecycleState } from "../task-lifecycle-types";

function baseState(overrides: Partial<TaskLifecycleState> = {}): TaskLifecycleState {
  return {
    phase: "executing",
    taskId: "TASK-093",
    retryCount: 0,
    retryBudget: 3,
    followUpTaskIds: [],
    blockedByTaskIds: [],
    ...overrides,
  };
}

test("failed execution under retry budget retries instead of summarizing", () => {
  const result = reduceTaskLifecycle(baseState({ retryCount: 0 }), {
    type: "execution.failed",
    taskId: "TASK-093",
    runId: "run-1",
    fingerprint: "failed:1",
    reason: "agent failed",
  });

  expect(result.state.phase).toBe("retrying");
  expect(result.state.retryCount).toBe(1);
  expect(result.effects).toEqual([
    { type: "retry_execution", taskId: "TASK-093", previousRunId: "run-1", reason: "agent failed" },
  ]);
});

test("failed execution at retry budget starts summary", () => {
  const result = reduceTaskLifecycle(baseState({ retryCount: 2 }), {
    type: "execution.failed",
    taskId: "TASK-093",
    runId: "run-3",
    fingerprint: "failed:3",
    reason: "agent failed",
  });

  expect(result.state.phase).toBe("summarizing");
  expect(result.state.retryCount).toBe(3);
  expect(result.effects).toEqual([
    { type: "start_outcome_summary", taskId: "TASK-093", sourceRunId: "run-3", fingerprint: "failed:3" },
  ]);
});
```

- [ ] **Step 2: Implement minimal reducer**

Implement `execution.failed`, `execution.completed`, `summary.completed`,
`decision.created`, `decision.resolved`, `followups.completed`,
`decision.deleted`, and `task.auto_run_tick`.

- [ ] **Step 3: Run reducer tests**

Run: `npm test -- --runTestsByPath web/lib/orchestration/__tests__/task-lifecycle-reducer.test.ts --runInBand`

Expected: pass.

## Task 3: Add Lifecycle Service Adapter

**Files:**
- Create: `web/lib/orchestration/task-lifecycle-service.ts`
- Create: `web/lib/orchestration/__tests__/task-lifecycle-service.test.ts`

- [ ] **Step 1: Add service interface**

The service accepts a current `TaskLifecycleState`, an event, and dependency
functions for applying effects. The first implementation should be injectable
for tests.

- [ ] **Step 2: Test that effects call existing services**

Test:

- `start_outcome_summary` calls `startTaskOutcomeAudit`
- `retry_execution` clears stale run metadata and starts execution
- `close_task` calls `taskClose` and then scans unblocked tasks
- `block_on_decision` adds a task dependency from original task to decision task

- [ ] **Step 3: Implement the adapter**

Do not move route logic yet. Only make the service callable.

## Task 4: Migrate Reconcile Failed/Stopped Handling

**Files:**
- Modify: `web/app/api/tasks/reconcile/route.ts`
- Modify: `web/app/api/tasks/reconcile/route.test.ts`

- [ ] **Step 1: Add failing tests**

Cases:

- failed execution with retry count 0 returns retry effect and does not start summary
- failed execution with retry count 2 starts summary on third failure
- completed execution starts summary
- non-execution run never starts summary

- [ ] **Step 2: Route terminal execution events through lifecycle service**

Replace direct `startTaskOutcomeAudit()` calls for failed/stopped execution runs
with lifecycle event application.

- [ ] **Step 3: Run tests**

Run: `npm test -- --runTestsByPath web/app/api/tasks/reconcile/route.test.ts web/lib/orchestration/__tests__/task-lifecycle-reducer.test.ts --runInBand`

Expected: pass.

## Task 5: Guard Manual Outcome Summary

**Files:**
- Modify: `web/app/api/tasks/[id]/outcome-summary/route.ts`
- Modify: `web/app/api/tasks/[id]/outcome-summary/route.test.ts`

- [ ] **Step 1: Add failing test**

Manual summary for failed/stopped execution under retry budget returns `400` or
deferred response and does not create a summary job.

- [ ] **Step 2: Implement summary eligibility guard**

Use shared retry budget and lifecycle state. Completed execution remains
eligible.

- [ ] **Step 3: Run tests**

Run: `npm test -- --runTestsByPath 'web/app/api/tasks/[id]/outcome-summary/route.test.ts' --runInBand`

Expected: pass.

## Task 6: Migrate Summary Verdict Handling

**Files:**
- Modify: `web/lib/tasks/completion-audit-apply.ts`
- Modify: `web/lib/tasks/completion-audit-apply.test.ts`

- [ ] **Step 1: Add failing tests**

Cases:

- retry verdict under budget emits retry, not decision
- retry cap is shared `3`
- decision verdict blocks original task from open/in_progress, not only closed
- decision gate adds dependency from original task to decision task
- duplicate source run/fingerprint reuses existing open gate

- [ ] **Step 2: Implement lifecycle-backed verdict handling**

Keep existing audit parsing. Move transition decisions to reducer/service.

- [ ] **Step 3: Run tests**

Run: `npm test -- --runTestsByPath web/lib/tasks/completion-audit-apply.test.ts web/lib/orchestration/__tests__/task-lifecycle-reducer.test.ts --runInBand`

Expected: pass.

## Task 7: Add Decision Entity Delete Contract

**Files:**
- Create: `web/lib/decisions/decision-entity.ts`
- Modify: `web/app/api/decisions/[id]/route.ts`
- Modify: `web/app/api/decisions/[id]/route.test.ts`

- [ ] **Step 1: Add domain tests**

Cases:

- deletes decision JSON and linked DEC task
- clears parent metadata pointers
- prunes duplicate/superseded arrays
- clears decision-required flag when no live gate remains
- if JSON is missing, finds orphan DEC task by `metadata.decision_id`
- idempotent delete succeeds when both JSON and task are already gone

- [ ] **Step 2: Extract route-local cascade into `deleteDecisionEntity`**

Route calls only `deleteDecisionEntity(nsId, orgId, decisionId, workspacePath)`.

- [ ] **Step 3: Run tests**

Run: `npm test -- --runTestsByPath 'web/app/api/decisions/[id]/route.test.ts' --runInBand`

Expected: pass.

## Task 8: Migrate Decision Resolution Resume Rules

**Files:**
- Modify: `web/lib/decisions/decision-resolution.ts`
- Modify: `web/lib/decisions/decision-resolution.test.ts`

- [ ] **Step 1: Add failing tests**

Cases:

- resolving decision with follow-up tasks adds dependencies from original task to
  follow-ups
- original remains blocked while follow-ups are open
- original clears `last_run_decision_required` and resumes only after follow-ups
  close

- [ ] **Step 2: Apply lifecycle events in decision resolution**

Emit `decision.resolved` and later `followups.completed` through service.

- [ ] **Step 3: Run tests**

Run: `npm test -- --runTestsByPath web/lib/decisions/decision-resolution.test.ts web/lib/orchestration/__tests__/task-lifecycle-reducer.test.ts --runInBand`

Expected: pass.

## Task 9: Shared Hidden Decision Gate Visibility

**Files:**
- Create: `web/lib/tasks/task-visibility.ts`
- Modify: `web/components/task/task-detail.tsx`
- Modify: `web/app/api/tasks/[id]/deps/route.ts`
- Modify: `web/app/api/tasks/graph/route.ts`
- Modify: `web/app/api/tasks/epics/route.ts`

- [ ] **Step 1: Add tests**

Superseded decision gates should not show as active subtasks, active graph
nodes, or epic progress children. With explicit closed/history mode they may
show as closed history.

- [ ] **Step 2: Implement shared helper**

```ts
export function isSupersededDecisionGate(task: { id: string; issue_type?: string; type?: string; metadata?: unknown }, parentMetadata?: unknown): boolean
```

- [ ] **Step 3: Wire all task surfaces**

Use the helper in detail, deps, graph, and epics.

## Task 10: Verification Sweep

**Files:**
- No new files unless tests reveal gaps.

- [ ] **Step 1: Run targeted tests**

```bash
npm test -- --runTestsByPath \
  web/lib/orchestration/__tests__/task-lifecycle-reducer.test.ts \
  web/lib/orchestration/__tests__/task-lifecycle-service.test.ts \
  web/app/api/tasks/reconcile/route.test.ts \
  'web/app/api/tasks/[id]/outcome-summary/route.test.ts' \
  web/lib/tasks/completion-audit-apply.test.ts \
  'web/app/api/decisions/[id]/route.test.ts' \
  web/lib/decisions/decision-resolution.test.ts \
  --runInBand
```

- [ ] **Step 2: Run static checks**

```bash
npx eslint web/lib/orchestration web/lib/decisions/decision-entity.ts web/app/api/tasks/reconcile/route.ts 'web/app/api/tasks/[id]/outcome-summary/route.ts' web/lib/tasks/completion-audit-apply.ts 'web/app/api/decisions/[id]/route.ts'
npx tsc --noEmit --pretty false
git diff --check
```

- [ ] **Step 3: Live local verification**

Verify against local data:

- failed execution under retry budget does not create summary job
- exhausted execution creates one summary job
- summary decision creates one decision gate
- deleting the decision removes linked DEC task and parent pointer
- closing a task lets the next auto-run eligible task start on the next scan

## Self-Review

- Spec coverage: retry-before-summary, decision gate blocking, delete entity
  cleanup, decision resolution/follow-up resume, close/unblock, watcher/monitor
  separation are covered.
- Placeholder scan: no implementation step says TBD/TODO/fill later.
- Type consistency: reducer types in this plan match
  `docs/orchestration/task-lifecycle-reducer-spec.md`.

