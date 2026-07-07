// Dispatcher for completion-audit verdicts. Given a parsed CompletionAudit and
// the audited task, it performs the verdict's action: close the task, spawn a
// decision subtask (with research), or reopen the task for a context-injected
// retry. All actions are idempotent on the audited run id and bounded by a
// retry cap so audit-driven retries can't loop forever.

import { taskClose, taskUpdate, taskMergeMeta, taskAddComment, taskList } from "@/lib/tasks/task-store";
import { createTaskDecision } from "@/lib/tasks/task-decision-link";
import { createNotification } from "@/lib/notifications/notification-server";
import { updateDecision } from "@/lib/decisions/decision-storage";
import type { TaskRecord } from "@/lib/tasks/task-store-types";
import type { CompletionAudit } from "@/lib/tasks/completion-audit-schema";

// After this many consecutive audit-driven retries, escalate to a human
// decision instead of retrying again.
const RETRY_CAP = 2;

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

function retryCount(metadata: Record<string, unknown>): number {
  const n = metadata.auto_run_retries;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
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

async function createDecisionSubtask(
  input: ApplyCompletionAuditInput,
  escalated: boolean,
): Promise<ApplyCompletionAuditResult> {
  const { request, namespaceId, orgId, task, audit, runId, runFingerprint, workspacePath } = input;

  // A "decision" verdict means the run's outcome is NOT settled — the task is
  // not actually done until a human resolves the decision. If the task is
  // sitting at status "closed" (whether from an earlier close, a bulk-close,
  // or any other path), that status is now misleading: the tracker would show
  // "closed" while a pending decision says otherwise. Reopen to "blocked" so
  // task lists don't report false completion. (This is the bug that let
  // FEAT-014 stay "closed" even after the auditor flagged decision_required
  // and spawned DEC-009 — createDecisionSubtask never touched task.status.)
  if (task.status === "closed") {
    taskUpdate(orgId, task.id, { status: "blocked" }, namespaceId);
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
  });

  // Best-effort: kick off research so the decision agent packages the decision
  // (clean title, brief, options) exactly like the interactive flow. We go
  // through the SAME startDecisionResearch path the research route uses — same
  // decision_research template — so auto-created decisions don't look different
  // from hand-made ones. A research failure must not block the triage. Imported
  // lazily to keep chain-run-service (and its ESM deps) out of static graphs.
  try {
    const { startDecisionResearch } = await import("@/lib/decisions/decision-chain-dispatch");
    await startDecisionResearch({
      request,
      namespaceId,
      orgId,
      decision,
      userPrompt: prompt,
      workspacePath,
    });
  } catch (error) {
    console.error("completion-audit: failed to start decision research:", error);
  }

  taskMergeMeta(orgId, task.id, {
    last_audit_verdict: escalated ? "retry_escalated" : "decision",
    last_run_decision_required: true,
    decision_subtask_id: decisionTask.id,
    completion_audit_run_id: runId,
    completion_audit_apply_status: "applied",
    ...(runFingerprint ? { completion_audit_run_fingerprint: runFingerprint } : {}),
  }, namespaceId);

  createNotification(namespaceId, {
    type: "warning",
    title: "Decision needed",
    message: `Task "${task.title}" completed but needs a human decision: ${audit.reason}`,
    metadata: { taskId: task.id, runId, decisionTaskId: decisionTask.id },
  });

  return {
    action: escalated ? "escalated_decision" : "decision_created",
    detail: audit.reason,
    decisionTaskId: decisionTask.id,
  };
}

async function closeSupersededDecisionSubtasks(input: ApplyCompletionAuditInput): Promise<string[]> {
  const { namespaceId, orgId, task, runId } = input;
  const candidates = taskList(orgId, { status: "all" }, undefined, namespaceId);
  const superseded = candidates.filter((candidate) => {
    if (candidate.parent_id !== task.id) return false;
    if (candidate.issue_type !== "decision") return false;
    if (candidate.status === "closed") return false;
    const meta = candidate.metadata && typeof candidate.metadata === "object"
      ? candidate.metadata as Record<string, unknown>
      : {};
    return meta.decision_source === "completion-audit";
  });

  for (const decision of superseded) {
    const meta = decision.metadata && typeof decision.metadata === "object"
      ? decision.metadata as Record<string, unknown>
      : {};
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
        await updateDecision(namespaceId, orgId, decisionId, { status: "superseded" });
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
  if (sameAppliedRun && sameAppliedFingerprint && metadata.completion_audit_apply_status === "applied") {
    return { action: "skipped", detail: "audit already applied for this run" };
  }

  if (audit.verdict === "close") {
    const supersededDecisionSubtaskIds = await closeSupersededDecisionSubtasks(input);
    taskClose(orgId, task.id, audit.reason, namespaceId);
    taskMergeMeta(orgId, task.id, {
      last_audit_verdict: "close",
      last_run_decision_required: false,
      completion_audit_run_id: runId,
      completion_audit_apply_status: "applied",
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
    // Cap retries: once exhausted, hand off to a human decision instead.
    if (retryCount(metadata) >= RETRY_CAP) {
      return createDecisionSubtask(input, true);
    }

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

    // Clear last_run_id so the auto-run poller re-kicks the task on its next
    // cycle (same reset pattern as the reconciler's failed-run retry path).
    taskMergeMeta(orgId, task.id, {
      last_audit_verdict: "retry",
      last_run_status: "retry_requested",
      last_run_id: undefined,
      last_run_decision_required: false,
      reopened_reason: audit.reason,
      auto_run_retries: retryCount(metadata) + 1,
      completion_audit_run_id: runId,
      completion_audit_apply_status: "applied",
      ...(runFingerprint ? { completion_audit_run_fingerprint: runFingerprint } : {}),
    }, namespaceId);

    createNotification(namespaceId, {
      type: "warning",
      title: "Task reopened for retry",
      message: `Task "${task.title}" was reopened by the completion auditor: ${audit.reason}`,
      metadata: { taskId: task.id, runId },
    });

    return { action: "retry_scheduled", detail: audit.reason };
  }

  // verdict === "decision" (or any escalation coerced upstream)
  return createDecisionSubtask(input, false);
}
