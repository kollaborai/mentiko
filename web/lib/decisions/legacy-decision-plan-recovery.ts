import { getDecision } from "@/lib/decisions/decision-storage";
import { validateExecutionPlan } from "@/lib/decisions/decision-plan-contract";
import type { Decision } from "@/lib/decisions/decision-types";
import { taskList, taskUpdate } from "@/lib/tasks/task-store";
import type { TaskRecord } from "@/lib/tasks/task-store-types";

const LEGACY_PLAN_REASON =
  "Decision plan is legacy and has no authoritative deliverable, verification, and acceptance contract. Regenerate the decision plan before execution.";
const LEGACY_PLAN_PAUSE_PREFIX = "Legacy decision plan is missing the required deliverable, verification, and acceptance contract.";

export type LegacyDecisionPlanRecoveryAction = "repaired" | "blocked" | "ignored";

export interface LegacyDecisionPlanRecovery {
  taskId: string;
  action: LegacyDecisionPlanRecoveryAction;
  reason: string;
  acceptanceCriteria?: string;
  metadata?: Record<string, unknown>;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function taskMetadata(task: TaskRecord): Record<string, unknown> {
  return task.metadata && typeof task.metadata === "object" && !Array.isArray(task.metadata)
    ? task.metadata as Record<string, unknown>
    : {};
}

/**
 * A legacy decision plan is recoverable only by copying an already-valid
 * contract from its own persisted decision record.  In particular, this never
 * derives a deliverable from a task title, description, or subtask list: those
 * are activity descriptions, not acceptance evidence.
 */
export function recoverLegacyDecisionPlanTask(
  task: TaskRecord,
  decision: Decision | null,
): LegacyDecisionPlanRecovery {
  const metadata = taskMetadata(task);
  const decisionId = text(metadata.decision_id);
  const planTaskId = text(metadata.decision_plan_task_id);
  const legacyMarker = metadata.decision_plan_contract === "legacy_unverifiable";
  const legacyPause = text(metadata.auto_run_paused_reason)?.startsWith(LEGACY_PLAN_PAUSE_PREFIX) ?? false;

  if (!legacyMarker && !metadata.decision_plan_quarantined_at && !legacyPause) {
    return { taskId: task.id, action: "ignored", reason: "task is not quarantined as a legacy decision plan" };
  }
  if (!decisionId || !planTaskId) {
    return { taskId: task.id, action: "blocked", reason: "legacy decision task has no decision or plan-task identity" };
  }
  if (!decision) {
    return { taskId: task.id, action: "blocked", reason: `authoritative decision ${decisionId} no longer exists` };
  }
  if (decision.workspacePath && task.workspace_id && decision.workspacePath !== task.workspace_id) {
    return { taskId: task.id, action: "blocked", reason: "decision workspace does not match the task workspace" };
  }

  const selectedOptionId = text(metadata.decision_selected_option_id);
  if (selectedOptionId && decision.resolution?.selectedOptionId && decision.resolution.selectedOptionId !== selectedOptionId) {
    return { taskId: task.id, action: "blocked", reason: "decision selection changed after this task tree was created" };
  }

  const planResult = validateExecutionPlan(decision.guidedFlow?.round3?.plan);
  if (!planResult.valid) {
    return { taskId: task.id, action: "blocked", reason: LEGACY_PLAN_REASON };
  }
  const sourceTask = planResult.plan.tasks.find((candidate) => candidate.id === planTaskId);
  if (!sourceTask) {
    return { taskId: task.id, action: "blocked", reason: `authoritative plan no longer contains task ${planTaskId}` };
  }

  const { auto_run_paused: _paused, auto_run_paused_reason: _pausedReason, decision_plan_quarantined_at: _quarantinedAt, ...rest } = metadata;
  return {
    taskId: task.id,
    action: "repaired",
    reason: "copied the verifiable contract from the authoritative decision plan",
    acceptanceCriteria: sourceTask.acceptance_criteria,
    metadata: {
      ...rest,
      decision_plan_contract: "v1",
      decision_plan_deliverable: sourceTask.deliverable,
      decision_plan_verification: sourceTask.verification,
      decision_plan_recovered_at: new Date().toISOString(),
    },
  };
}

export interface ReconcileLegacyDecisionPlansInput {
  namespaceId: string;
  orgId: string;
  workspacePath?: string;
  apply?: boolean;
}

export interface ReconcileLegacyDecisionPlansResult {
  scanned: number;
  repaired: number;
  blocked: number;
  ignored: number;
  results: LegacyDecisionPlanRecovery[];
}

/**
 * Dry-run by default. Applying a repair is deliberately explicit because old
 * task trees may have been created from a plan the user no longer wants.
 */
export function reconcileLegacyDecisionPlans(
  input: ReconcileLegacyDecisionPlansInput,
): ReconcileLegacyDecisionPlansResult {
  const tasks = taskList(input.orgId, { status: "all" }, input.workspacePath, input.namespaceId)
    .filter((task) => {
      const metadata = taskMetadata(task);
      return metadata.decision_plan_contract === "legacy_unverifiable"
        || !!metadata.decision_plan_quarantined_at
        || (text(metadata.auto_run_paused_reason)?.startsWith(LEGACY_PLAN_PAUSE_PREFIX) ?? false);
    });

  const results = tasks.map((task) => {
    const metadata = taskMetadata(task);
    const decisionId = text(metadata.decision_id);
    const decision = decisionId
      ? getDecision(input.namespaceId, input.orgId, decisionId, task.workspace_id ?? input.workspacePath)
      : null;
    const recovery = recoverLegacyDecisionPlanTask(task, decision);

    if (input.apply && recovery.action === "repaired") {
      taskUpdate(input.orgId, task.id, {
        acceptance_criteria: recovery.acceptanceCriteria,
        metadata: recovery.metadata,
      }, input.namespaceId);
    }
    if (input.apply && recovery.action === "blocked") {
      const existing = taskMetadata(task);
      taskUpdate(input.orgId, task.id, {
        status: "blocked",
        metadata: {
          ...existing,
          auto_run_paused: true,
          auto_run_paused_reason: recovery.reason,
          decision_plan_contract: "regeneration_required",
          decision_plan_blocked_at: new Date().toISOString(),
        },
      }, input.namespaceId);
    }
    return recovery;
  });

  return {
    scanned: tasks.length,
    repaired: results.filter((result) => result.action === "repaired").length,
    blocked: results.filter((result) => result.action === "blocked").length,
    ignored: results.filter((result) => result.action === "ignored").length,
    results,
  };
}
