import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getTemplate } from "@/lib/generation-template-storage";
import { resolveTemplate } from "@/lib/template-resolver";
import { createJob } from "@/lib/job-store";
import { getSessionUser } from "@/lib/auth-bridge";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { resolveAuthorizedWorkspacePath } from "@/lib/workspace-auth";
import { startGenerationChainRun } from "@/lib/generation-chain-dispatch";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { prompt, chainNames, workspacePath: requestedWorkspacePath } = await request.json();

  if (!prompt || typeof prompt !== "string") {
    throw new BadRequest("prompt is required");
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const session = await getSessionUser(request);
  const userId = session?.id;
  const authorizedWorkspacePath = resolveAuthorizedWorkspacePath(namespaceId, orgId, requestedWorkspacePath, userId);

  const chainCatalog =
    Array.isArray(chainNames) && chainNames.length > 0
      ? `AVAILABLE CHAINS:\n${chainNames.map((n: string) => `  - ${n}`).join("\n")}`
      : "AVAILABLE CHAINS: (none yet — use descriptive placeholder names)";

  const template = getTemplate(namespaceId, orgId, "event_trigger");
  const workspaceContext = authorizedWorkspacePath
    ? `\nWORKSPACE CONTEXT: The event trigger belongs to the project in "${authorizedWorkspacePath}". Prefer chain/event names that fit that codebase.\n`
    : "";
  const generationPrompt = resolveTemplate(template.content, {
    USER_PROMPT: prompt,
    CHAIN_CATALOG: chainCatalog,
    WORKSPACE_CONTEXT: workspaceContext,
  });

  const job = createJob("event_trigger", { prompt: generationPrompt, workspacePath: authorizedWorkspacePath }, undefined, undefined, userId, namespaceId);

  await startGenerationChainRun({
    request,
    namespaceId,
    orgId,
    kind: "event_trigger",
    job,
    prompt: generationPrompt,
    workspacePath: authorizedWorkspacePath,
  });

  return apiSuccess({ jobId: job.id, status: job.status });
});
