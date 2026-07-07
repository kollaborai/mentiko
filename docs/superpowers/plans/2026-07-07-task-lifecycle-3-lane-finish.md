# Task Lifecycle 3-Lane Finish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the task lifecycle reducer migration so runtime task state, retries, summaries, decisions, deletes, and follow-up unblocking flow through one reducer-owned contract fed by truthful execution facts.

**Architecture:** Run three bounded lanes in parallel only where write sets are disjoint, then integrate in strict order: producer truth first, reducer/adapters second, decision lifecycle third. The reducer remains pure; routes and services hydrate current task metadata, reduce explicit events, apply typed effects, and persist resulting lifecycle metadata.

**Tech Stack:** TypeScript, Next.js route handlers, Jest, SQLite task store, runner-v2 completion/event files, existing Mentiko task/run/decision services.

---

## Lane Ownership

### Lane A: Runner-v2 Producer Truth

**Owns:**
- `web/lib/runner-v2/completion-runner.ts`
- `web/lib/runner-v2/completion-entrypoint.ts`
- `web/lib/runner-v2/completion.ts`
- `web/lib/runner-v2/completion-recovery.ts`
- `web/lib/runner-v2/__tests__/completion-late-event.test.ts`

**Invariant:** the reducer can only consume `execution.completed` / `execution.failed` after runner-v2 stops lying about slow but alive agents.

**Required behavior:**
- A valid late completion event recovers a failed/stopped no-event attempt before reconcile treats it as terminal failure.
- Event matching includes the project/namespace events directory even when `runDir/events` does not exist.
- No-event exhaustion is liveness-aware and bounded: live plus output-changing is not failed yet; dead plus no event can fail; live-but-silent has a max grace.

**Acceptance command:**
```bash
cd /Users/malmazan/dev/platform/mentiko/web
npm test -- --runTestsByPath lib/runner-v2/__tests__/completion-late-event.test.ts --runInBand
```

### Lane B: Reducer Keying + Reconcile and Summary Adapters

**Owns:**
- `web/lib/orchestration/task-lifecycle-types.ts`
- `web/lib/orchestration/task-lifecycle-reducer.ts`
- `web/lib/orchestration/task-lifecycle-hydrate.ts`
- `web/lib/orchestration/task-lifecycle-service.ts`
- `web/lib/orchestration/__tests__/task-lifecycle-reducer.test.ts`
- `web/lib/orchestration/__tests__/task-lifecycle-service.test.ts`
- `web/app/api/tasks/reconcile/route.ts`
- `web/app/api/tasks/reconcile/route.test.ts`
- `web/lib/tasks/task-outcome-audit.ts`
- `web/lib/tasks/task-outcome-audit.test.ts`
- `web/app/api/tasks/[id]/outcome-summary/route.ts`
- `web/app/api/tasks/[id]/outcome-summary/route.test.ts`

**Invariant:** idempotency is per source run terminal state, not per raw fingerprint string.

**Required behavior:**
- Store and hydrate reducer dedupe keys as run-scoped terminal keys, not fingerprint-only values.
- Different `runId` values with the same low-information fingerprint such as `failed:no-terminal-time` do not no-op.
- `start_outcome_summary` passes explicit `sourceRunId` and `runFingerprint`; `startTaskOutcomeAudit` honors those when provided.
- Reconcile emits reducer events for terminal execution runs:
  - completed -> `execution.completed`
  - failed/stopped/deleted/unknown/cancelled -> `execution.failed`
  - retryable under budget -> retry before summary
  - exhausted/nonretryable -> summary
- Manual outcome summary rejects or defers retryable failed/stopped runs while execution retries remain.

**Acceptance command:**
```bash
cd /Users/malmazan/dev/platform/mentiko/web
npm test -- --runTestsByPath \
  lib/orchestration/__tests__/task-lifecycle-reducer.test.ts \
  lib/orchestration/__tests__/task-lifecycle-service.test.ts \
  app/api/tasks/reconcile/route.test.ts \
  'app/api/tasks/[id]/outcome-summary/route.test.ts' \
  lib/tasks/task-outcome-audit.test.ts \
  --runInBand
```

### Lane C: Completion Verdicts + Decision Lifecycle

**Owns:**
- `web/lib/tasks/completion-audit-apply.ts`
- `web/lib/tasks/completion-audit-apply.test.ts`
- `web/lib/tasks/task-decision-link.ts`
- `web/lib/tasks/task-decision-link.test.ts`
- `web/lib/decisions/decision-resolution.ts`
- `web/lib/decisions/decision-resolution.test.ts`
- `web/lib/decisions/decision-entity.ts`
- `web/app/api/decisions/[id]/route.ts`
- `web/app/api/decisions/[id]/route.test.ts`
- `web/app/api/tasks/reconcile/route.ts` only for follow-up completion detection
- `web/app/api/tasks/reconcile/route.test.ts` only for follow-up completion detection

**Invariant:** decision gates are hard blockers with exactly one live gate per source run, and resolution/delete must clear or replace those blockers explicitly.

**Required behavior:**
- Completion audit verdicts route through lifecycle semantics:
  - close -> close parent and scan unblocked tasks
  - retry -> increment shared execution retry counter, bounded at 2
  - decision -> create/reuse exactly one live gate
- Decision gate creation is production-atomic: create/reuse decision task, block parent, persist `decision_subtask_id`, `last_run_decision_required`, gated key, and lifecycle phase.
- Decision resolution uses `decision.parentTaskId` as the original task, not the epic ancestor.
- Resolution with follow-ups blocks the original task on follow-ups and persists `followup_task_ids`.
- Resolution with no follow-ups clears decision-required state and resumes the original task.
- Reconcile detects all follow-ups closed/resolved/done/complete before applying `followups.completed`.
- Decision delete cleanup removes JSON plus linked decision task, clears parent pointers, prunes stale arrays, clears decision-required when no live gate remains, and is idempotent.

**Acceptance command:**
```bash
cd /Users/malmazan/dev/platform/mentiko/web
npm test -- --runTestsByPath \
  lib/tasks/completion-audit-apply.test.ts \
  lib/tasks/task-decision-link.test.ts \
  lib/decisions/decision-resolution.test.ts \
  'app/api/decisions/[id]/route.test.ts' \
  app/api/tasks/reconcile/route.test.ts \
  --runInBand
```

## Integration Order

- [ ] **Step 1: land Lane A first**

Run Lane A tests. Confirm reconcile has a truthful producer before trusting terminal facts.

- [ ] **Step 2: integrate Lane B**

Resolve any overlap in `web/app/api/tasks/reconcile/route.ts` after Lane A. Run Lane B acceptance command. Confirm the reducer no longer has fingerprint-only stale dedupe.

- [ ] **Step 3: integrate Lane C**

Resolve the narrow overlap in `web/app/api/tasks/reconcile/route.ts` after Lane B. Run Lane C acceptance command. Confirm decisions and follow-ups persist reducer-owned lifecycle metadata.

- [ ] **Step 4: run combined targeted suite**

```bash
cd /Users/malmazan/dev/platform/mentiko/web
npm test -- --runTestsByPath \
  lib/runner-v2/__tests__/completion-late-event.test.ts \
  lib/orchestration/__tests__/task-lifecycle-reducer.test.ts \
  lib/orchestration/__tests__/task-lifecycle-service.test.ts \
  app/api/tasks/reconcile/route.test.ts \
  'app/api/tasks/[id]/outcome-summary/route.test.ts' \
  lib/tasks/task-outcome-audit.test.ts \
  lib/tasks/completion-audit-apply.test.ts \
  lib/tasks/task-decision-link.test.ts \
  lib/decisions/decision-resolution.test.ts \
  'app/api/decisions/[id]/route.test.ts' \
  --runInBand
```

- [ ] **Step 5: static checks**

```bash
cd /Users/malmazan/dev/platform/mentiko/web
npx eslint \
  lib/runner-v2 \
  lib/orchestration \
  app/api/tasks/reconcile/route.ts \
  'app/api/tasks/[id]/outcome-summary/route.ts' \
  lib/tasks/task-outcome-audit.ts \
  lib/tasks/completion-audit-apply.ts \
  lib/tasks/task-decision-link.ts \
  lib/decisions/decision-resolution.ts \
  lib/decisions/decision-entity.ts \
  'app/api/decisions/[id]/route.ts'
npx tsc --noEmit --pretty false
git diff --check
```

- [ ] **Step 6: runtime proof**

Use the existing `mentiko-dev` process. Do not start a second dev server.

```bash
tmux ls | rg 'mentiko-dev'
curl -sS http://localhost:3000/api/health || true
```

Then prove these live cases against task metadata and run artifacts:
- retryable failed execution under budget schedules retry and does not start summary
- exhausted failed execution starts outcome summary
- completed execution starts outcome summary for the exact source run
- close verdict closes parent and scans unblocked tasks
- decision verdict creates one live gate and blocks parent
- decision resolution with follow-ups blocks original until all follow-ups close
- decision delete clears gate pointers and does not leave a decorative blocked state

## Stop Conditions

Stop and report instead of forcing through if:
- runner-v2 still produces false `execution.failed` for a valid late completion event
- reducer effects cannot be persisted without changing task-store APIs
- two lanes require conflicting ownership of the same route beyond the documented reconcile overlap
- targeted tests pass but runtime task metadata contradicts run artifacts

