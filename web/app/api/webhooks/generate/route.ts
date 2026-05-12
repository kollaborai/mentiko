import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getTemplate } from "@/lib/generation-template-storage";
import { resolveTemplate } from "@/lib/template-resolver";
import { createJob } from "@/lib/job-store";
import { getSessionUser } from "@/lib/auth-bridge";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { launchJobRunner } from "@/lib/job-runner-launch";
import { resolveAuthorizedWorkspacePath } from "@/lib/workspace-auth";

export const dynamic = "force-dynamic";

const MENTIKO_EVENTS = [
  "chain_started", "chain_complete", "chain_failed",
  "agent_started", "agent_complete", "agent_error",
  "run_started", "run_complete", "run_failed",
  "schedule_triggered",
];

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { prompt, webhookType, workspacePath: requestedWorkspacePath } = await request.json();

  if (!prompt || typeof prompt !== "string") {
    throw new BadRequest("prompt is required", { field: "prompt" });
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const session = await getSessionUser(request);
  const userId = session?.id;
  const authorizedWorkspacePath = resolveAuthorizedWorkspacePath(namespaceId, orgId, requestedWorkspacePath, userId);
  const isInbound = webhookType === "inbound";

  const templateId = isInbound ? "webhook_inbound" : "webhook_outbound";
  const template = getTemplate(namespaceId, orgId, templateId);
  const workspaceContext = authorizedWorkspacePath
    ? `\nWORKSPACE CONTEXT: Generate this webhook for the project in "${authorizedWorkspacePath}". Use chain/event assumptions that fit that codebase.\n`
    : "";
  const generationPrompt = resolveTemplate(template.content, {
    USER_PROMPT: prompt,
    MENTIKO_EVENTS: MENTIKO_EVENTS.map((e) => `  - ${e}`).join("\n"),
    WORKSPACE_CONTEXT: workspaceContext,
  });

  const jobType = isInbound ? "webhook_inbound" : "webhook_outbound";
  const job = createJob(jobType, { prompt: generationPrompt, workspacePath: authorizedWorkspacePath }, undefined, undefined, userId, namespaceId);

  launchJobRunner({ job, namespaceId, orgId, origin: request.nextUrl.origin });

  return apiSuccess({ jobId: job.id, status: job.status });
});
