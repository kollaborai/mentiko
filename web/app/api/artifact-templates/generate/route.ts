import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { createJob } from "@/lib/job-store";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getTemplate } from "@/lib/generation-template-storage";
import { resolveTemplate } from "@/lib/template-resolver";
import { getSessionUser } from "@/lib/auth-bridge";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { startGenerationChainRun } from "@/lib/generation-chain-dispatch";
import { resolveAuthorizedWorkspacePath } from "@/lib/workspace-auth";

export const dynamic = "force-dynamic";

const ARTIFACT_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string", description: "kebab-case identifier" },
    name: { type: "string", description: "human-readable title" },
    type: {
      type: "string",
      enum: ["markdown", "json", "code", "patch", "csv", "text", "image"],
      description: "content format"
    },
    description: { type: "string", description: "one-line summary" },
    content: { type: "string", description: "template with {{PLACEHOLDER}} variables" }
  },
  required: ["id", "name", "type", "description", "content"]
};

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { prompt, workspacePath: requestedWorkspacePath } = await request.json();

  if (!prompt || typeof prompt !== "string") {
    throw new BadRequest("prompt is required", { field: "prompt" });
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const session = await getSessionUser(request);
  const userId = session?.id;
  const authorizedWorkspacePath = resolveAuthorizedWorkspacePath(namespaceId, orgId, requestedWorkspacePath, userId);
  const template = getTemplate(namespaceId, orgId, "artifact_generation");
  const workspaceContext = authorizedWorkspacePath
    ? `\nWORKSPACE CONTEXT: Generate this artifact template for the project in "${authorizedWorkspacePath}".\n`
    : "";
  const generationPrompt = resolveTemplate(template.content, {
    USER_PROMPT: prompt,
    SCHEMA: JSON.stringify(ARTIFACT_SCHEMA, null, 2),
    WORKSPACE_CONTEXT: workspaceContext,
  });

  const job = createJob("artifact" as const, { prompt: generationPrompt, workspacePath: authorizedWorkspacePath }, undefined, undefined, userId, namespaceId);

  await startGenerationChainRun({
    request,
    namespaceId,
    orgId,
    kind: "artifact",
    job,
    prompt: generationPrompt,
    workspacePath: authorizedWorkspacePath,
  });

  return apiSuccess({ jobId: job.id, status: job.status });
});
