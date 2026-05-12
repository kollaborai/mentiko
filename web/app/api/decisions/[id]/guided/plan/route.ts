import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getDecision, updateDecision } from "@/lib/decision-storage";
import { getWorkspacePath } from "@/lib/workspace-params";
import { getTemplate } from "@/lib/generation-template-storage";
import { resolveTemplate } from "@/lib/template-resolver";
import { createJob, getJob } from "@/lib/job-store";
import { getSessionUser } from "@/lib/auth-bridge";
import type { GuidedFlow, ExecutionPlan } from "@/lib/decision-types";
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
  // inbox-key bypass for MCP ops routes
  const inboxKey = request.headers.get("X-Mentiko-Inbox-Key");
  const skipAuth = inboxKey && inboxKey === process.env.MENTIKO_INBOX_KEY;

  if (!skipAuth && !(await checkAuth(request))) {
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
    ? `\nWORKSPACE CONTEXT: This decision belongs to the project in "${authorizedWorkspacePath}". Tailor the execution plan to this specific codebase when relevant.\n`
    : "";

  let body: { jobId?: string; selectedOptionId?: string } = {};
  try { body = await request.json(); } catch { /* empty ok */ }

  if (body.jobId) {
    const job = getJob(body.jobId, namespaceId);
    if (!job) throw new NotFound("Job", body.jobId);
    if (job.status === "failed") throw new InternalServerError(job.error || "Job failed");
    if (job.status !== "complete") throw new BadRequest("Job not complete");

    const parsed = job.result as unknown as ExecutionPlan;
    const decision = getDecision(namespaceId, orgId, id, workspacePath);
    if (!decision) throw new NotFound("Decision", id);

    const guidedFlow = decision.guidedFlow as GuidedFlow;
    if (!guidedFlow) throw new BadRequest("No guided flow");

    guidedFlow.currentRound = 3;
    guidedFlow.round3.status = "ready";
    guidedFlow.round3.plan = parsed;
    guidedFlow.round3.generationJobId = undefined;

    const updated = await updateDecision(namespaceId, orgId, id, { guidedFlow }, workspacePath);
    return apiSuccess({ decision: updated, plan: parsed });
  }

  const decision = getDecision(namespaceId, orgId, id, workspacePath);
  if (!decision) throw new NotFound("Decision", id);

  const guidedFlow = decision.guidedFlow as GuidedFlow;
  if (!guidedFlow) throw new BadRequest("No guided flow");

  const selectedId = body.selectedOptionId || guidedFlow.round2.selectedOptionId;
  const selectedOption = guidedFlow.round2.tailoredOptions.find((o) => o.id === selectedId)
    || decision.options.find((o) => o.id === selectedId);

  if (!selectedOption) throw new BadRequest("No option selected");

  const contextParts = [buildDecisionContext(decision), workspaceContext].filter(Boolean).join("\n\n");
  const preferenceText = buildPreferenceText(guidedFlow);

  const template = getTemplate(namespaceId, orgId, "decision_guided_plan");
  const prompt = resolveTemplate(template.content, {
    DECISION_CONTEXT: contextParts,
    SELECTED_OPTION: `${selectedOption.letter}. ${selectedOption.name}: ${selectedOption.description}\nEffort: ${selectedOption.effort}\nRisk: ${selectedOption.risk}\nPros: ${selectedOption.pros.join(", ")}\nCons: ${selectedOption.cons.join(", ")}`,
    USER_PREFERENCES: preferenceText,
  });

  const job = createJob("decision_guided_plan", { prompt, workspacePath: authorizedWorkspacePath }, undefined, id, userId, namespaceId);

  guidedFlow.round2.selectedOptionId = selectedId;
  guidedFlow.round3.status = "generating";
  guidedFlow.round3.generationJobId = job.id;
  await updateDecision(namespaceId, orgId, id, { guidedFlow }, workspacePath);

  launchJobRunner({ job, namespaceId, orgId, origin: request.nextUrl.origin });

  return apiSuccess({ jobId: job.id, status: job.status });
});
