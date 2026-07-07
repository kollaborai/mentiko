import { deleteDecision, getDecision } from "@/lib/decisions/decision-storage";
import { hydrateLifecycleState } from "@/lib/orchestration/task-lifecycle-hydrate";
import { reduceTaskLifecycle } from "@/lib/orchestration/task-lifecycle-reducer";
import type { TaskLifecycleState } from "@/lib/orchestration/task-lifecycle-types";
import { taskDelete, taskGet, taskList, taskUpdate } from "@/lib/tasks/task-store";
import type { TaskRecord } from "@/lib/tasks/task-store-types";

function taskMetadata(task: TaskRecord | null | undefined): Record<string, unknown> {
  return task?.metadata && typeof task.metadata === "object" && !Array.isArray(task.metadata)
    ? { ...task.metadata as Record<string, unknown> }
    : {};
}

function findDecisionTaskByDecisionId(orgId: string, namespaceId: string, decisionId: string): TaskRecord | null {
  return taskList(orgId, { status: "all" }, undefined, namespaceId).find((task) => {
    if (task.issue_type !== "decision") return false;
    const metadata = taskMetadata(task);
    return metadata.decision_id === decisionId;
  }) ?? null;
}

function findLiveCompletionAuditGate(
  orgId: string,
  namespaceId: string,
  parentTaskId: string,
  deletedDecisionTaskId?: string,
): TaskRecord | null {
  return taskList(orgId, { status: "all" }, undefined, namespaceId).find((task) => {
    if (task.id === deletedDecisionTaskId) return false;
    if (task.parent_id !== parentTaskId) return false;
    if (task.issue_type !== "decision") return false;
    if (task.status === "closed") return false;
    const metadata = taskMetadata(task);
    if (metadata.decision_source !== "completion-audit") return false;
    if (metadata.decision_status === "superseded") return false;
    return true;
  }) ?? null;
}

function lifecycleMetadata(state: TaskLifecycleState): Record<string, unknown> {
  return {
    lifecycle_phase: state.phase,
    execution_retries: state.executionRetryCount,
    gated_run_fingerprints: state.gatedFingerprints,
    summarized_run_fingerprints: state.summarizedFingerprints,
    followup_task_ids: state.followUpTaskIds,
    decision_subtask_id: state.decisionTaskId,
    last_run_decision_required: state.phase === "decision_blocked" || state.phase === "followup_blocked",
  };
}

function removeDeletedDecisionReferences(
  metadata: Record<string, unknown>,
  decisionId: string,
  decisionTaskId?: string,
): void {
  const matchesDecisionTask = (value: unknown) => (
    typeof decisionTaskId === "string" && value === decisionTaskId
  );
  const matchesDecision = (value: unknown) => value === decisionId;

  for (const key of [
    "decision_subtask_id",
    "last_decision_subtask_id",
  ]) {
    if (matchesDecisionTask(metadata[key])) {
      delete metadata[key];
    }
  }

  for (const key of [
    "decision_id",
    "last_decision_id",
  ]) {
    if (matchesDecision(metadata[key])) {
      delete metadata[key];
    }
  }

  for (const key of [
    "superseded_decision_subtask_ids",
    "duplicate_decision_subtask_ids",
  ]) {
    if (!Array.isArray(metadata[key])) continue;
    const next = metadata[key].filter((item) => !matchesDecisionTask(item));
    if (next.length > 0) metadata[key] = next;
    else delete metadata[key];
  }
}

export async function deleteDecisionEntity(
  namespaceId: string,
  orgId: string,
  decisionId: string,
  workspacePath?: string,
): Promise<void> {
  const decision = getDecision(namespaceId, orgId, decisionId, workspacePath);
  deleteDecision(namespaceId, orgId, decisionId, workspacePath);

  const fallbackDecisionTask = decision ? null : findDecisionTaskByDecisionId(orgId, namespaceId, decisionId);
  const decisionTaskId = typeof decision?.taskId === "string" ? decision.taskId : fallbackDecisionTask?.id;
  const decisionTask = decisionTaskId
    ? taskGet(orgId, decisionTaskId, namespaceId) ?? fallbackDecisionTask
    : fallbackDecisionTask;
  const decisionTaskMetadata = taskMetadata(decisionTask);
  const parentTaskId =
    (typeof decision?.parentTaskId === "string" ? decision.parentTaskId : undefined) ||
    decisionTask?.parent_id ||
    (typeof decisionTaskMetadata.decision_parent_task_id === "string"
      ? decisionTaskMetadata.decision_parent_task_id
      : undefined);

  if (decisionTaskId) {
    taskDelete(orgId, decisionTaskId, namespaceId);
  }

  if (!parentTaskId) return;

  const parentTask = taskGet(orgId, parentTaskId, namespaceId);
  if (!parentTask) return;

  const originalMetadata = taskMetadata(parentTask);
  const reduced = reduceTaskLifecycle(
    hydrateLifecycleState(parentTask.id, originalMetadata),
    { type: "decision.deleted", taskId: parentTask.id, decisionTaskId, decisionId },
  );
  const metadata = { ...originalMetadata };
  removeDeletedDecisionReferences(metadata, decisionId, decisionTaskId);

  const liveGate = findLiveCompletionAuditGate(orgId, namespaceId, parentTask.id, decisionTaskId);
  if (liveGate) {
    metadata.decision_subtask_id = liveGate.id;
    metadata.last_run_decision_required = true;
    metadata.lifecycle_phase = "decision_blocked";
  } else {
    Object.assign(metadata, lifecycleMetadata(reduced.state));
  }

  const phase = typeof metadata.lifecycle_phase === "string" ? metadata.lifecycle_phase : reduced.state.phase;
  taskUpdate(
    orgId,
    parentTask.id,
    {
      status: phase === "decision_blocked" || phase === "followup_blocked" ? "blocked" : "open",
      metadata,
    },
    namespaceId,
  );
}
