import { getDecision, updateDecision } from "@/lib/decisions/decision-storage";
import { taskAddDep, taskCreate, taskGet, taskUpdate } from "@/lib/tasks/task-store";
import { applyLifecycleEvent, type LifecycleEffectDeps } from "@/lib/orchestration/task-lifecycle-service";
import { hydrateLifecycleState } from "@/lib/orchestration/task-lifecycle-hydrate";
import type { TaskLifecycleState } from "@/lib/orchestration/task-lifecycle-types";
import type { TaskRecord } from "@/lib/tasks/task-store-types";
import type { Decision, ExecutionPlan, Option, TailoredOption } from "@/lib/decisions/decision-types";
import { BadRequest, NotFound } from "@/lib/api-errors";

type ResolvedDecisionOption = Pick<
  Option | TailoredOption,
  "id" | "letter" | "name" | "description" | "effort" | "risk"
> & {
  pros?: string[];
  cons?: string[];
};

export interface ResolveDecisionToTasksInput {
  namespaceId: string;
  orgId: string;
  decisionId: string;
  selectedOptionId: string;
  notes?: string;
  workspaceId?: string;
  workspacePath?: string;
  selectedBy?: string;
}

export interface ResolveDecisionToTasksResult {
  decision: Decision;
  taskId: string;
  taskIds: string[];
}

function priorityToNumber(priority?: string): number {
  if (!priority) return 2;
  const match = priority.match(/p(\d)/i);
  return match ? parseInt(match[1], 10) : 2;
}

function findDecisionOption(
  decision: Decision,
  selectedOptionId: string,
): ResolvedDecisionOption | undefined {
  return (
    decision.options.find((option) => option.id === selectedOptionId) ??
    decision.guidedFlow?.round2.tailoredOptions.find(
      (option) => option.id === selectedOptionId,
    )
  );
}

function buildDescriptionParts(
  decision: Decision,
  option: ResolvedDecisionOption,
): string[] {
  const descriptionParts: string[] = [];
  if (decision.context) {
    descriptionParts.push(`Problem: ${decision.context.problem}`);
    if (decision.context.whyProblem) {
      descriptionParts.push(`Impact: ${decision.context.whyProblem}`);
    }
  }
  descriptionParts.push(`\nApproach: ${option.name}`);
  descriptionParts.push(option.description);
  return descriptionParts;
}

function buildNotesParts(
  decision: Decision,
  selectedOptionId: string,
): string[] {
  const notesParts: string[] = [];
  if (decision.context) {
    if (decision.context.currentState) {
      notesParts.push(`Current state: ${decision.context.currentState}`);
    }
    if (decision.context.affectedAreas?.length) {
      notesParts.push(
        `\nAffected areas:\n${decision.context.affectedAreas.map((area) => `- ${area}`).join("\n")}`,
      );
    }
    if (decision.context.constraints?.length) {
      notesParts.push(
        `\nConstraints:\n${decision.context.constraints.map((constraint) => `- ${constraint}`).join("\n")}`,
      );
    }
    if (decision.context.references?.length) {
      notesParts.push(
        `\nReferences:\n${decision.context.references.map((ref) => `- ${ref}`).join("\n")}`,
      );
    }
  }

  const otherOptions = decision.options.filter((option) => option.id !== selectedOptionId);
  if (otherOptions.length) {
    notesParts.push(
      `\nAlternatives considered:\n${otherOptions.map((option) => `- ${option.letter}. ${option.name}: ${option.description}`).join("\n")}`,
    );
  }
  if (decision.recommendation) {
    notesParts.push(
      `\nAI recommendation: ${decision.recommendation.rationale} (confidence: ${decision.recommendation.confidence})`,
    );
  }

  return notesParts;
}

function resolveEpicAncestor(
  orgId: string,
  parentTask: TaskRecord,
  namespaceId: string,
): string {
  // Walk up the parent chain to the nearest ancestor whose type is "epic".
  // Returns the parent task's own id if it is already an epic or has no epic
  // ancestor (preserving prior behavior). Bounded to guard against cycles.
  let current: TaskRecord | null | undefined = parentTask;
  for (let hops = 0; current && hops < 16; hops++) {
    if (current.issue_type === "epic") return current.id;
    if (!current.parent_id) break;
    current = taskGet(orgId, current.parent_id, namespaceId);
  }
  return parentTask.id;
}

function taskMetadata(task: TaskRecord | undefined | null): Record<string, unknown> {
  return task?.metadata && typeof task.metadata === "object" && !Array.isArray(task.metadata)
    ? { ...task.metadata as Record<string, unknown> }
    : {};
}

function lifecycleMetadata(state: TaskLifecycleState, current: Record<string, unknown>): Record<string, unknown> {
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

async function applyResolutionLifecycle(input: {
  namespaceId: string;
  orgId: string;
  parentTask: TaskRecord;
  decisionTaskId: string;
  followUpTaskIds: string[];
  workspaceId?: string;
  workspacePath?: string;
}): Promise<void> {
  const { namespaceId, orgId, parentTask, decisionTaskId, followUpTaskIds, workspaceId, workspacePath } = input;
  const deps: LifecycleEffectDeps = {
    startOutcomeSummary: async () => undefined,
    createDecisionGate: async () => undefined,
    blockOnDecision: () => undefined,
    createFollowupDependencies: (depOrgId, taskId, followUpTaskId, depNamespaceId, depWorkspaceId) => {
      taskAddDep(depOrgId, taskId, followUpTaskId, depNamespaceId, depWorkspaceId);
    },
    resumeOriginalTask: () => undefined,
    closeTask: () => undefined,
    clearDecisionGate: () => undefined,
    scanUnblockedAutoRunTasks: () => undefined,
    retryExecution: async () => undefined,
  };
  const transition = await applyLifecycleEvent({
    state: hydrateLifecycleState(parentTask.id, parentTask.metadata),
    event: {
      type: "decision.resolved",
      taskId: parentTask.id,
      decisionTaskId,
      followUpTaskIds,
    },
    context: {
      request: {} as Request,
      namespaceId,
      orgId,
      workspaceId,
      workspacePath,
    },
    deps,
  });
  const status = transition.state.phase === "followup_blocked" ? "blocked" : "open";
  const current = taskMetadata(parentTask);
  taskUpdate(
    orgId,
    parentTask.id,
    {
      status,
      metadata: lifecycleMetadata(transition.state, current),
    },
    namespaceId,
  );
}

export async function resolveDecisionToTasks({
  namespaceId,
  orgId,
  decisionId,
  selectedOptionId,
  notes,
  workspaceId,
  workspacePath,
  selectedBy = "user",
}: ResolveDecisionToTasksInput): Promise<ResolveDecisionToTasksResult> {
  const decision = getDecision(namespaceId, orgId, decisionId, workspacePath);
  const resolvedWorkspacePath = workspacePath ?? decision?.workspacePath;
  const taskWorkspaceId = workspaceId ?? resolvedWorkspacePath;

  if (!decision) {
    throw new NotFound("Decision", decisionId);
  }

  if (decision.status !== "pending" && decision.status !== "briefed") {
    throw new BadRequest(`Cannot resolve decision in status: ${decision.status}`);
  }

  const option = findDecisionOption(decision, selectedOptionId);
  if (!option) {
    throw new NotFound("Option", selectedOptionId);
  }

  const descriptionParts = buildDescriptionParts(decision, option);
  const notesParts = buildNotesParts(decision, selectedOptionId);
  const plan = decision.guidedFlow?.round3?.plan as ExecutionPlan | undefined;
  const hasPlan = plan && Array.isArray(plan.tasks) && plan.tasks.length > 0;
  const decisionTaskId = decision.taskId;
  const existingParentTaskId = decision.parentTaskId;
  const parentTask = existingParentTaskId
    ? taskGet(orgId, existingParentTaskId, namespaceId)
    : undefined;
  if (existingParentTaskId) {
    if (!parentTask) {
      throw new BadRequest("Decision parent task not found", {
        decisionId,
        parentTaskId: existingParentTaskId,
      });
    }
    if (taskWorkspaceId && parentTask.workspace_id !== taskWorkspaceId) {
      throw new BadRequest("Decision parent task belongs to another workspace", {
        decisionId,
        parentTaskId: existingParentTaskId,
        parentWorkspaceId: parentTask.workspace_id,
        decisionWorkspaceId: taskWorkspaceId,
      });
    }
  }

  // The decision sits under whatever triggered it (often a feature), but the
  // implementation tasks it generates should land under that trigger's EPIC,
  // not nested under a leaf. Walk up to the nearest epic ancestor; if the parent
  // is already an epic — or has no epic ancestor — this resolves to itself.
  const resolutionParentId = parentTask
    ? resolveEpicAncestor(orgId, parentTask, namespaceId)
    : existingParentTaskId;

  let epicId: string;
  const allTaskIds: string[] = [];
  const followUpTaskIds: string[] = [];
  if (decisionTaskId) {
    allTaskIds.push(decisionTaskId);
  }

  if (hasPlan && existingParentTaskId) {
    epicId = resolutionParentId as string;
    const taskIdMap: Record<string, string> = {};
    for (const [index, planTask] of plan.tasks.entries()) {
      const subtask = taskCreate(
        orgId,
        {
          workspace_id: taskWorkspaceId,
          title: planTask.title,
          description: [
            planTask.description,
            planTask.subtasks?.length
              ? `\nSubtasks:\n${planTask.subtasks.map((subtaskText) => `- ${subtaskText}`).join("\n")}`
              : "",
          ].filter(Boolean).join("\n"),
          issue_type: "task",
          priority: planTask.priority ?? priorityToNumber(decision.priority),
          parent_id: epicId,
          metadata: {
            decision_id: decisionId,
            decision_task_id: decisionTaskId,
            decision_parent_task_id: existingParentTaskId,
            decision_selected_option_id: selectedOptionId,
            decision_plan_task_id: planTask.id,
            decision_plan_order: index,
            decision_plan_phase: planTask.phase,
          },
        },
        namespaceId,
      );
      taskIdMap[planTask.id] = subtask.id;
      allTaskIds.push(subtask.id);
      followUpTaskIds.push(subtask.id);
    }

    if (plan.dependencies?.length) {
      for (const dep of plan.dependencies) {
        const fromId = taskIdMap[dep.from];
        const toId = taskIdMap[dep.to];
        if (fromId && toId) {
          try {
            taskAddDep(orgId, toId, fromId, namespaceId, taskWorkspaceId);
          } catch (error) {
            console.warn(`Failed to add dep ${toId} -> ${fromId}:`, error);
          }
        }
      }
    }
  } else if (hasPlan) {
    const epic = taskCreate(
      orgId,
      {
        workspace_id: taskWorkspaceId,
        title: `${decision.title || decision.prompt}: ${option.name}`,
        description: [
          ...descriptionParts,
          plan.summary ? `\nPlan: ${plan.summary}` : "",
        ].filter(Boolean).join("\n"),
        issue_type: "epic",
        priority: priorityToNumber(decision.priority),
        notes: notesParts.length > 0 ? notesParts.join("\n") : undefined,
        metadata: {
          decision_id: decisionId,
          decision_selected_option_id: selectedOptionId,
        },
      },
      namespaceId,
    );
    epicId = epic.id;
    allTaskIds.push(epicId);

    const taskIdMap: Record<string, string> = {};
    for (const [index, planTask] of plan.tasks.entries()) {
      const subtask = taskCreate(
        orgId,
        {
          workspace_id: taskWorkspaceId,
          title: planTask.title,
          description: [
            planTask.description,
            planTask.subtasks?.length
              ? `\nSubtasks:\n${planTask.subtasks.map((subtaskText) => `- ${subtaskText}`).join("\n")}`
              : "",
          ].filter(Boolean).join("\n"),
          issue_type: "task",
          priority: planTask.priority ?? priorityToNumber(decision.priority),
          parent_id: epicId,
          metadata: {
            decision_id: decisionId,
            decision_selected_option_id: selectedOptionId,
            decision_plan_task_id: planTask.id,
            decision_plan_order: index,
            decision_plan_phase: planTask.phase,
          },
        },
        namespaceId,
      );
      taskIdMap[planTask.id] = subtask.id;
      allTaskIds.push(subtask.id);
      if (existingParentTaskId) {
        followUpTaskIds.push(subtask.id);
      }
    }

    if (plan.dependencies?.length) {
      for (const dep of plan.dependencies) {
        const fromId = taskIdMap[dep.from];
        const toId = taskIdMap[dep.to];
        if (fromId && toId) {
          try {
            taskAddDep(orgId, toId, fromId, namespaceId, taskWorkspaceId);
          } catch (error) {
            console.warn(`Failed to add dep ${toId} -> ${fromId}:`, error);
          }
        }
      }
    }
  } else if (existingParentTaskId && decision.source === "completion-audit") {
    epicId = resolutionParentId ?? existingParentTaskId;
  } else {
    const task = taskCreate(
      orgId,
      {
        workspace_id: taskWorkspaceId,
        title: `${decision.title || decision.prompt}: ${option.name}`,
        description: descriptionParts.join("\n"),
        issue_type: "task",
        priority: priorityToNumber(decision.priority),
        parent_id: resolutionParentId,
        notes: notesParts.length > 0 ? notesParts.join("\n") : undefined,
        metadata: {
          decision_id: decisionId,
          decision_task_id: decisionTaskId,
          decision_parent_task_id: existingParentTaskId,
          decision_selected_option_id: selectedOptionId,
        },
      },
      namespaceId,
    );
    epicId = resolutionParentId ?? task.id;
    allTaskIds.push(task.id);
    if (existingParentTaskId) {
      followUpTaskIds.push(task.id);
    }
  }

  if (decisionTaskId) {
    taskUpdate(
      orgId,
      decisionTaskId,
      {
        status: "closed",
        metadata: {
          decision_id: decisionId,
          decision_status: "approved",
          decision_selected_option_id: selectedOptionId,
          ...(existingParentTaskId ? { decision_parent_task_id: existingParentTaskId } : {}),
        },
      },
      namespaceId,
    );
  }

  const updated = await updateDecision(
    namespaceId,
    orgId,
    decisionId,
    {
      status: "approved",
      resolution: {
        selectedOptionId,
        selectedBy,
        selectedAt: new Date().toISOString(),
        notes,
        taskId: epicId,
        ...(allTaskIds.length > 1 ? { taskIds: allTaskIds } : {}),
      },
    },
    resolvedWorkspacePath,
  );

  if (parentTask && decisionTaskId) {
    await applyResolutionLifecycle({
      namespaceId,
      orgId,
      parentTask,
      decisionTaskId,
      followUpTaskIds,
      workspaceId,
      workspacePath: resolvedWorkspacePath,
    });
  }

  return { decision: updated, taskId: epicId, taskIds: allTaskIds };
}
