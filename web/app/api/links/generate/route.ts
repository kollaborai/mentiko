import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { buildAgentCatalog } from "@/lib/agents/agent-catalog";
import { getTemplate } from "@/lib/generation/generation-template-storage";
import { resolveTemplate } from "@/lib/system/template-resolver";
import { createJob } from "@/lib/runs/job-store";
import { getSessionUser } from "@/lib/auth/auth-bridge";
import { BadRequest, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { startGenerationChainRun } from "@/lib/generation/generation-chain-dispatch";
import { resolveAuthorizedWorkspacePath } from "@/lib/auth/workspace-auth";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (request: NextRequest) => {
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
  const agentCatalog = buildAgentCatalog(namespaceId, orgId, { query: prompt });

  const workspaceContext = authorizedWorkspacePath
    ? `\nWORKSPACE CONTEXT: The agents will work in "${authorizedWorkspacePath}". Tailor agent roles, prompts, and expertise to this specific codebase. Reference it by name in the leading prompt so agents know where to look.\n`
    : "";

  const template = getTemplate(namespaceId, orgId, "link_generation");
  const generationPrompt = resolveTemplate(template.content, {
    USER_PROMPT: prompt,
    AGENT_CATALOG: agentCatalog,
    WORKSPACE_CONTEXT: workspaceContext,
  });

  const job = createJob("link", { prompt: generationPrompt, workspacePath: authorizedWorkspacePath }, undefined, undefined, userId, namespaceId);
  await startGenerationChainRun({
    request,
    namespaceId,
    orgId,
    kind: "link",
    job,
    prompt: generationPrompt,
    workspacePath: authorizedWorkspacePath,
  });

  return apiSuccess({ jobId: job.id, status: job.status });
});
