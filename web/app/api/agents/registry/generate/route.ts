import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { createJob } from "@/lib/job-store";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getAgentSchema } from "@/lib/schema-loader";
import { getTemplate } from "@/lib/generation-template-storage";
import { resolveTemplate } from "@/lib/template-resolver";
import { getSessionUser } from "@/lib/auth-bridge";
import { BadRequest, InternalServerError } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { launchJobRunner } from "@/lib/job-runner-launch";
import { resolveAuthorizedWorkspacePath } from "@/lib/workspace-auth";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new InternalServerError("Authentication check failed");
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
  const schema = getAgentSchema();

  const workspaceContext = authorizedWorkspacePath
    ? `\nWORKSPACE CONTEXT: This agent will work in "${authorizedWorkspacePath}". Tailor the agent's role, expertise, and prompt to this specific codebase.\n`
    : "";

  const template = getTemplate(namespaceId, orgId, "agent_generation");
  const generationPrompt = resolveTemplate(template.content, {
    USER_PROMPT: prompt,
    SCHEMA: schema,
    WORKSPACE_CONTEXT: workspaceContext,
  });

  // create job with resolved prompt (job-runner will use it directly)
  const job = createJob("agent" as const, { prompt: generationPrompt, workspacePath: authorizedWorkspacePath }, undefined, undefined, userId, namespaceId);

  launchJobRunner({ job, namespaceId, orgId, origin: request.nextUrl.origin });

  return apiSuccess({ jobId: job.id, status: job.status });
});
