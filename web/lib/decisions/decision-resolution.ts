import { getDecision, updateDecision } from "@/lib/decisions/decision-storage";
import { taskAddDep, taskCreate, taskGet, taskUpdate } from "@/lib/tasks/task-store";
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
  if (existingParentTaskId) {
    const parentTask = taskGet(orgId, existingParentTaskId, namespaceId);
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

  let epicId: string;
  const allTaskIds: string[] = [];
  if (decisionTaskId) {
    allTaskIds.push(decisionTaskId);
  }

  if (hasPlan && existingParentTaskId) {
    epicId = existingParentTaskId;
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
          parent_id: existingParentTaskId,
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
  } else {
    const task = taskCreate(
      orgId,
      {
        workspace_id: taskWorkspaceId,
        title: `${decision.title || decision.prompt}: ${option.name}`,
        description: descriptionParts.join("\n"),
        issue_type: "task",
        priority: priorityToNumber(decision.priority),
        parent_id: existingParentTaskId,
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
    epicId = existingParentTaskId ?? task.id;
    allTaskIds.push(task.id);
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

  return { decision: updated, taskId: epicId, taskIds: allTaskIds };
}
