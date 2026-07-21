import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getDecision, updateDecision } from "@/lib/decisions/decision-storage";
import { getWorkspacePath } from "@/lib/workspaces/workspace-params";
import { getTemplate } from "@/lib/generation/generation-template-storage";
import { resolveTemplate } from "@/lib/system/template-resolver";
import { getJob } from "@/lib/runs/job-store";
import { getSessionUser } from "@/lib/auth/auth-bridge";
import type { GuidedFlow, ExecutionPlan } from "@/lib/decisions/decision-types";
import { buildDecisionContext, buildPreferenceText } from "@/lib/decisions/decision-context";
import { Unauthorized, NotFound, BadRequest, InternalServerError } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { resolveAuthorizedWorkspacePath } from "@/lib/auth/workspace-auth";
import { startDecisionChainRun } from "@/lib/decisions/decision-chain-dispatch";
import { isDecisionGenerationPointerDead, startDurableDecisionPhaseOnce } from "@/lib/decisions/decision-auto-advance";
import { validateExecutionPlan } from "@/lib/decisions/decision-plan-contract";

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

    const validatedPlan = validateExecutionPlan(job.result);
    if (!validatedPlan.valid) throw new BadRequest(validatedPlan.error);
    const parsed = validatedPlan.plan;
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
  if (!selectedId) throw new BadRequest("No option selected");
  const selectedOption = guidedFlow.round2.tailoredOptions.find((o) => o.id === selectedId)
    || decision.options.find((o) => o.id === selectedId);

  if (!selectedOption) throw new BadRequest("No option selected");

  if (
    guidedFlow.round2.selectedOptionId === selectedId &&
    (guidedFlow.round3.generationRunId || guidedFlow.round3.generationJobId)
  ) {
    const dead = isDecisionGenerationPointerDead(namespaceId, orgId, {
      runId: guidedFlow.round3.generationRunId,
      jobId: guidedFlow.round3.generationJobId,
    });
    if (!dead) {
      return apiSuccess({
        runId: guidedFlow.round3.generationRunId,
        jobId: guidedFlow.round3.generationJobId,
        status: "already_generating",
        decision,
      });
    }
    // Same stale-pointer recovery as options/questions: a dead plan run left
    // this selection permanently wedged since the guard above never expires.
    guidedFlow.round3.status = "pending";
    guidedFlow.round3.generationRunId = undefined;
    guidedFlow.round3.generationJobId = undefined;
    await updateDecision(namespaceId, orgId, id, { guidedFlow }, workspacePath);
  }

  const phase = await startDurableDecisionPhaseOnce({
    identity: {
      namespaceId,
      orgId,
      decisionId: id,
      phase: "plan",
      selectedOptionId: selectedId,
    },
    start: async () => {
      const contextParts = [buildDecisionContext(decision), workspaceContext].filter(Boolean).join("\n\n");
      const preferenceText = buildPreferenceText(guidedFlow);
      const template = getTemplate(namespaceId, orgId, "decision_guided_plan");
      const prompt = resolveTemplate(template.content, {
        DECISION_CONTEXT: contextParts,
        SELECTED_OPTION: `${selectedOption.letter}. ${selectedOption.name}: ${selectedOption.description}\nEffort: ${selectedOption.effort}\nRisk: ${selectedOption.risk}\nPros: ${selectedOption.pros.join(", ")}\nCons: ${selectedOption.cons.join(", ")}`,
        USER_PREFERENCES: preferenceText,
      });
      return startDecisionChainRun({
        request,
        namespaceId,
        orgId,
        decision,
        phase: "plan",
        prompt,
        workspacePath: authorizedWorkspacePath,
        selectedOptionId: selectedId,
      });
    },
    persist: async (run) => {
      const latest = getDecision(namespaceId, orgId, id, workspacePath);
      if (!latest) throw new NotFound("Decision", id);
      const latestFlow = latest.guidedFlow as GuidedFlow;
      if (!latestFlow) throw new BadRequest("No guided flow");
      if (
        latestFlow.round2.selectedOptionId === selectedId &&
        latestFlow.round3.generationRunId === run.runId
      ) {
        return latest;
      }
      if (
        latestFlow.round2.selectedOptionId === selectedId &&
        (latestFlow.round3.generationRunId || latestFlow.round3.generationJobId)
      ) {
        return latest;
      }

      const nextFlow: GuidedFlow = {
        ...latestFlow,
        round1: { ...latestFlow.round1 },
        round2: { ...latestFlow.round2, selectedOptionId: selectedId },
        round3: {
          ...latestFlow.round3,
          status: "generating",
          plan: undefined,
          generationJobId: undefined,
          generationRunId: run.runId,
        },
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
