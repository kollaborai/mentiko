import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getDecision, updateDecision } from "@/lib/decision-storage";
import { getWorkspacePath } from "@/lib/workspace-params";
import { getTemplate } from "@/lib/generation-template-storage";
import { resolveTemplate } from "@/lib/template-resolver";
import { getJob } from "@/lib/job-store";
import { getSessionUser } from "@/lib/auth-bridge";
import type { GuidedFlow, TradeoffQuestion } from "@/lib/decision-types";
import { buildDecisionContext } from "@/lib/decision-context";
import { Unauthorized, NotFound, BadRequest, InternalServerError } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { resolveAuthorizedWorkspacePath } from "@/lib/workspace-auth";
import { startDecisionChainRun } from "@/lib/decision-chain-dispatch";

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
    ? `\nWORKSPACE CONTEXT: This decision belongs to the project in "${authorizedWorkspacePath}". Tailor questions to this specific codebase when relevant.\n`
    : "";

  let body: { jobId?: string } = {};
  try { body = await request.json(); } catch { /* empty ok */ }

  if (body.jobId) {
    const job = getJob(body.jobId, namespaceId);
    if (!job) throw new NotFound("Job", body.jobId);
    if (job.status === "failed") throw new InternalServerError(job.error || "Job failed");
    if (job.status !== "complete") throw new BadRequest("Job not complete");

    const parsed = job.result as { questions?: TradeoffQuestion[] };
    const decision = getDecision(namespaceId, orgId, id, workspacePath);
    if (!decision) throw new NotFound("Decision", id);

    const guidedFlow: GuidedFlow = decision.guidedFlow || {
      currentRound: 1,
      round1: { status: "in_progress", questions: [], answers: [] },
      round2: { status: "pending", tailoredOptions: [] },
      round3: { status: "pending" },
    };

    guidedFlow.currentRound = 1;
    guidedFlow.round1.status = "in_progress";
    guidedFlow.round1.questions = parsed.questions || [];
    guidedFlow.round1.generationJobId = undefined;
    guidedFlow.startedAt = guidedFlow.startedAt || new Date().toISOString();

    const updated = await updateDecision(namespaceId, orgId, id, {
      guidedFlow,
      mode: "guided",
    }, workspacePath);
    return apiSuccess({ decision: updated, questions: parsed.questions });
  }

  const decision = getDecision(namespaceId, orgId, id, workspacePath);
  if (!decision) throw new NotFound("Decision", id);

  const template = getTemplate(namespaceId, orgId, "decision_guided_questions");
  const prompt = resolveTemplate(template.content, {
    DECISION_CONTEXT: [buildDecisionContext(decision), workspaceContext].filter(Boolean).join("\n\n"),
  });

  const run = await startDecisionChainRun({
    request,
    namespaceId,
    orgId,
    decision,
    phase: "questions",
    prompt,
    workspacePath: authorizedWorkspacePath,
  });

  const guidedFlow: GuidedFlow = decision.guidedFlow || {
    currentRound: 0,
    round1: { status: "pending", questions: [], answers: [] },
    round2: { status: "pending", tailoredOptions: [] },
    round3: { status: "pending" },
  };
  guidedFlow.currentRound = 1;
  guidedFlow.round1.status = "in_progress";
  guidedFlow.round1.generationJobId = undefined;
  guidedFlow.round1.generationRunId = run.runId;
  guidedFlow.startedAt = new Date().toISOString();

  const updated = await updateDecision(namespaceId, orgId, id, { guidedFlow, mode: "guided" }, workspacePath);

  return apiSuccess({ runId: run.runId, status: "running", decision: updated });
});
