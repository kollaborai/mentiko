import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getAllStandaloneAgents } from "@/lib/agent-loader";
import { getTemplate } from "@/lib/generation-template-storage";
import { resolveTemplate } from "@/lib/template-resolver";
import { createJob } from "@/lib/job-store";
import { getSessionUser } from "@/lib/auth-bridge";
import { BadRequest, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { startGenerationChainRun } from "@/lib/generation-chain-dispatch";
import { resolveAuthorizedWorkspacePath } from "@/lib/workspace-auth";

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
  const standaloneAgents = getAllStandaloneAgents(namespaceId, orgId);

  const agentCatalog =
    standaloneAgents.length > 0
      ? `\nAVAILABLE AGENTS (use {"$ref": "id"} to reference these):\n${standaloneAgents
          .map(
            (a) =>
              `  - id: "${a.id}", name: "${a.name}", role: "${a.role || ""}", description: "${a.description || ""}"`
          )
          .join("\n")}\n`
      : "\nNo existing agents in catalog. Create new inline agents for both positions.\n";

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
