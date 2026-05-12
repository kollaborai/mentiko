import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getDecision, updateDecision } from "@/lib/decision-storage";
import { getWorkspacePath } from "@/lib/workspace-params";
import { getTemplate } from "@/lib/generation-template-storage";
import { resolveTemplate } from "@/lib/template-resolver";
import { createJob, getJob } from "@/lib/job-store";
import { getSessionUser } from "@/lib/auth-bridge";
import type { Decision } from "@/lib/decision-types";
import { Unauthorized, NotFound, BadRequest, InternalServerError } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { launchJobRunner } from "@/lib/job-runner-launch";
import { resolveAuthorizedWorkspacePath } from "@/lib/workspace-auth";

export const dynamic = "force-dynamic";

function buildDecisionContext(decision: Decision): string {
  const selectedOption = decision.options.find(
    (o) => o.id === decision.resolution?.selectedOptionId
  );
  return [
    `DECISION: ${decision.title}`,
    `ORIGINAL PROBLEM: ${decision.context?.problem || decision.prompt}`,
    `IMPACT: ${decision.context?.whyProblem || "not specified"}`,
    `\nCHOSEN APPROACH: ${selectedOption?.name || "unknown"}`,
    selectedOption?.description || "",
    `\nAPPROVAL NOTES: ${decision.resolution?.notes || "none"}`,
  ].filter(Boolean).join("\n");
}

export const POST = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized("Authentication required");
  }

  const { id } = await context.params;
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const workspacePath = getWorkspacePath(request);
  const session = await getSessionUser(request);
  const userId = session?.id;
  const authorizedWorkspacePath = resolveAuthorizedWorkspacePath(namespaceId, orgId, workspacePath, userId);
  const workspaceContext = authorizedWorkspacePath
    ? `\nWORKSPACE CONTEXT: This retrospective belongs to the project in "${authorizedWorkspacePath}". Ground lessons and follow-up actions in this codebase when relevant.\n`
    : "";

  let body: { jobId?: string } = {};
  try { body = await request.json(); } catch { /* empty body ok */ }

  // phase 2: apply completed job result to decision
  if (body.jobId) {
    const job = getJob(body.jobId, namespaceId);
    if (!job) throw new NotFound("Job", body.jobId);
    if (job.status === "failed") throw new InternalServerError(job.error || "Job failed");
    if (job.status !== "complete") throw new BadRequest("Job not complete");

    const parsed = job.result as Record<string, unknown>;
    const retro = {
      summary: (parsed.summary as string) || "",
      outcome: (parsed.outcome as string) || "",
      lessonsLearned: (parsed.lessonsLearned as string[]) || [],
      completedAt: new Date().toISOString(),
    };

    const updated = await updateDecision(namespaceId, orgId, id, { status: "done", retrospective: retro, retroJobId: undefined }, workspacePath);
    return apiSuccess({ decision: updated });
  }

  // phase 1: start retrospective job
  const decision = getDecision(namespaceId, orgId, id, workspacePath);
  if (!decision) throw new NotFound("Decision", id);
  if (!decision.resolution) {
    throw new BadRequest("Decision has no resolution to review");
  }

  const template = getTemplate(namespaceId, orgId, "decision_retrospective");
  const retroPrompt = resolveTemplate(template.content, {
    DECISION_CONTEXT: [buildDecisionContext(decision), workspaceContext].filter(Boolean).join("\n\n"),
  });

  const job = createJob("decision_retrospective", { prompt: retroPrompt, workspacePath: authorizedWorkspacePath }, undefined, id, userId, namespaceId);

  await updateDecision(namespaceId, orgId, id, { retroJobId: job.id }, workspacePath);

  launchJobRunner({ job, namespaceId, orgId, origin: request.nextUrl.origin });

  return apiSuccess({ jobId: job.id, status: job.status });
});
