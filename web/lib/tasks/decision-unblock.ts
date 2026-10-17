// FEAT-001 stall class: reconcile a decision_blocked task off its LINKED
// DECISION state, not its anchored run.
//
// The task-reconciler's terminal-run sweep replays only the lifecycle of the
// anchored run. When that run is already terminal AND handled, the sweep logs
// "lifecycle no-op" and never inspects the decision the task is parked
// behind. If the linked decision resolved out-of-band — a user approval whose
// lifecycle pass failed to persist, or a completion-audit gate whose release
// was lost — the task sits in decision_blocked forever while the decision
// store says approved.
//
// This module mirrors the live approval path (decision-resolution.ts):
// detect the resolved decision, feed the reducer's decision.resolved
// transition, and persist the result in ONE taskUpdate. It is deliberately
// idempotent — the reconciler fires repeatedly, so a second pass after an
// unblock must be a clean no-op. Layered guards:
//   1. the sweep filter only selects lifecycle_phase === "decision_blocked";
//      the reducer moves the task off that phase (resuming/followup_blocked)
//      and the post-write phase re-check rejects any second application
//   2. inside the decision resolution lock the task is re-read and both the
//      phase and the decision state are re-checked before reducing
//   3. on resume, decision_gate_released_run_id stamps WHICH run's gate is
//      spent, so the provenance-repair sweep never re-applies the audited
//      verdict (W3)

import {
  getDecision,
  withDecisionResolutionLock,
} from "@/lib/decisions/decision-storage";
import { taskAddDep, taskGet, taskUpdate } from "@/lib/tasks/task-store";
import {
  applyLifecycleEvent,
  type LifecycleEffectDeps,
} from "@/lib/orchestration/task-lifecycle-service";
import { hydrateLifecycleState } from "@/lib/orchestration/task-lifecycle-hydrate";
import type { TaskLifecycleState } from "@/lib/orchestration/task-lifecycle-types";
import { releaseDecisionGateMetadata } from "@/lib/tasks/decision-gate-release";
import { triggerAutoRunScan } from "@/lib/runs/auto-run-service";

/** Decision store statuses that mean the linked decision can no longer block. */
const RESOLVED_DECISION_STATUSES = new Set(["approved", "in_progress", "done"]);

export interface LinkedDecisionSignal {
  decisionId?: string;
  decisionTaskId?: string;
  followUpTaskIds: string[];
  sourceRunId: string;
}

export type UnblockTaskOutcome =
  | { outcome: "noop"; reason: string }
  | {
      outcome: "released";
      phase: TaskLifecycleState["phase"];
      decisionId?: string;
      followUpTaskIds: string[];
    };

export interface UnblockTaskInput {
  request: Request;
  namespaceId: string;
  orgId: string;
  workspaceId?: string;
  workspacePath?: string;
  taskId: string;
  metadata: Record<string, unknown>;
}

/** Parse task metadata that may be an object or a JSON string blob. */
function toRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Read the linked decision pointer from task metadata and report whether it
 * has resolved. Two independent signals, either of which proves resolution:
 *   - the decision store's own status (authoritative), or
 *   - the decision subtask's decision_status mirror, written synchronously by
 *     the live approval flow before the lifecycle pass (survives a lost or
 *     failed store write).
 */
export function readLinkedDecisionSignal(input: {
  namespaceId: string;
  orgId: string;
  workspacePath?: string;
  metadata: Record<string, unknown>;
}): LinkedDecisionSignal | undefined {
  const meta = input.metadata;
  const decisionTaskId = stringOrUndefined(meta.decision_subtask_id);
  let decisionId = stringOrUndefined(meta.decision_id);

  // The decision subtask is the durable pointer for completion-audit gates;
  // it carries the decision id and the audited source run even when the
  // parent task's own metadata does not.
  let subtaskResolved = false;
  if (decisionTaskId) {
    const subtask = taskGet(input.orgId, decisionTaskId, input.namespaceId);
    const subMeta = toRecord(subtask?.metadata);
    if (!decisionId) decisionId = stringOrUndefined(subMeta.decision_id);
    subtaskResolved = subMeta.decision_status === "approved";
  }
  if (!decisionId && !decisionTaskId) return undefined;

  const decision = decisionId
    ? getDecision(input.namespaceId, input.orgId, decisionId, input.workspacePath)
    : null;
  const storeResolved = !!decision && RESOLVED_DECISION_STATUSES.has(decision.status);
  if (!storeResolved && !subtaskResolved) return undefined;

  // Follow-ups are the plan tasks the decision spawned (decision.resolution),
  // minus the decision subtask itself and the epic/parent container that
  // received them. Mirrors the live resolution flow's followUpTaskIds so the
  // reducer parks the task behind exactly the tasks that must complete.
  const resolution = decision?.resolution;
  const resolutionTaskIds = Array.isArray(resolution?.taskIds) ? resolution.taskIds : [];
  const epicId = resolution?.taskId;
  const followUpTaskIds = Array.from(new Set(
    resolutionTaskIds.filter((id): id is string =>
      typeof id === "string" && id.length > 0 && id !== decisionTaskId && id !== epicId),
  ));

  // The run whose decision gate is spent: the anchored execution run, else
  // the audited run. Same preference order as the live approval path.
  const sourceRunId = stringOrUndefined(meta.last_run_id)
    ?? stringOrUndefined(meta.completion_audit_run_id)
    ?? "";

  return {
    ...(decisionId ? { decisionId } : {}),
    ...(decisionTaskId ? { decisionTaskId } : {}),
    followUpTaskIds,
    sourceRunId,
  };
}

function lifecycleMetadataAfterResolution(
  state: TaskLifecycleState,
  current: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...current,
    lifecycle_phase: state.phase,
    execution_retries: state.executionRetryCount,
    gated_run_fingerprints: state.gatedFingerprints,
    summarized_run_fingerprints: state.summarizedFingerprints,
    followup_task_ids: state.followUpTaskIds,
    decision_subtask_id: state.decisionTaskId,
    last_run_decision_required: state.phase === "followup_blocked" || state.phase === "decision_blocked",
  };
}

function makeUnblockDeps(input: UnblockTaskInput): LifecycleEffectDeps {
  return {
    startOutcomeSummary: async () => undefined,
    createDecisionGate: async () => undefined,
    blockOnDecision: () => undefined,
    createFollowupDependencies: (depOrgId, taskId, followUpTaskId, depNamespaceId, depWorkspaceId) => {
      taskAddDep(depOrgId, taskId, followUpTaskId, depNamespaceId, depWorkspaceId);
    },
    resumeOriginalTask: () => undefined,
    closeTask: () => undefined,
    clearDecisionGate: () => undefined,
    // Surgical dependents-only nudge: the parent task just moved, so scan ONLY
    // its direct dependents, fire-and-forget. Mirrors the live resolution path.
    scanUnblockedAutoRunTasks: () => { void triggerAutoRunScan(input.namespaceId, input.orgId, input.taskId); },
    retryExecution: async () => undefined,
  };
}

/**
 * If the task's linked decision has resolved but the task is still parked in
 * decision_blocked, advance the lifecycle via the reducer's decision.resolved
 * transition and persist the result. Otherwise report a clean no-op.
 */
export async function unblockTaskViaResolvedDecision(
  input: UnblockTaskInput,
): Promise<UnblockTaskOutcome> {
  const readFreshMeta = () => {
    const fresh = taskGet(input.orgId, input.taskId, input.namespaceId);
    return toRecord(fresh?.metadata ?? input.metadata);
  };
  const phaseOf = (meta: Record<string, unknown>) => stringOrUndefined(meta.lifecycle_phase);
  const readSignal = (meta: Record<string, unknown>) =>
    readLinkedDecisionSignal({
      namespaceId: input.namespaceId,
      orgId: input.orgId,
      workspacePath: input.workspacePath,
      metadata: meta,
    });

  let meta = readFreshMeta();
  if (phaseOf(meta) !== "decision_blocked") {
    return { outcome: "noop", reason: "task lifecycle is no longer decision_blocked" };
  }
  let signal = readSignal(meta);
  if (!signal) {
    return { outcome: "noop", reason: "linked decision is not resolved" };
  }

  const apply = async (): Promise<UnblockTaskOutcome> => {
    // Another request (a racing reconcile, or the live approval flow) may
    // have moved the task while we waited for the resolution lock. Re-check
    // BOTH the phase and the decision state before reducing.
    meta = readFreshMeta();
    if (phaseOf(meta) !== "decision_blocked") {
      return { outcome: "noop", reason: "task lifecycle is no longer decision_blocked" };
    }
    signal = readSignal(meta);
    if (!signal) {
      return { outcome: "noop", reason: "linked decision is not resolved" };
    }

    const state = hydrateLifecycleState(input.taskId, meta);
    const transition = await applyLifecycleEvent({
      state,
      event: {
        type: "decision.resolved",
        taskId: input.taskId,
        decisionTaskId: signal.decisionTaskId ?? state.decisionTaskId ?? input.taskId,
        followUpTaskIds: signal.followUpTaskIds,
      },
      context: {
        request: input.request,
        namespaceId: input.namespaceId,
        orgId: input.orgId,
        workspaceId: input.workspaceId,
        workspacePath: input.workspacePath,
      },
      deps: makeUnblockDeps(input),
    });
    const status = transition.state.phase === "followup_blocked" ? "blocked" : "open";
    const resolvedMetadata = lifecycleMetadataAfterResolution(transition.state, meta);
    // Mirror the live approval path: once the task is resuming, the finished
    // run's bookkeeping is spent — release scope, run pointers, and gate in
    // one write, and record WHICH run's gate is spent so the provenance-repair
    // sweep never re-applies the audited verdict (W3).
    const metadata = transition.state.phase === "resuming" && signal.sourceRunId
      ? releaseDecisionGateMetadata(resolvedMetadata, { taskId: input.taskId, sourceRunId: signal.sourceRunId })
      : resolvedMetadata;
    taskUpdate(input.orgId, input.taskId, { status, metadata }, input.namespaceId);
    return {
      outcome: "released",
      phase: transition.state.phase,
      ...(signal.decisionId ? { decisionId: signal.decisionId } : {}),
      followUpTaskIds: signal.followUpTaskIds,
    };
  };

  // Serialize against the live approval flow for the same decision; without a
  // decision id the lock cannot name a key, and apply()'s re-check is the
  // remaining guard.
  return signal.decisionId
    ? withDecisionResolutionLock(input.namespaceId, input.orgId, signal.decisionId, input.workspacePath, apply)
    : apply();
}
