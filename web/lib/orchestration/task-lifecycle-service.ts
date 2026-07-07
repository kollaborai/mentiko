// Lifecycle service adapter (Task 3, Steps 2-4).
//
// applyLifecycleEvent(state, event, context, deps) reduces the event (pure) and
// then applies each returned effect through INJECTED dependency functions. The
// dependencies are typed to their intended real service signatures but are NOT
// imported here — they are injected so the adapter is unit-testable with mocks and
// stays free of DB / ESM side effects. Real wiring (reconcile, jobs/complete,
// decision routes) happens in Tasks 4-8.
//
// The "pure" boundary stops at the reducer (M5): effect application needs a live
// `Request` (startTaskOutcomeAudit and the decision/research path both require
// one), threaded through LifecycleAdapterContext.

import { reduceTaskLifecycle } from "./task-lifecycle-reducer";
import type {
  TaskLifecycleEffect,
  TaskLifecycleEvent,
  TaskLifecycleState,
  TaskLifecycleTransition,
} from "./task-lifecycle-types";

// ---------------------------------------------------------------------------
// Injected dependency signatures (mirror the real functions; see file:line refs)
// ---------------------------------------------------------------------------

/**
 * start_outcome_summary → startTaskOutcomeAudit (lib/tasks/task-outcome-audit.ts:43).
 * EXTENDED per plan Task 3 Step 3: the effect's `sourceRunId` + `runFingerprint`
 * are AUTHORITATIVE — startTaskOutcomeAudit must accept them instead of silently
 * replacing them with metadata.last_run_id.
 */
export interface StartOutcomeSummaryInput {
  request: Request;
  namespaceId: string;
  orgId: string;
  taskId: string;
  sourceRunId: string;
  runFingerprint: string;
  userId?: string;
}
export type StartOutcomeSummaryFn = (input: StartOutcomeSummaryInput) => Promise<unknown>;

/**
 * create_decision_gate → createTaskDecision (lib/tasks/task-decision-link.ts:30),
 * which already accepts sourceRunId + runFingerprint. Routed through the
 * completion-audit decision path in Task 6.
 */
export interface CreateDecisionGateInput {
  request: Request;
  namespaceId: string;
  orgId: string;
  taskId: string;
  sourceRunId: string;
  runFingerprint: string;
  workspacePath?: string;
}
export type CreateDecisionGateFn = (input: CreateDecisionGateInput) => Promise<unknown>;

/**
 * block_on_decision AND create_followup_dependencies → taskAddDep
 * (lib/tasks/task-store.ts:557): (orgId, taskId, dependsOnId, namespaceId?, workspaceId?).
 */
export type AddDependencyFn = (
  orgId: string,
  taskId: string,
  dependsOnId: string,
  namespaceId?: string,
  workspaceId?: string,
) => void;

/**
 * resume_original_task → clear last_run_decision_required and let the auto-run
 * poller resume the original task (net-new in Task 8's decision-resolution rules).
 */
export interface ResumeOriginalTaskInput {
  request: Request;
  orgId: string;
  taskId: string;
  namespaceId?: string;
  workspaceId?: string;
}
export type ResumeOriginalTaskFn = (input: ResumeOriginalTaskInput) => void | Promise<void>;

/** close_task → taskClose (lib/tasks/task-store.ts:528): (orgId, id, reason?, namespaceId?). */
export type CloseTaskFn = (orgId: string, id: string, reason: string | undefined, namespaceId?: string) => void;

/**
 * clear_decision_gate → deleteDecisionEntity (lib/decisions/decision-entity.ts,
 * created in Task 7): (namespaceId, orgId, decisionId, workspacePath).
 */
export interface ClearDecisionGateInput {
  namespaceId: string;
  orgId: string;
  taskId: string;
  decisionTaskId?: string;
  workspacePath?: string;
}
export type ClearDecisionGateFn = (input: ClearDecisionGateInput) => void | Promise<void>;

/**
 * scan_unblocked_auto_run_tasks → getAutoRunCandidates + start path
 * (lib/runs/auto-run.ts:232), or a nudge to the existing 60s poller.
 */
export type ScanUnblockedAutoRunFn = (orgId: string, workspaceId?: string, namespaceId?: string) => void | Promise<void>;

/**
 * retry_execution → clear last_run_id + bump execution_retries so the auto-run
 * poller re-kicks (mirrors nextExecutionRetryMetadata in execution-retry-policy.ts).
 */
export interface RetryExecutionInput {
  orgId: string;
  taskId: string;
  namespaceId?: string;
  previousRunId: string;
  reason: string;
}
export type RetryExecutionFn = (input: RetryExecutionInput) => void | Promise<void>;

export interface LifecycleEffectDeps {
  startOutcomeSummary: StartOutcomeSummaryFn;
  createDecisionGate: CreateDecisionGateFn;
  blockOnDecision: AddDependencyFn;
  createFollowupDependencies: AddDependencyFn;
  resumeOriginalTask: ResumeOriginalTaskFn;
  closeTask: CloseTaskFn;
  clearDecisionGate: ClearDecisionGateFn;
  scanUnblockedAutoRunTasks: ScanUnblockedAutoRunFn;
  retryExecution: RetryExecutionFn;
}

export interface LifecycleAdapterContext {
  request: Request;
  namespaceId: string;
  orgId: string;
  workspaceId?: string;
  workspacePath?: string;
  /** Optional reason passthrough for close_task. */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Effect application
// ---------------------------------------------------------------------------

async function applyEffect(
  effect: TaskLifecycleEffect,
  ctx: LifecycleAdapterContext,
  deps: LifecycleEffectDeps,
): Promise<void> {
  switch (effect.type) {
    case "retry_execution":
      await deps.retryExecution({
        orgId: ctx.orgId,
        taskId: effect.taskId,
        namespaceId: ctx.namespaceId,
        previousRunId: effect.previousRunId,
        reason: effect.reason,
      });
      return;

    case "start_outcome_summary":
      // Authoritative: pass the effect's source run + fingerprint verbatim.
      await deps.startOutcomeSummary({
        request: ctx.request,
        namespaceId: ctx.namespaceId,
        orgId: ctx.orgId,
        taskId: effect.taskId,
        sourceRunId: effect.sourceRunId,
        runFingerprint: effect.fingerprint,
      });
      return;

    case "create_decision_gate":
      await deps.createDecisionGate({
        request: ctx.request,
        namespaceId: ctx.namespaceId,
        orgId: ctx.orgId,
        taskId: effect.taskId,
        sourceRunId: effect.sourceRunId,
        runFingerprint: effect.fingerprint,
        workspacePath: ctx.workspacePath,
      });
      return;

    case "block_on_decision":
      await deps.blockOnDecision(ctx.orgId, effect.taskId, effect.decisionTaskId, ctx.namespaceId, ctx.workspaceId);
      return;

    case "create_followup_dependencies":
      for (const followUpTaskId of effect.followUpTaskIds) {
        await deps.createFollowupDependencies(ctx.orgId, effect.taskId, followUpTaskId, ctx.namespaceId, ctx.workspaceId);
      }
      return;

    case "resume_original_task":
      await deps.resumeOriginalTask({
        request: ctx.request,
        orgId: ctx.orgId,
        taskId: effect.taskId,
        namespaceId: ctx.namespaceId,
        workspaceId: ctx.workspaceId,
      });
      return;

    case "close_task":
      await deps.closeTask(ctx.orgId, effect.taskId, ctx.reason, ctx.namespaceId);
      return;

    case "clear_decision_gate":
      await deps.clearDecisionGate({
        namespaceId: ctx.namespaceId,
        orgId: ctx.orgId,
        taskId: effect.taskId,
        decisionTaskId: effect.decisionTaskId,
        workspacePath: ctx.workspacePath,
      });
      return;

    case "scan_unblocked_auto_run_tasks":
      await deps.scanUnblockedAutoRunTasks(ctx.orgId, ctx.workspaceId, ctx.namespaceId);
      return;

    // Reserved for a future task.auto_run_tick consolidation (C8). The reducer
    // never emits these in v1; no-op keeps the switch exhaustive.
    case "start_analysis":
    case "start_chain_generation":
    case "start_execution":
      return;

    default: {
      const _exhaustive: never = effect;
      void _exhaustive;
      return;
    }
  }
}

/**
 * Reduce an event against the hydrated state and apply the resulting effects.
 * Returns the reduced transition (next state + effects) so the caller can persist
 * the new lifecycle_phase / metadata.
 */
export async function applyLifecycleEvent(args: {
  state: TaskLifecycleState;
  event: TaskLifecycleEvent;
  context: LifecycleAdapterContext;
  deps: LifecycleEffectDeps;
}): Promise<TaskLifecycleTransition> {
  const { state, event, context, deps } = args;
  const transition = reduceTaskLifecycle(state, event);
  for (const effect of transition.effects) {
    await applyEffect(effect, context, deps);
  }
  return transition;
}
