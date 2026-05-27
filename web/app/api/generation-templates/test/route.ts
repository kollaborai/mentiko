import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { resolveTemplate } from "@/lib/template-resolver";
import { createJob } from "@/lib/job-store";
import { getSessionUser } from "@/lib/auth-bridge";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { startGenerationChainRun } from "@/lib/generation-chain-dispatch";
import { resolveAuthorizedWorkspacePath } from "@/lib/workspace-auth";

export const dynamic = "force-dynamic";

// POST /api/generation-templates/test
// Run a generation prompt with the given template content (unsaved) + sample user prompt.
// Returns { jobId } — poll /api/jobs/:id for result.raw and result.parsed.
export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { content, prompt, workspacePath } = await request.json() as {
    content: string;
    prompt: string;
    workspacePath?: unknown;
  };

  if (!content || typeof content !== "string") {
    throw new BadRequest("content is required");
  }
  if (!prompt || typeof prompt !== "string") {
    throw new BadRequest("prompt is required");
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const session = await getSessionUser(request);
  const userId = session?.id;
  const authorizedWorkspacePath = resolveAuthorizedWorkspacePath(namespaceId, orgId, workspacePath, userId);
  const workspaceContext = authorizedWorkspacePath
    ? `\nWORKSPACE CONTEXT: Test this generation template against the project in "${authorizedWorkspacePath}".\n`
    : "";

  const generationPrompt = resolveTemplate(content, {
    USER_PROMPT: prompt,
    SCHEMA: "(schema omitted in preview — template variables are substituted at runtime)",
    AGENT_CATALOG: "",
    CHAIN_CATALOG: "",
    TASK_CONTEXT: "",
    WORKSPACE_CONTEXT: workspaceContext,
  });

  const job = createJob("template_test", { prompt: generationPrompt, workspacePath: authorizedWorkspacePath }, undefined, undefined, userId, namespaceId);

  await startGenerationChainRun({
    request,
    namespaceId,
    orgId,
    kind: "template_test",
    job,
    prompt: generationPrompt,
    workspacePath: authorizedWorkspacePath,
  });

  return apiSuccess({ jobId: job.id });
});
