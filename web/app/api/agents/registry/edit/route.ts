import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { createJob } from "@/lib/job-store";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
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

  const { agentJson, instructions, workspacePath } = await request.json();

  if (!agentJson || typeof agentJson !== "object") {
    throw new BadRequest("agentJson is required", { field: "agentJson" });
  }
  if (!instructions || typeof instructions !== "string") {
    throw new BadRequest("instructions are required", { field: "instructions" });
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const session = await getSessionUser(request);
  const userId = session?.id;
  const authorizedWorkspacePath = resolveAuthorizedWorkspacePath(namespaceId, orgId, workspacePath, userId);
  const workspaceContext = authorizedWorkspacePath
    ? `\nWORKSPACE CONTEXT: This agent will work in "${authorizedWorkspacePath}". Tailor edits to this specific codebase.\n`
    : "";
  const template = getTemplate(namespaceId, orgId, "agent_edit");
  const editPrompt = resolveTemplate(template.content, {
    AGENT_JSON: JSON.stringify(agentJson, null, 2),
    USER_INSTRUCTIONS: instructions,
    WORKSPACE_CONTEXT: workspaceContext,
  });

  const job = createJob("agent_edit", { prompt: editPrompt, workspacePath: authorizedWorkspacePath }, undefined, undefined, userId, namespaceId);

  launchJobRunner({ job, namespaceId, orgId, origin: request.nextUrl.origin });

  return apiSuccess({ jobId: job.id, status: job.status });
});
