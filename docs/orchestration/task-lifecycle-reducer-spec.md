# Task lifecycle reducer spec

This spec defines the central orchestration contract layer for Mentiko tasks.
It converts task/run/decision facts into explicit lifecycle transitions and
effects. Existing routes, reconcile loops, completion audit, decision handling,
watcher, watchdog, and monitor code must use this layer instead of each owning
partial lifecycle rules.

## Goal

Create one reducer-owned task lifecycle state machine:

```txt
idle
  -> analyzing
  -> chain_ready
  -> executing
  -> retrying
  -> summarizing
  -> decision_blocked
  -> followup_blocked
  -> resuming
  -> closing
  -> closed
```

The reducer does not run chains, write files, mutate SQLite, or call APIs. It
only returns:

- next lifecycle state
- explicit effects the service layer must apply

## Files

Target module:

```txt
web/lib/orchestration/
  task-lifecycle-types.ts
  task-lifecycle-reducer.ts
  task-lifecycle-service.ts
  __tests__/task-lifecycle-reducer.test.ts
  __tests__/task-lifecycle-service.test.ts
```

## State

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
```

## Events

```ts
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
```

## Effects

```ts
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
```

## Reducer rules

### Auto-run eligibility

`task.auto_run_tick` may start only one preparation or execution effect:

- not open -> no effects
- blocked -> no effects
- auto-run disabled -> no effects
- no chain/recommendation/generation -> `start_analysis`
- recommendation requires generation -> `start_chain_generation`
- generated/assigned chain exists -> `start_execution`

### Execution failure

`execution.failed` must never start outcome summary while retry budget remains.

Rules:

- if `nonRetryable === true` -> `start_outcome_summary`
- else if `retryCount + 1 < retryBudget` -> `retry_execution`
- else -> `start_outcome_summary`

Default retry budget is `MIN_EXECUTION_RETRIES_BEFORE_SUMMARY`.

### Execution success

`execution.completed` always starts outcome summary for the completed
implementation run, unless a summary for the same source run fingerprint already
exists.

### Summary verdicts

- `close` -> `close_task`, then `scan_unblocked_auto_run_tasks`
- `retry` -> if retry budget remains, `retry_execution`; otherwise
  `create_decision_gate`
- `decision` -> `create_decision_gate`

### Decision gates

Decision gates are hard blockers.

When a decision gate is created:

- phase becomes `decision_blocked`
- original task is blocked on the decision task
- parent metadata points at exactly one live decision task
- duplicate live decision gates for the same task/source run/fingerprint are
  forbidden

### Decision resolution

When a decision resolves:

- if follow-up tasks exist, original task depends on them and phase becomes
  `followup_blocked`
- if no follow-up tasks exist, original task resumes

When follow-ups complete:

- clear decision-required state
- phase becomes `resuming`
- emit `resume_original_task`

### Delete

Deleting a decision must clear lifecycle gate state.

Effects:

- delete linked decision entity through `deleteDecisionEntity`
- clear parent task decision pointers
- remove stale blocked-by references
- if no live decision/follow-up blockers remain, original task returns to
  `idle` or `resuming` depending on pending execution state

## Integration boundaries

The reducer is the only place that decides transitions.

Allowed adapters:

- `auto-run` reports `task.auto_run_tick`
- `reconcile` reports execution terminal events
- `jobs/[id]/complete` reports summary verdicts
- `decision-resolution` reports decision resolution/follow-up creation
- `deleteDecisionEntity` reports decision deletion cleanup
- watcher, watchdog, and monitor report runtime facts only

Not allowed:

- reconcile directly starting summaries for retryable failures
- completion audit creating duplicate gates without reducer/idempotency
- decision routes deleting only JSON files
- UI filters deciding lifecycle truth
- monitor/watchdog diagnostics being treated as implementation success

## Migration rule

Migrate by adapter, not by rewriting the runner:

1. add reducer/types/tests
2. add service wrapper that maps effects to existing functions
3. route reconcile failed/stopped decisions through reducer
4. route summary verdict handling through reducer
5. route decision resolution/deletion through reducer
6. remove legacy duplicated transition checks after tests prove parity

