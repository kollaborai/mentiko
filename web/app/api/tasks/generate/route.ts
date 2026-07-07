import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { enforceGuestWrites } from "@/lib/middleware";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getTaskSchema } from "@/lib/schema-loader";
import { getTemplate } from "@/lib/generation/generation-template-storage";
import { resolveTemplate } from "@/lib/system/template-resolver";
import { getSessionUser } from "@/lib/auth/auth-bridge";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { resolveAuthorizedWorkspacePath } from "@/lib/auth/workspace-auth";
import { startGenerationJob } from "@/lib/generation/generation-chain-dispatch";
import { createTaskDecision } from "@/lib/tasks/task-decision-link";
import { resolveTaskAutoRunDefault } from "@/lib/tasks/task-auto-run-default";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (request: NextRequest) => {
  const blockResult = await enforceGuestWrites(request);
  if (blockResult?.blocked) return blockResult.response;

  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { prompt, workspacePath, parentId, autoRun, sendToDecisionIfWarranted = true, mode } = await request.json();

  if (!prompt || typeof prompt !== "string") {
    throw new BadRequest("prompt is required", { field: "prompt" });
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const session = await getSessionUser(request);
  const userId = session?.id;
  const authorizedWorkspacePath = resolveAuthorizedWorkspacePath(namespaceId, orgId, workspacePath, userId);
  const resolvedAutoRun = resolveTaskAutoRunDefault({
    namespaceId,
    orgId,
    workspacePath: authorizedWorkspacePath || undefined,
    explicitAutoRun: typeof autoRun === "boolean" ? autoRun : undefined,
  });
  const trimmedPrompt = prompt.trim();
  const allowDecisionRouting = sendToDecisionIfWarranted !== false;

  // Explicit decision mode: skip generation, create a decision directly.
  if (mode === "decision") {
    const { decision, task } = await createTaskDecision({
      namespaceId,
      orgId,
      prompt: trimmedPrompt,
      source: "task-generate-decision",
      workspacePath: authorizedWorkspacePath,
      parentTaskId: typeof parentId === "string" && parentId.trim() ? parentId.trim() : undefined,
    });

    return apiSuccess({
      routedTo: "decision",
      decisionId: decision.id,
      taskId: task.id,
      decision,
      task,
    }, undefined, 201);
  }

  // Task mode: the generation agent gates task-vs-decision in its output.
  // The completion backstop (/api/jobs/[id]/complete) honors the agent's
  // route decision. sendToDecisionIfWarranted (default on; the dialog toggle)
  // controls whether the agent is allowed to route to a decision.
  const workspaceContext = authorizedWorkspacePath
    ? `\nWORKSPACE CONTEXT: These tasks are for the project in "${authorizedWorkspacePath}". Tailor task descriptions and scope to this specific codebase.\n`
    : "";
  const allowDecisionRoutingContext = allowDecisionRouting
    ? ""
    : "\nDECISION ROUTING DISABLED: you MUST output route \"task\". Never choose \"decision\".\n";

  const schema = getTaskSchema();
  const template = getTemplate(namespaceId, orgId, "task_generation");
  const generationPrompt = resolveTemplate(template.content, {
    USER_PROMPT: trimmedPrompt,
    SCHEMA: schema,
    WORKSPACE_CONTEXT: workspaceContext,
    ALLOW_DECISION_ROUTING: allowDecisionRoutingContext,
  });

  const handle = await startGenerationJob({
    request,
    namespaceId,
    orgId,
    kind: "task",
    prompt: generationPrompt,
    workspacePath: authorizedWorkspacePath || undefined,
    userId,
    jobInput: {
      ...(typeof parentId === "string" && parentId.trim() ? { parentId: parentId.trim() } : {}),
      autoRun: resolvedAutoRun,
      allowDecisionRouting,
    },
  });

  return apiSuccess({ jobId: handle.jobId, runId: handle.runId, status: handle.status });
});
