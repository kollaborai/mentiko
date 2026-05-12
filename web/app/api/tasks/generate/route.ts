import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { enforceGuestWrites } from "@/lib/middleware";
import { createJob } from "@/lib/job-store";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getTaskSchema } from "@/lib/schema-loader";
import { getTemplate } from "@/lib/generation-template-storage";
import { resolveTemplate } from "@/lib/template-resolver";
import { getSessionUser } from "@/lib/auth-bridge";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { launchJobRunner } from "@/lib/job-runner-launch";
import { resolveAuthorizedWorkspacePath } from "@/lib/workspace-auth";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (request: NextRequest) => {
  const blockResult = await enforceGuestWrites(request);
  if (blockResult?.blocked) return blockResult.response;

  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { prompt, workspacePath } = await request.json();

  if (!prompt || typeof prompt !== "string") {
    throw new BadRequest("prompt is required", { field: "prompt" });
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const session = await getSessionUser(request);
  const userId = session?.id;
  const authorizedWorkspacePath = resolveAuthorizedWorkspacePath(namespaceId, orgId, workspacePath, userId);

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
  const job = createJob("task" as const, { prompt: generationPrompt, workspacePath: authorizedWorkspacePath }, undefined, undefined, userId, namespaceId);

  launchJobRunner({ job, namespaceId, orgId, origin: request.nextUrl.origin });

  return apiSuccess({ jobId: job.id, status: job.status });
});
