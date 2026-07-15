// Dispatcher for completion-audit verdicts. Given a parsed CompletionAudit and
// the audited task, it performs the verdict's action: close the task, spawn a
// decision subtask (with research), or reopen the task for a context-injected
// retry. All actions are idempotent on the audited run id and bounded by a
// retry cap so audit-driven retries can't loop forever.

import { taskAddDep, taskClose, taskGet, taskUpdate, taskMergeMeta, taskAddComment, taskList, taskRemoveDep } from "@/lib/tasks/task-store";
import { createTaskDecision } from "@/lib/tasks/task-decision-link";
import { createNotification } from "@/lib/notifications/notification-server";
import { updateDecision } from "@/lib/decisions/decision-storage";
import { applyLifecycleEvent, type LifecycleEffectDeps } from "@/lib/orchestration/task-lifecycle-service";
import { triggerAutoRunScan } from "@/lib/runs/auto-run-service";
import { hydrateLifecycleState } from "@/lib/orchestration/task-lifecycle-hydrate";
import { reduceTaskLifecycle } from "@/lib/orchestration/task-lifecycle-reducer";
import type { TaskLifecycleState } from "@/lib/orchestration/task-lifecycle-types";
import type { TaskRecord } from "@/lib/tasks/task-store-types";
import type { CompletionAudit } from "@/lib/tasks/completion-audit-schema";

// Task statuses that count as "done". taskClose() writes "closed"; a human may
// also mark resolved/done/complete. Used to detect whether a close verdict
// actually landed before trusting completion_audit_apply_status === "applied".
const CLOSED_TASK_STATUSES = new Set(["closed", "resolved", "done", "complete"]);

export type CompletionAuditAction =
  | "closed"
  | "decision_created"
  | "retry_scheduled"
  | "escalated_decision"
  | "skipped";

export interface ApplyCompletionAuditResult {
  action: CompletionAuditAction;
  detail?: string;
  decisionTaskId?: string;
}

interface ApplyCompletionAuditInput {
  request: Request;
  namespaceId: string;
  orgId: string;
  task: TaskRecord;
  audit: CompletionAudit;
  /** The execution run that was audited. */
  runId: string;
  /** Terminal-state fingerprint for the execution run. */
  runFingerprint?: string;
  workspacePath?: string;
  /** Current parent-task metadata (already parsed). */
  metadata: Record<string, unknown>;
}

interface DecisionGateResult extends ApplyCompletionAuditResult {
  decision?: Awaited<ReturnType<typeof createTaskDecision>>["decision"];
  prompt?: string;
}

export async function supersedeStaleCompletionAuditDecision(input: {
  namespaceId: string;
  orgId: string;
  parentTask: TaskRecord;
  decisionTask: TaskRecord;
  reason: string;
  workspacePath?: string;
}): Promise<void> {
  const { namespaceId, orgId, parentTask, decisionTask, reason, workspacePath } = input;
  const decisionMetadata = decisionMeta(decisionTask);
  const parentMetadata = decisionMeta(parentTask);
  const decisionId = typeof decisionMetadata.decision_id === "string"
    ? decisionMetadata.decision_id
    : undefined;

  taskClose(orgId, decisionTask.id, reason, namespaceId);
  taskMergeMeta(orgId, decisionTask.id, {
    decision_status: "superseded",
    superseded_reason: reason,
    superseded_at: new Date().toISOString(),
  }, namespaceId);
  taskRemoveDep(orgId, parentTask.id, decisionTask.id, namespaceId);

  const nextMetadata = { ...parentMetadata };
  if (nextMetadata.decision_subtask_id === decisionTask.id) delete nextMetadata.decision_subtask_id;
  if (nextMetadata.last_decision_subtask_id === decisionTask.id) delete nextMetadata.last_decision_subtask_id;
  if (decisionId && nextMetadata.decision_id === decisionId) delete nextMetadata.decision_id;
  if (decisionId && nextMetadata.last_decision_id === decisionId) delete nextMetadata.last_decision_id;
  nextMetadata.last_run_decision_required = false;
  nextMetadata.completion_audit_apply_status = "superseded";
  nextMetadata.task_outcome_summary_status = "superseded";
  nextMetadata.last_audit_verdict = "superseded";
  nextMetadata.stale_audit_superseded_reason = reason;
  Object.assign(nextMetadata, lifecycleMetadata(hydrateLifecycleState(parentTask.id, nextMetadata)));
  nextMetadata.gated_run_fingerprints = [];
  nextMetadata.superseded_decision_subtask_ids = Array.from(new Set([
    ...(Array.isArray(nextMetadata.superseded_decision_subtask_ids)
      ? nextMetadata.superseded_decision_subtask_ids.filter((id): id is string => typeof id === "string")
      : []),
    decisionTask.id,
  ]));
  if (nextMetadata.lifecycle_phase === "decision_blocked") {
    nextMetadata.lifecycle_phase = nextMetadata.last_run_status === "retry_requested" ? "retrying" : "idle";
  }
  taskUpdate(orgId, parentTask.id, {
    status: parentTask.status === "blocked" ? "open" : parentTask.status,
    metadata: nextMetadata,
  }, namespaceId);

  if (decisionId) {
    try {
      await updateDecision(namespaceId, orgId, decisionId, { status: "superseded" }, workspacePath);
    } catch (error) {
      console.error(`completion-auditor: failed to supersede stale decision ${decisionId}:`, error);
    }
  }
}

function buildDecisionPrompt(task: TaskRecord, audit: CompletionAudit): string {
  const ask = audit.decision?.prompt || audit.reason;
  const lines = [
    `A completed run for task ${task.id} (${task.title}) needs a human decision.`,
    "",
    `WHY: ${audit.reason}`,
    "",
    `DECISION NEEDED: ${ask}`,
  ];
  if (audit.decision?.options_hint) {
    lines.push("", `OPTIONS / CONTEXT: ${audit.decision.options_hint}`);
  }
  if (task.parent_id) {
    lines.push("", `PARENT/EPIC: ${task.parent_id}`);
  }
  if (task.acceptance_criteria) {
    lines.push("", `ACCEPTANCE CRITERIA:\n${task.acceptance_criteria}`);
  }
  return lines.join("\n");
}

function decisionMeta(task: TaskRecord): Record<string, unknown> {
  return task.metadata && typeof task.metadata === "object" && !Array.isArray(task.metadata)
    ? task.metadata as Record<string, unknown>
    : {};
}

function lifecycleMetadata(state: TaskLifecycleState): Record<string, unknown> {
  return {
    lifecycle_phase: state.phase,
    execution_retries: state.executionRetryCount,
    gated_run_fingerprints: state.gatedFingerprints,
    summarized_run_fingerprints: state.summarizedFingerprints,
    followup_task_ids: state.followUpTaskIds,
    decision_subtask_id: state.decisionTaskId,
  };
}

function completionTimestampFromFingerprint(runFingerprint?: string): string | undefined {
  const prefix = "completed:";
  if (!runFingerprint?.startsWith(prefix)) return undefined;
  const value = runFingerprint.slice(prefix.length);
  return value || undefined;
}

function closeExecutionMetadata(runId: string, runFingerprint?: string): Record<string, unknown> {
  return {
    last_run_id: runId,
    last_run_status: "completed",
    last_run_started: undefined,
    last_run_completed: completionTimestampFromFingerprint(runFingerprint),
    last_run_error: undefined,
    last_run_blocked_reason: undefined,
    last_run_agents: undefined,
    last_run_artifacts: undefined,
    last_run_outcome: undefined,
    last_run_summary: undefined,
    last_run_decision_required: false,
  };
}

function closeExecutionMetadataNeedsRepair(
  metadata: Record<string, unknown>,
  runId: string,
  runFingerprint?: string,
): boolean {
  const completedAt = completionTimestampFromFingerprint(runFingerprint);
  return metadata.last_run_id !== runId
    || metadata.last_run_status !== "completed"
    || metadata.last_run_started !== undefined
    || metadata.last_run_error !== undefined
    || metadata.last_run_blocked_reason !== undefined
    || metadata.last_run_agents !== undefined
    || metadata.last_run_artifacts !== undefined
    || metadata.last_run_outcome !== undefined
    || metadata.last_run_summary !== undefined
    || (completedAt ? metadata.last_run_completed !== completedAt : metadata.last_run_completed !== undefined);
}

function findExistingCompletionAuditDecisionSubtask(
  namespaceId: string,
  orgId: string,
  parentTaskId: string,
  runId: string,
  runFingerprint?: string,
): TaskRecord | null {
  const candidates = taskList(orgId, { status: "all" }, undefined, namespaceId);
  return candidates.find((candidate) => {
    if (candidate.parent_id !== parentTaskId) return false;
    if (candidate.issue_type !== "decision") return false;
    if (candidate.status === "closed") return false;
    const meta = decisionMeta(candidate);
    if (meta.decision_source !== "completion-audit") return false;
    if (meta.completion_audit_source_run_id !== runId) return false;
    return runFingerprint
      ? meta.completion_audit_run_fingerprint === runFingerprint
      : true;
  }) ?? null;
}

async function createDecisionSubtask(
  input: ApplyCompletionAuditInput,
  escalated: boolean,
): Promise<DecisionGateResult> {
  const { namespaceId, orgId, task, audit, runId, runFingerprint, workspacePath } = input;

  const existingDecisionTask = findExistingCompletionAuditDecisionSubtask(
    namespaceId,
    orgId,
    task.id,
    runId,
    runFingerprint,
  );
  if (existingDecisionTask) {
    return {
      action: "skipped",
      detail: "completion-audit decision already exists for this run",
      decisionTaskId: existingDecisionTask.id,
    };
  }

  // Claim the attempt before creating the decision, but do not set the durable
  // completion_audit_run_id until side effects exist. Otherwise a thrown
  // createTaskDecision permanently suppresses the human gate on the next sweep.
  taskMergeMeta(orgId, task.id, {
    completion_audit_claimed_run_id: runId,
    ...(runFingerprint ? { completion_audit_claimed_run_fingerprint: runFingerprint } : {}),
  }, namespaceId);

  const prompt = buildDecisionPrompt(task, audit);
  const { decision, task: decisionTask } = await createTaskDecision({
    namespaceId,
    orgId,
    prompt,
    source: "completion-audit",
    workspacePath,
    parentTaskId: task.id,
    sourceRunId: runId,
    runFingerprint,
  });

  return {
    action: escalated ? "escalated_decision" : "decision_created",
    detail: audit.reason,
    decisionTaskId: decisionTask.id,
    decision,
    prompt,
  };
}

function applyDecisionBlockSideEffects(
  input: ApplyCompletionAuditInput,
  result: DecisionGateResult,
): void {
  if (!result.decisionTaskId) return;
  taskAddDep(input.orgId, input.task.id, result.decisionTaskId, input.namespaceId, input.workspacePath);
  if (input.task.status !== "blocked") {
    taskUpdate(input.orgId, input.task.id, { status: "blocked" }, input.namespaceId);
  }
}

async function runDecisionPostPersistSideEffects(
  input: ApplyCompletionAuditInput,
  result: DecisionGateResult,
): Promise<void> {
  if (!result.decision || !result.prompt || !result.decisionTaskId) return;
  const { request, namespaceId, orgId, task, audit, runId, workspacePath } = input;

  // Best-effort: kick off research so the decision agent packages the decision
  // (clean title, brief, options) exactly like the interactive flow. We go
  // through the SAME startDecisionResearch path the research route uses — same
  // decision_research template — so auto-created decisions don't look different
  // from hand-made ones. A research failure must not block the triage.
  try {
    const { startDecisionResearch } = await import("@/lib/decisions/decision-chain-dispatch");
    await startDecisionResearch({
      request,
      namespaceId,
      orgId,
      decision: result.decision,
      userPrompt: result.prompt,
      workspacePath,
    });
  } catch (error) {
    console.error("completion-audit: failed to start decision research:", error);
  }

  createNotification(namespaceId, {
    type: "warning",
    title: "Decision needed",
    message: `Task "${task.title}" completed but needs a human decision: ${audit.reason}`,
    metadata: { taskId: task.id, runId, decisionTaskId: result.decisionTaskId },
  });
}

function publicDecisionResult(result: DecisionGateResult): ApplyCompletionAuditResult {
  return {
    action: result.action,
    detail: result.detail,
    decisionTaskId: result.decisionTaskId,
  };
}

function applyRetryTweaks(input: ApplyCompletionAuditInput): void {
  const { namespaceId, orgId, task, audit, runId } = input;
  const tweaks = audit.retry?.task_tweaks;
  const columnFields: Record<string, unknown> = { status: "open" };
  if (tweaks?.title) columnFields.title = tweaks.title;
  if (tweaks?.description) columnFields.description = tweaks.description;
  if (tweaks?.acceptance_criteria) columnFields.acceptance_criteria = tweaks.acceptance_criteria;
  taskUpdate(orgId, task.id, columnFields, namespaceId);

  // Attach reopen context as comments. The run goal builder injects task
  // comments into the next agent's prompt, so this is how the re-kick "knows"
  // it is iterating rather than starting fresh.
  const comments = audit.retry?.comments?.length
    ? audit.retry.comments
    : [`Reopened by completion auditor: ${audit.reason}`];
  const guidance = audit.retry?.guidance;
  taskAddComment(
    orgId,
    task.id,
    "completion-auditor",
    [
      `REOPENED FOR RETRY: ${audit.reason}`,
      guidance ? `\nWhat to do differently: ${guidance}` : "",
      comments.length ? `\n${comments.join("\n")}` : "",
    ].filter(Boolean).join(""),
    namespaceId,
  );

  createNotification(namespaceId, {
    type: "warning",
    title: "Task reopened for retry",
    message: `Task "${task.title}" was reopened by the completion auditor: ${audit.reason}`,
    metadata: { taskId: task.id, runId },
  });
}

async function applySummaryLifecycle(input: ApplyCompletionAuditInput): Promise<{
  state: TaskLifecycleState;
  decisionResult?: DecisionGateResult;
  supersededDecisionSubtaskIds: string[];
}> {
  const { request, namespaceId, orgId, task, audit, runId, runFingerprint, workspacePath, metadata } = input;
  let decisionResult: DecisionGateResult | undefined;
  let supersededDecisionSubtaskIds: string[] = [];
  const initialState = hydrateLifecycleState(task.id, metadata);
  const escalated = audit.verdict === "retry";

  const deps: LifecycleEffectDeps = {
    startOutcomeSummary: async () => undefined,
    createDecisionGate: async () => {
      decisionResult = await createDecisionSubtask(input, escalated);
    },
    blockOnDecision: () => undefined,
    createFollowupDependencies: () => undefined,
    resumeOriginalTask: () => undefined,
    closeTask: async (depOrgId, taskId, reason, depNamespaceId) => {
      supersededDecisionSubtaskIds = await closeSupersededDecisionSubtasks(input);
      taskClose(depOrgId, taskId, reason, depNamespaceId);
    },
    clearDecisionGate: () => undefined,
    // Surgical dependents-only nudge (the redo the disable note was waiting for):
    // fire-and-forget a scan of ONLY this completed task's direct dependents so the
    // next task starts immediately instead of waiting up to 60s. Storm-safe: the route
    // uses getDirectDependentAutoRunCandidates, and canAdmitAutoRun's terminal rule can
    // never re-run a finished chain (that was the TASK-097 root cause, since fixed). The
    // 60s poller backstops if this fire-and-forget is ever dropped by the runtime.
    scanUnblockedAutoRunTasks: () => { void triggerAutoRunScan(input.namespaceId, input.orgId, input.task.id); },
    retryExecution: async () => {
      applyRetryTweaks(input);
    },
  };

  const transition = await applyLifecycleEvent({
    state: initialState,
    event: {
      type: "summary.completed",
      taskId: task.id,
      summaryRunId: runId,
      sourceRunId: runId,
      fingerprint: runFingerprint ?? "",
      verdict: audit.verdict,
    },
    context: {
      request,
      namespaceId,
      orgId,
      workspaceId: workspacePath,
      workspacePath,
      reason: audit.reason,
    },
    deps,
  });

  let state = transition.state;
  if (decisionResult?.decisionTaskId) {
    const created = reduceTaskLifecycle(
      state,
      {
        type: "decision.created",
        taskId: task.id,
        decisionTaskId: decisionResult.decisionTaskId,
        sourceRunId: runId,
        fingerprint: runFingerprint ?? "",
      },
    );
    state = created.state;
  }

  return { state, decisionResult, supersededDecisionSubtaskIds };
}

async function closeSupersededDecisionSubtasks(input: ApplyCompletionAuditInput): Promise<string[]> {
  const { namespaceId, orgId, task, runId, workspacePath } = input;
  const candidates = taskList(orgId, { status: "all" }, undefined, namespaceId);
  const superseded = candidates.filter((candidate) => {
    if (candidate.parent_id !== task.id) return false;
    if (candidate.issue_type !== "decision") return false;
    if (candidate.status === "closed") return false;
    const meta = decisionMeta(candidate);
    return meta.decision_source === "completion-audit";
  });

  for (const decision of superseded) {
    const meta = decisionMeta(decision);
    taskClose(orgId, decision.id, "Superseded by later completion audit evidence.", namespaceId);
    taskMergeMeta(orgId, decision.id, {
      decision_status: "superseded",
      superseded_by_run_id: runId,
      superseded_reason: "Later audit evidence closed the parent task.",
    }, namespaceId);
    taskAddComment(
      orgId,
      decision.id,
      "completion-auditor",
      `Superseded by later completion audit for ${task.id} on run ${runId}.`,
      namespaceId,
    );
    const decisionId = typeof meta.decision_id === "string" ? meta.decision_id : undefined;
    if (decisionId) {
      try {
        await updateDecision(namespaceId, orgId, decisionId, { status: "superseded" }, workspacePath);
      } catch (error) {
        console.error(`completion-auditor: failed to supersede decision ${decisionId}:`, error);
      }
    }
  }

  return superseded.map((decision) => decision.id);
}

export async function applyCompletionAudit(
  input: ApplyCompletionAuditInput,
): Promise<ApplyCompletionAuditResult> {
  const { namespaceId, orgId, task, audit, runId, runFingerprint, metadata } = input;

  // Idempotency: never act twice on the same audited run.
  const appliedFingerprint = typeof metadata.completion_audit_run_fingerprint === "string"
    ? metadata.completion_audit_run_fingerprint
    : "";
  const sameAppliedRun = metadata.completion_audit_run_id === runId;
  const sameAppliedFingerprint = runFingerprint ? appliedFingerprint === runFingerprint : true;
  const auditAlreadyApplied =
    sameAppliedRun && sameAppliedFingerprint && metadata.completion_audit_apply_status === "applied";
  // "applied" is only trustworthy for a close verdict if the task ACTUALLY
  // reached a done status. If a later reopen (reconcile / run-status flap)
  // clobbered the close, the flag lies -- fall through and re-close instead of
  // skipping forever. This half-state is what kept TASK-095 open after the
  // audit reported close+applied.
  const closeVerdictNotYetClosed =
    audit.verdict === "close" && !CLOSED_TASK_STATUSES.has(task.status);
  if (auditAlreadyApplied && !closeVerdictNotYetClosed) {
    if ((audit.verdict === "close" || audit.verdict === "decision")
      && closeExecutionMetadataNeedsRepair(metadata, runId, runFingerprint)) {
      taskMergeMeta(orgId, task.id, {
        ...lifecycleMetadata(hydrateLifecycleState(task.id, metadata)),
        last_audit_verdict: audit.verdict,
        ...closeExecutionMetadata(runId, runFingerprint),
        ...(audit.verdict === "decision" ? { last_run_decision_required: true } : {}),
        completion_audit_run_id: runId,
        completion_audit_apply_status: "applied",
        ...(runFingerprint ? { completion_audit_run_fingerprint: runFingerprint } : {}),
      }, namespaceId);
      return { action: "skipped", detail: "audit already applied for this run; repaired execution metadata" };
    }
    return { action: "skipped", detail: "audit already applied for this run" };
  }

  const { state, decisionResult, supersededDecisionSubtaskIds } = await applySummaryLifecycle(input);

  if (audit.verdict === "close") {
    // Verify the lifecycle close effect actually landed before recording
    // "applied" -- otherwise a close that silently failed (or got clobbered)
    // would still mark itself applied, permanently skipping the idempotency
    // guard's re-close path. This half-state is what kept TASK-095 open after
    // the audit reported close+applied.
    const closedTask = taskGet(orgId, task.id, namespaceId);
    const didClose = !!closedTask && CLOSED_TASK_STATUSES.has(closedTask.status);
    taskMergeMeta(orgId, task.id, {
      ...lifecycleMetadata(state),
      last_audit_verdict: "close",
      ...closeExecutionMetadata(runId, runFingerprint),
      completion_audit_run_id: runId,
      completion_audit_apply_status: didClose ? "applied" : "pending_close",
      ...(runFingerprint ? { completion_audit_run_fingerprint: runFingerprint } : {}),
      ...(supersededDecisionSubtaskIds.length
        ? { superseded_decision_subtask_ids: supersededDecisionSubtaskIds }
        : {}),
    }, namespaceId);
    createNotification(namespaceId, {
      type: "success",
      title: "Task auto-closed",
      message: `Task "${task.title}" passed completion audit and was closed.`,
      metadata: { taskId: task.id, runId },
    });
    return { action: "closed", detail: audit.reason };
  }

  if (audit.verdict === "retry") {
    if (decisionResult) {
      taskMergeMeta(orgId, task.id, {
        ...lifecycleMetadata(state),
        last_audit_verdict: "retry_escalated",
        last_run_decision_required: true,
        decision_subtask_id: decisionResult.decisionTaskId,
        completion_audit_run_id: runId,
        completion_audit_apply_status: "applied",
        ...(runFingerprint ? { completion_audit_run_fingerprint: runFingerprint } : {}),
      }, namespaceId);
      applyDecisionBlockSideEffects(input, decisionResult);
      await runDecisionPostPersistSideEffects(input, decisionResult);
      return publicDecisionResult(decisionResult);
    }

    taskMergeMeta(orgId, task.id, {
      ...lifecycleMetadata(state),
      last_audit_verdict: "retry",
      last_run_status: "retry_requested",
      last_run_id: undefined,
      last_run_decision_required: false,
      reopened_reason: audit.reason,
      completion_audit_run_id: runId,
      completion_audit_apply_status: "applied",
      ...(runFingerprint ? { completion_audit_run_fingerprint: runFingerprint } : {}),
    }, namespaceId);

    return { action: "retry_scheduled", detail: audit.reason };
  }

  // verdict === "decision" (or any escalation coerced upstream)
  if (decisionResult) {
    taskMergeMeta(orgId, task.id, {
      ...lifecycleMetadata(state),
      last_audit_verdict: "decision",
      ...closeExecutionMetadata(runId, runFingerprint),
      last_run_decision_required: true,
      decision_subtask_id: decisionResult.decisionTaskId,
      completion_audit_run_id: runId,
      completion_audit_apply_status: "applied",
      ...(runFingerprint ? { completion_audit_run_fingerprint: runFingerprint } : {}),
    }, namespaceId);
    applyDecisionBlockSideEffects(input, decisionResult);
    await runDecisionPostPersistSideEffects(input, decisionResult);
    return publicDecisionResult(decisionResult);
  }

  return {
    action: "skipped",
    detail: "completion-audit decision already gated for this run",
    decisionTaskId: typeof state.decisionTaskId === "string" ? state.decisionTaskId : undefined,
  };
}
