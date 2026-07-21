import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getDecision, updateDecision } from "@/lib/decisions/decision-storage";
import { getWorkspacePath } from "@/lib/workspaces/workspace-params";
import { getTemplate } from "@/lib/generation/generation-template-storage";
import { resolveTemplate } from "@/lib/system/template-resolver";
import { getJob } from "@/lib/runs/job-store";
import { getSessionUser } from "@/lib/auth/auth-bridge";
import type { GuidedFlow, TradeoffQuestion } from "@/lib/decisions/decision-types";
import { buildDecisionContext } from "@/lib/decisions/decision-context";
import { Unauthorized, NotFound, BadRequest, InternalServerError } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { resolveAuthorizedWorkspacePath } from "@/lib/auth/workspace-auth";
import { startDecisionChainRun } from "@/lib/decisions/decision-chain-dispatch";
import {
  acquireDurableDecisionPhaseClaim,
  decisionPhaseKey,
  findDurableDecisionPhaseRun,
  isDecisionGenerationPointerDead,
  recordDurableDecisionPhaseRun,
  releaseDurableDecisionPhaseClaim,
  startDecisionPhaseOnce,
} from "@/lib/decisions/decision-auto-advance";

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

  // A durable pointer from an earlier request wins immediately. The shared phase helper
  // below closes the smaller check-then-start window before that pointer is written.
  const existingRound1 = decision.guidedFlow?.round1;
  if (existingRound1?.status === "in_progress" && (existingRound1.generationRunId || existingRound1.generationJobId)) {
    const dead = isDecisionGenerationPointerDead(namespaceId, orgId, {
      runId: existingRound1.generationRunId,
      jobId: existingRound1.generationJobId,
    });
    if (!dead) {
      return apiSuccess({ status: "already_generating", decision });
    }
    // The prior deck run died before producing questions and nothing else would
    // ever clear this pointer. Clear it so the durable phase launch below can
    // relaunch under the lease instead of no-opping forever.
    const clearedFlow: GuidedFlow = {
      ...decision.guidedFlow!,
      round1: { ...existingRound1, status: "pending", generationRunId: undefined, generationJobId: undefined },
    };
    await updateDecision(namespaceId, orgId, id, { guidedFlow: clearedFlow, mode: "guided" }, workspacePath);
  }

  const phase = await startDecisionPhaseOnce({
    key: decisionPhaseKey(namespaceId, orgId, id, "questions"),
    start: async () => {
      const durableInput = { namespaceId, orgId, decisionId: id, phase: "questions" };
      const existingRun = findDurableDecisionPhaseRun(durableInput);
      if (existingRun) return existingRun;

      const claim = acquireDurableDecisionPhaseClaim(durableInput);
      if (!claim.acquired) {
        const claimedRun = claim.run ?? findDurableDecisionPhaseRun(durableInput);
        if (claimedRun) return claimedRun;
        // Another process owns the launch but has not yet reached the durable run write.
        // Refuse this request rather than guessing and creating a duplicate deck.
        throw new Error(`Decision ${id} question generation is already starting`);
      }

      const template = getTemplate(namespaceId, orgId, "decision_guided_questions");
      const prompt = resolveTemplate(template.content, {
        DECISION_CONTEXT: [buildDecisionContext(decision), workspaceContext].filter(Boolean).join("\n\n"),
      });
      try {
        const run = await startDecisionChainRun({
          request,
          namespaceId,
          orgId,
          decision,
          phase: "questions",
          prompt,
          workspacePath: authorizedWorkspacePath,
        });
        // startChainRun has already written run.json. Record its id before attempting
        // updateDecision so a process restart can adopt this exact run without relaunching.
        recordDurableDecisionPhaseRun({ ...durableInput, runId: run.runId });
        return run;
      } catch (error) {
        // No run id was durably recorded, so another request may safely take over.
        releaseDurableDecisionPhaseClaim({ ...durableInput, runId: "" });
        throw error;
      }
    },
    persist: async (run) => {
      // Re-read immediately before the write so a browser request and the headless nudge
      // cannot overwrite each other's decision state with stale guided-flow snapshots.
      const latest = getDecision(namespaceId, orgId, id, workspacePath);
      if (!latest) throw new NotFound("Decision", id);
      const latestRound1 = latest.guidedFlow?.round1;
      if (latestRound1?.generationRunId === run.runId) {
        releaseDurableDecisionPhaseClaim({ namespaceId, orgId, decisionId: id, phase: "questions", runId: run.runId });
        return latest;
      }
      if (latestRound1?.generationRunId || latestRound1?.generationJobId) return latest;

      const currentFlow = latest.guidedFlow;
      const guidedFlow: GuidedFlow = currentFlow
        ? {
            ...currentFlow,
            round1: { ...currentFlow.round1 },
            round2: { ...currentFlow.round2 },
            round3: { ...currentFlow.round3 },
          }
        : {
            currentRound: 0,
            round1: { status: "pending", questions: [], answers: [] },
            round2: { status: "pending", tailoredOptions: [] },
            round3: { status: "pending" },
          };
      guidedFlow.currentRound = 1;
      guidedFlow.round1.status = "in_progress";
      guidedFlow.round1.generationJobId = undefined;
      guidedFlow.round1.generationRunId = run.runId;
      guidedFlow.startedAt = guidedFlow.startedAt || new Date().toISOString();

      const updated = await updateDecision(namespaceId, orgId, id, { guidedFlow, mode: "guided" }, workspacePath);
      releaseDurableDecisionPhaseClaim({ namespaceId, orgId, decisionId: id, phase: "questions", runId: run.runId });
      return updated;
    },
  });

  return apiSuccess({
    runId: phase.started.runId,
    status: phase.joined || phase.recovered ? "already_generating" : "running",
    decision: phase.persisted,
  });
});
