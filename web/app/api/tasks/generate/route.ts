import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { enforceGuestWrites } from "@/lib/middleware";
import { createJob } from "@/lib/runs/job-store";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getTaskSchema } from "@/lib/schema-loader";
import { getTemplate } from "@/lib/generation/generation-template-storage";
import { resolveTemplate } from "@/lib/system/template-resolver";
import { getSessionUser } from "@/lib/auth/auth-bridge";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { resolveAuthorizedWorkspacePath } from "@/lib/auth/workspace-auth";
import { startGenerationChainRun } from "@/lib/generation/generation-chain-dispatch";
import { shouldRouteTaskPromptToDecision } from "@/lib/tasks/task-decision-routing";
import { createTaskDecision } from "@/lib/tasks/task-decision-link";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (request: NextRequest) => {
  const blockResult = await enforceGuestWrites(request);
  if (blockResult?.blocked) return blockResult.response;

  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { prompt, workspacePath, parentId, autoRun, sendToDecisionIfWarranted, mode } = await request.json();

  if (!prompt || typeof prompt !== "string") {
    throw new BadRequest("prompt is required", { field: "prompt" });
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const session = await getSessionUser(request);
  const userId = session?.id;
  const authorizedWorkspacePath = resolveAuthorizedWorkspacePath(namespaceId, orgId, workspacePath, userId);

  if (mode === "decision" || (
    sendToDecisionIfWarranted === true &&
    shouldRouteTaskPromptToDecision(prompt)
  )) {
    const { decision, task } = await createTaskDecision({
      namespaceId,
      orgId,
      prompt,
      source: mode === "decision" ? "task-generate-decision" : "task-generate",
      workspacePath: authorizedWorkspacePath,
      parentTaskId: typeof parentId === "string" && parentId.trim()
        ? parentId.trim()
        : undefined,
    });

    return apiSuccess({
      routedTo: "decision",
      decisionId: decision.id,
      taskId: task.id,
      decision,
      task,
    }, undefined, 201);
  }

  const workspaceContext = authorizedWorkspacePath
    ? `\nWORKSPACE CONTEXT: These tasks are for the project in "${authorizedWorkspacePath}". Tailor task descriptions and scope to this specific codebase.\n`
    : "";

  const schema = getTaskSchema();
  const template = getTemplate(namespaceId, orgId, "task_generation");
  const generationPrompt = resolveTemplate(template.content, {
    USER_PROMPT: prompt,
    SCHEMA: schema,
    WORKSPACE_CONTEXT: workspaceContext,
  });

  // create job with resolved prompt (job-runner will use it directly)
  const job = createJob(
    "task" as const,
    {
      prompt: generationPrompt,
      workspacePath: authorizedWorkspacePath,
      ...(typeof parentId === "string" && parentId.trim() ? { parentId: parentId.trim() } : {}),
      ...(autoRun === true ? { autoRun: true } : {}),
    },
    undefined,
    undefined,
    userId,
    namespaceId,
  );

  const run = await startGenerationChainRun({
    request,
    namespaceId,
    orgId,
    kind: "task",
    job,
    prompt: generationPrompt,
    workspacePath: authorizedWorkspacePath,
  });

  return apiSuccess({ jobId: job.id, runId: run.runId, status: job.status });
});
