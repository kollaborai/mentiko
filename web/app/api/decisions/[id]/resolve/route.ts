import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getDecision, updateDecision } from "@/lib/decision-storage";
import { taskCreate, taskAddDep } from "@/lib/task-store";
import { getWorkspaceId, getWorkspacePath } from "@/lib/workspace-params";
import type { ExecutionPlan } from "@/lib/decision-types";
import { Unauthorized, NotFound, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

function priorityToNumber(priority?: string): number {
  if (!priority) return 2;
  const match = priority.match(/p(\d)/);
  return match ? parseInt(match[1], 10) : 2;
}

export const POST = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized("Authentication required");
  }

  const { id } = await context.params;
  const nsId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const workspaceId = getWorkspaceId(request);
  const workspacePath = getWorkspacePath(request);
  const decision = getDecision(nsId, orgId, id, workspacePath);

  if (!decision) {
    throw new NotFound("Decision", id);
  }

  if (decision.status !== "pending" && decision.status !== "briefed") {
    throw new BadRequest(`Cannot resolve decision in status: ${decision.status}`);
  }

  const { selectedOptionId, notes } = await request.json();

  if (!selectedOptionId) {
    throw new BadRequest("selectedOptionId is required");
  }

  const option = decision.options.find((o) => o.id === selectedOptionId);
  if (!option) {
    throw new NotFound("Option", selectedOptionId);
  }

  const descriptionParts = [];
  if (decision.context) {
    descriptionParts.push(`Problem: ${decision.context.problem}`);
    if (decision.context.whyProblem) {
      descriptionParts.push(`Impact: ${decision.context.whyProblem}`);
    }
  }
  descriptionParts.push(`\nApproach: ${option.name}`);
  descriptionParts.push(option.description);

  // build research notes with full context for the task
  const notesParts: string[] = [];
  if (decision.context) {
    if (decision.context.currentState) {
      notesParts.push(`Current state: ${decision.context.currentState}`);
    }
    if (decision.context.affectedAreas?.length) {
      notesParts.push(`\nAffected areas:\n${decision.context.affectedAreas.map((a) => `- ${a}`).join("\n")}`);
    }
    if (decision.context.constraints?.length) {
      notesParts.push(`\nConstraints:\n${decision.context.constraints.map((c) => `- ${c}`).join("\n")}`);
    }
    if (decision.context.references?.length) {
      notesParts.push(`\nReferences:\n${decision.context.references.map((r) => `- ${r}`).join("\n")}`);
    }
  }
  // include other options that were considered
  const otherOptions = decision.options.filter((o) => o.id !== selectedOptionId);
  if (otherOptions.length) {
    notesParts.push(
      `\nAlternatives considered:\n${otherOptions.map((o) => `- ${o.letter}. ${o.name}: ${o.description}`).join("\n")}`
    );
  }
  if (decision.recommendation) {
    notesParts.push(`\nAI recommendation: ${decision.recommendation.rationale} (confidence: ${decision.recommendation.confidence})`);
  }

  // check if guided flow has a plan with subtasks
  const plan = decision.guidedFlow?.round3?.plan as ExecutionPlan | undefined;
  const hasPlan = plan && Array.isArray(plan.tasks) && plan.tasks.length > 0;

  let epicId: string;
  const allTaskIds: string[] = [];

  if (hasPlan) {
    // create epic (parent task) from the decision
    const epic = taskCreate(orgId, {
      workspace_id: workspaceId,
      title: `${decision.title || decision.prompt}: ${option.name}`,
      description: [
        ...descriptionParts,
        plan.summary ? `\nPlan: ${plan.summary}` : "",
      ].filter(Boolean).join("\n"),
      issue_type: "epic",
      priority: priorityToNumber(decision.priority),
      notes: notesParts.length > 0 ? notesParts.join("\n") : undefined,
      metadata: { decision_id: id },
    });
    epicId = epic.id;
    allTaskIds.push(epicId);

    // create subtasks grouped by phase
    const taskIdMap: Record<string, string> = {}; // plan task id -> task id
    for (const planTask of plan.tasks) {
      const subtask = taskCreate(orgId, {
        workspace_id: workspaceId,
        title: planTask.title,
        description: [
          planTask.description,
          planTask.subtasks?.length ? `\nSubtasks:\n${planTask.subtasks.map((s) => `- ${s}`).join("\n")}` : "",
        ].filter(Boolean).join("\n"),
        issue_type: "task",
        priority: planTask.priority ?? priorityToNumber(decision.priority),
        parent_id: epicId,
        metadata: { decision_id: id },
      });
      taskIdMap[planTask.id] = subtask.id;
      allTaskIds.push(subtask.id);
    }

    // wire up dependencies
    if (plan.dependencies?.length) {
      for (const dep of plan.dependencies) {
        const fromId = taskIdMap[dep.from];
        const toId = taskIdMap[dep.to];
        if (fromId && toId) {
          try { taskAddDep(orgId, toId, fromId); } catch (e) {
            console.warn(`Failed to add dep ${toId} -> ${fromId}:`, e);
          }
        }
      }
    }
  } else {
    // no plan - single task (backward compat)
    const task = taskCreate(orgId, {
      workspace_id: workspaceId,
      title: `${decision.title || decision.prompt}: ${option.name}`,
      description: descriptionParts.join("\n"),
      issue_type: "task",
      priority: priorityToNumber(decision.priority),
      notes: notesParts.length > 0 ? notesParts.join("\n") : undefined,
      metadata: { decision_id: id },
    });
    epicId = task.id;
    allTaskIds.push(epicId);
  }

  const updated = await updateDecision(nsId, orgId, id, {
    status: "approved",
    resolution: {
      selectedOptionId,
      selectedBy: "user",
      selectedAt: new Date().toISOString(),
      notes,
      taskId: epicId,
      ...(allTaskIds.length > 1 ? { taskIds: allTaskIds } : {}),
    },
  }, workspacePath);

  return apiSuccess({ decision: updated, taskId: epicId, taskIds: allTaskIds });
});
