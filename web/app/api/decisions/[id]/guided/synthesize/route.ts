import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getDecision, updateDecision } from "@/lib/decision-storage";
import { getWorkspacePath } from "@/lib/workspace-params";
import { getTemplate } from "@/lib/generation-template-storage";
import { resolveTemplate } from "@/lib/template-resolver";
import { createJob, getJob } from "@/lib/job-store";
import { getSessionUser } from "@/lib/auth-bridge";
import type { GuidedFlow, PreferenceProfile } from "@/lib/decision-types";
import { Unauthorized, NotFound, BadRequest, InternalServerError } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { launchJobRunner } from "@/lib/job-runner-launch";
import { resolveAuthorizedWorkspacePath } from "@/lib/workspace-auth";

export const dynamic = "force-dynamic";

function buildDecisionContext(decision: ReturnType<typeof getDecision>): string {
  if (!decision) return "";
  return [
    `DECISION: ${decision.prompt}`,
    decision.title ? `Title: ${decision.title}` : "",
    decision.context?.problem ? `Problem: ${decision.context.problem}` : "",
    decision.context?.currentState ? `Current State: ${decision.context.currentState}` : "",
    decision.context?.whyProblem ? `Impact: ${decision.context.whyProblem}` : "",
    decision.context?.affectedAreas?.length ? `Affected Areas: ${decision.context.affectedAreas.join(", ")}` : "",
    decision.context?.constraints?.length ? `Constraints: ${decision.context.constraints.join("; ")}` : "",
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
    ? `\nWORKSPACE CONTEXT: This decision belongs to the project in "${authorizedWorkspacePath}". Tailor preference synthesis to this specific codebase when relevant.\n`
    : "";

  let body: { jobId?: string } = {};
  try { body = await request.json(); } catch { /* empty ok */ }

  if (body.jobId) {
    const job = getJob(body.jobId, namespaceId);
    if (!job) throw new NotFound("Job", body.jobId);
    if (job.status === "failed") throw new InternalServerError(job.error || "Job failed");
    if (job.status !== "complete") throw new BadRequest("Job not complete");

    const parsed = job.result as unknown as PreferenceProfile;
    const decision = getDecision(namespaceId, orgId, id, workspacePath);
    if (!decision) throw new NotFound("Decision", id);

    const guidedFlow = decision.guidedFlow as GuidedFlow;
    if (!guidedFlow) throw new BadRequest("No guided flow");

    guidedFlow.round1.preferenceProfile = parsed;
    guidedFlow.round1.status = "complete";
    guidedFlow.round1.synthesisJobId = undefined;

    const updated = await updateDecision(namespaceId, orgId, id, { guidedFlow }, workspacePath);
    return apiSuccess({ decision: updated, preferenceProfile: parsed });
  }

  const decision = getDecision(namespaceId, orgId, id, workspacePath);
  if (!decision) throw new NotFound("Decision", id);

  const guidedFlow = decision.guidedFlow as GuidedFlow;
  if (!guidedFlow) throw new BadRequest("No guided flow");

  const questionsAndAnswers = guidedFlow.round1.answers.map((a) => {
    const q = guidedFlow.round1.questions.find((qq) => qq.id === a.questionId);
    if (!q) return "";
    const chosenLabel = a.choice === "a" ? q.optionA.label : q.optionB.label;
    const otherLabel = a.choice === "a" ? q.optionB.label : q.optionA.label;
    return `- ${q.category} (weight: ${q.weight}): chose '${chosenLabel}' over '${otherLabel}'`;
  }).filter(Boolean).join("\n");

  const template = getTemplate(namespaceId, orgId, "preference_synthesis");
  const prompt = resolveTemplate(template.content, {
    DECISION_CONTEXT: [buildDecisionContext(decision), workspaceContext].filter(Boolean).join("\n\n"),
    QUESTIONS_AND_ANSWERS: questionsAndAnswers,
  });

  const job = createJob("preference_synthesis", { prompt, workspacePath: authorizedWorkspacePath }, undefined, id, userId, namespaceId);

  guidedFlow.round1.status = "synthesizing";
  guidedFlow.round1.synthesisJobId = job.id;
  await updateDecision(namespaceId, orgId, id, { guidedFlow }, workspacePath);

  launchJobRunner({ job, namespaceId, orgId, origin: request.nextUrl.origin });

  return apiSuccess({ jobId: job.id, status: job.status });
});
