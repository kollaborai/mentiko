import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getDecision, updateDecision } from "@/lib/decisions/decision-storage";
import { getWorkspacePath } from "@/lib/workspaces/workspace-params";
import { getTemplate } from "@/lib/generation/generation-template-storage";
import { resolveTemplate } from "@/lib/system/template-resolver";
import { getJob } from "@/lib/runs/job-store";
import { getSessionUser } from "@/lib/auth/auth-bridge";
import type { GuidedFlow, TailoredOption, Recommendation } from "@/lib/decisions/decision-types";
import { buildDecisionContext, buildPreferenceText } from "@/lib/decisions/decision-context";
import { Unauthorized, NotFound, BadRequest, InternalServerError } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { resolveAuthorizedWorkspacePath } from "@/lib/auth/workspace-auth";
import { startDecisionChainRun } from "@/lib/decisions/decision-chain-dispatch";
import { startDurableDecisionPhaseOnce } from "@/lib/decisions/decision-auto-advance";

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

  if (guidedFlow.round2.generationRunId || guidedFlow.round2.generationJobId) {
    return apiSuccess({
      runId: guidedFlow.round2.generationRunId,
      jobId: guidedFlow.round2.generationJobId,
      status: "already_generating",
      decision,
    });
  }

  const phase = await startDurableDecisionPhaseOnce({
    identity: { namespaceId, orgId, decisionId: id, phase: "options" },
    start: async () => {
      const contextParts = [buildDecisionContext(decision), workspaceContext].filter(Boolean).join("\n\n");
      const preferenceText = buildPreferenceText(guidedFlow);
      const constraints = decision.context?.constraints?.join("; ") || "none specified";
      const template = getTemplate(namespaceId, orgId, "decision_guided_options");
      const prompt = resolveTemplate(template.content, {
        DECISION_CONTEXT: contextParts,
        PREFERENCE_PROFILE: preferenceText,
        CONSTRAINTS: constraints,
      });
      return startDecisionChainRun({
        request,
        namespaceId,
        orgId,
        decision,
        phase: "options",
        prompt,
        workspacePath: authorizedWorkspacePath,
      });
    },
    persist: async (run) => {
      const latest = getDecision(namespaceId, orgId, id, workspacePath);
      if (!latest) throw new NotFound("Decision", id);
      const latestFlow = latest.guidedFlow as GuidedFlow;
      if (!latestFlow) throw new BadRequest("No guided flow");
      if (latestFlow.round2.generationRunId === run.runId) return latest;
      if (latestFlow.round2.generationRunId || latestFlow.round2.generationJobId) return latest;

      const nextFlow: GuidedFlow = {
        ...latestFlow,
        round1: { ...latestFlow.round1 },
        round2: {
          ...latestFlow.round2,
          status: "generating",
          generationJobId: undefined,
          generationRunId: run.runId,
        },
        round3: { ...latestFlow.round3 },
      };
      return updateDecision(namespaceId, orgId, id, { guidedFlow: nextFlow }, workspacePath);
    },
  });

  return apiSuccess({
    runId: phase.started.runId,
    status: phase.joined || phase.recovered || phase.durableRecovered
      ? "already_generating"
      : "running",
    decision: phase.persisted,
  });
});
