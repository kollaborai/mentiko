# Task lifecycle reducer spec

This spec defines the central orchestration contract layer for Mentiko tasks.
It converts task/run/decision facts into explicit lifecycle transitions and
effects. Existing routes, reconcile loops, completion audit, decision handling,
watcher, watchdog, and monitor code must use this layer instead of each owning
partial lifecycle rules.

**Producer dependency:** the reducer consumes `execution.completed` / `execution.failed`
facts. Those are produced by the runner-v2 completion layer and can currently be false
(a slow agent's completion event arrives after the no-event retry budget exhausts — see
the plan's Task 0). The reducer is only as truthful as the producer; fix the producer first.

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
  task-lifecycle-hydrate.ts
  task-lifecycle-service.ts
  __tests__/task-lifecycle-reducer.test.ts
  __tests__/task-lifecycle-service.test.ts
```

## State

```ts
// Budget is retries. 2 retries = 3 attempts, matching the current auditor RETRY_CAP=2 (>=).
// Do not change to 3 without a deliberate call — see the plan's C1.
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
  executionRetryCount: number;       // metadata.execution_retries — NOT auto_run_retries
  retryBudget: number;               // default MAX_EXECUTION_RETRIES_BEFORE_SUMMARY (2)
  summarizedFingerprints: string[];  // set-based dedup; a single field cannot enforce it
  gatedFingerprints: string[];
  decisionTaskId?: string;
  followUpTaskIds: string[];
  blockedByTaskIds: string[];
  lastError?: string;
}
```

## State hydration

The reducer is pure; it never reads storage. Every adapter entry point builds the current
`TaskLifecycleState` from task metadata via `hydrateLifecycleState(taskMetadata)` before
reducing:

- `execution_retries -> executionRetryCount` (new metadata key, distinct from `auto_run_retries`,
  which is also incremented on generation/analysis failures)
- `last_run_id -> currentRunId`, `last_run_status -> currentRunStatus`
- `last_run_decision_required` / `decision_subtask_id -> decisionTaskId`
- `summarized_run_fingerprints -> summarizedFingerprints`
- `gated_run_fingerprints -> gatedFingerprints`
- legacy single fields `completion_audit_run_fingerprint` and
  `task_outcome_summary_run_fingerprint` hydrate into `summarizedFingerprints`
  as compatibility fallback only

Without hydration, each call rebuilds a near-default state (`executionRetryCount = 0`, empty
fingerprint sets) and every capping/dedup guarantee silently voids in production despite green
unit tests. An already-stuck task (open, prior terminal runs) must hydrate to a sane phase.

Persisted metadata keys:

- `execution_retries: number`
- `summarized_run_fingerprints: string[]`
- `gated_run_fingerprints: string[]`
- `decision_subtask_id: string`
- `followup_task_ids: string[]`
- `lifecycle_phase: TaskLifecyclePhase`

## Events

```ts
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
  // task.auto_run_tick is dropped from v1 (C8): admission stays in reconcile/auto-run; the
  // reducer owns the post-execution lifecycle and enters at execution.started.
```

Every event above has an explicit transition (below). No declared event is left unhandled,
and no phase is declared that some event cannot reach.

## Effects

```ts
export type TaskLifecycleEffect =
  | { type: "start_analysis"; taskId: string }              // reserved for future auto_run_tick
  | { type: "start_chain_generation"; taskId: string }      // reserved for future auto_run_tick
  | { type: "start_execution"; taskId: string; chainId: string } // reserved for future auto_run_tick
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

### Execution admission (external in v1)

Admission — analysis, chain generation, execution start — stays in `auto-run`/`reconcile`
for v1. The real `triggerAutoRun` already owns resume-vs-restart, in-flight-job guards, and
the concurrency ceiling; re-deriving that in the reducer now is divergent duplication, not
consolidation. The reducer enters the lifecycle at `execution.started`. `start_analysis`,
`start_chain_generation`, and `start_execution` are reserved effects for a future
`task.auto_run_tick` consolidation and are not emitted in v1.

### Execution started

`execution.started` -> phase `executing`; set `currentRunId`, `currentRunStatus = "running"`,
`chainId`. No-op if `currentRunStatus === "running"` already (concurrency guard — two
admissions must not produce two live runs on one id).

`execution.started` does **not** reset `executionRetryCount` for retry attempts in the same
lifecycle episode. Reset happens only when starting a new execution series for a task that is
not currently retrying/resuming from the same source failure. Otherwise every retry start would
erase the counter and the retry budget would never exhaust.

### Execution failure

`execution.failed` must never start outcome summary while retry budget remains, and must be
idempotent (reconcile re-polls the same terminal run — dedup on `(runId, fingerprint)`).

Rules:

- already handled this `(runId, fingerprint)` -> no effects
- if `nonRetryable === true` -> `start_outcome_summary`
- else if `executionRetryCount < retryBudget` -> increment `executionRetryCount`, phase
  `retrying`, `retry_execution`
- else -> phase `summarizing`, `start_outcome_summary`

Default retry budget is `MAX_EXECUTION_RETRIES_BEFORE_SUMMARY` (2 retries; escalate on the 3rd
failure), matching the current auditor `RETRY_CAP = 2`. The SAME operator governs the
summary-retry path below, so the two never diverge.

### Execution success

`execution.completed` starts outcome summary for the completed implementation run, unless
`fingerprint` is already in `summarizedFingerprints`. On starting, add `fingerprint` to
`summarizedFingerprints` and set phase `summarizing`.

The `start_outcome_summary` effect is authoritative: its `sourceRunId` and `fingerprint` must be
passed to the outcome-audit service. The service must not silently replace them with
`metadata.last_run_id` if the effect explicitly names a source run.

### Summary verdicts

- `close` -> phase `closing`, `close_task`, then `scan_unblocked_auto_run_tasks`
- `retry` -> if `executionRetryCount < retryBudget`, **increment `executionRetryCount`** then
  `retry_execution`; otherwise `create_decision_gate`. Incrementing is mandatory — without it a
  repeated `retry` verdict loops forever, since nothing else advances the counter on the
  success path.
- `decision` -> `create_decision_gate`

`create_decision_gate` adds the source-run `fingerprint` to `gatedFingerprints` in the same
transition; a later verdict/event carrying the same fingerprint reuses the existing gate.

### Pre-execution phase tracking

- `analysis.completed` -> phase `chain_ready` (or `analyzing` stays until generation, if
  `requiresGeneration`)
- `chain.generated` -> phase `chain_ready`; set `chainId`
- `task.closed` -> phase `closed`

### Decision gates

Decision gates are hard blockers.

When a decision gate is created:

- phase becomes `decision_blocked`
- the source-run `fingerprint` is recorded in `gatedFingerprints` in the same transition
- original task is blocked on the decision task (`block_on_decision`, emitted once
  `decision.created` backfills the `decisionTaskId`)
- parent metadata points at exactly one live decision task
- duplicate live decision gates for the same task/source-run/fingerprint are forbidden
  (enforced by `gatedFingerprints`, not by a single field)

### Decision resolution

When a decision resolves:

- if follow-up tasks exist, original task depends on them (`create_followup_dependencies`)
  and phase becomes `followup_blocked`
- if no follow-up tasks exist, phase becomes `resuming` and emit `resume_original_task`
  (+ `scan_unblocked_auto_run_tasks`). Do not leave the task without an effect — the common
  approve-and-continue case must actually resume.

When follow-ups complete:

- clear decision-required state
- phase becomes `resuming`
- emit `resume_original_task` (+ `scan_unblocked_auto_run_tasks`)

Follow-up completion detection is owned by reconcile. Reconcile scans tasks in
`followup_blocked` phase, checks `followup_task_ids`, and emits `followups.completed` only when
every follow-up task is closed/resolved/done/complete.

### Delete

Deleting a decision must clear lifecycle gate state.

Effects:

- delete linked decision entity through `deleteDecisionEntity`
- clear parent task decision pointers
- remove stale blocked-by references
- if no live decision/follow-up blockers remain, original task returns to `resuming` when
  `currentRunStatus === "running"`, otherwise `idle`

## Integration boundaries

The reducer is the only place that decides transitions.

Allowed adapters:

- `reconcile` reports execution terminal events (branches status, computes the fingerprint)
- `jobs/[id]/complete` reports summary verdicts (via `completion-audit-apply`)
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

Migrate by adapter — with one exception: the completion **producer** must be fixed first.

0. fix runner-v2 premature completion-exhaustion (false `execution.failed`; see the plan's
   Task 0). The reducer consumes execution facts; if they lie, it faithfully retries work that
   already succeeded. Everything below is gated behind this.
1. add reducer/types/hydration/tests
2. add service wrapper that maps effects to existing functions
3. route reconcile failed/stopped decisions through reducer (behavior change — reconcile
   currently hands terminals to the auditor; a test asserts that today)
4. route summary verdict handling through reducer
5. route decision resolution/deletion through reducer
6. remove legacy duplicated transition checks after tests prove parity
