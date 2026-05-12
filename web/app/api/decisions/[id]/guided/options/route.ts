import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getDecision, updateDecision } from "@/lib/decision-storage";
import { getWorkspacePath } from "@/lib/workspace-params";
import { getTemplate } from "@/lib/generation-template-storage";
import { resolveTemplate } from "@/lib/template-resolver";
import { createJob, getJob } from "@/lib/job-store";
import { getSessionUser } from "@/lib/auth-bridge";
import type { GuidedFlow, TailoredOption, Recommendation } from "@/lib/decision-types";
import { buildDecisionContext, buildPreferenceText } from "@/lib/decision-context";
import { Unauthorized, NotFound, BadRequest, InternalServerError } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { launchJobRunner } from "@/lib/job-runner-launch";
import { resolveAuthorizedWorkspacePath } from "@/lib/workspace-auth";

export const dynamic = "force-dynamic";

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
    ? `\nWORKSPACE CONTEXT: This decision belongs to the project in "${authorizedWorkspacePath}". Tailor options to this specific codebase when relevant.\n`
    : "";

  let body: { jobId?: string; preferences?: Record<string, string> } = {};
  try { body = await request.json(); } catch { /* empty ok */ }

  if (body.jobId) {
    const job = getJob(body.jobId, namespaceId);
    if (!job) throw new NotFound("Job", body.jobId);
    if (job.status === "failed") throw new InternalServerError(job.error || "Job failed");
    if (job.status !== "complete") throw new BadRequest("Job not complete");

    const parsed = job.result as { options?: TailoredOption[]; recommendation?: Recommendation };
    const decision = getDecision(namespaceId, orgId, id, workspacePath);
    if (!decision) throw new NotFound("Decision", id);

    const guidedFlow = decision.guidedFlow as GuidedFlow;
    if (!guidedFlow) throw new BadRequest("No guided flow");

    guidedFlow.currentRound = 2;
    guidedFlow.round2.status = "ready";
    guidedFlow.round2.tailoredOptions = parsed.options || [];
    guidedFlow.round2.generationJobId = undefined;

    const updated = await updateDecision(namespaceId, orgId, id, {
      guidedFlow,
      options: (parsed.options || []).map((o) => ({
        id: o.id,
        letter: o.letter,
        name: o.name,
        description: o.description,
        pros: o.pros,
        cons: o.cons,
        effort: o.effort,
        risk: o.risk,
      })),
      recommendation: parsed.recommendation,
    }, workspacePath);
    return apiSuccess({ decision: updated, options: parsed.options });
  }

  const decision = getDecision(namespaceId, orgId, id, workspacePath);
  if (!decision) throw new NotFound("Decision", id);

  const guidedFlow = decision.guidedFlow as GuidedFlow;
  if (!guidedFlow) throw new BadRequest("No guided flow");

  const contextParts = [buildDecisionContext(decision), workspaceContext].filter(Boolean).join("\n\n");
  const preferenceText = buildPreferenceText(guidedFlow);
  const constraints = decision.context?.constraints?.join("; ") || "none specified";

  const template = getTemplate(namespaceId, orgId, "decision_guided_options");
  const prompt = resolveTemplate(template.content, {
    DECISION_CONTEXT: contextParts,
    PREFERENCE_PROFILE: preferenceText,
    CONSTRAINTS: constraints,
  });

  const job = createJob("decision_guided_options", { prompt, workspacePath: authorizedWorkspacePath }, undefined, id, userId, namespaceId);

  guidedFlow.round2.status = "generating";
  guidedFlow.round2.generationJobId = job.id;
  await updateDecision(namespaceId, orgId, id, { guidedFlow }, workspacePath);

  launchJobRunner({ job, namespaceId, orgId, origin: request.nextUrl.origin });

  return apiSuccess({ jobId: job.id, status: job.status });
});
