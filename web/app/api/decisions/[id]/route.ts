import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getDecision, updateDecision } from "@/lib/decisions/decision-storage";
import { deleteDecisionEntity } from "@/lib/decisions/decision-entity";
import { getWorkspacePath } from "@/lib/workspaces/workspace-params";
import { getJob } from "@/lib/runs/job-store";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NotFound, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { resolveLinkRunsDir } from "@/lib/links/link-run-runtime";
import { applyDecisionRunResult } from "@/lib/decisions/decision-run-results";
import { taskUpdate } from "@/lib/tasks/task-store";
import { isCompletedRunAwaitingDecisionImport, triggerDecisionImportReplay } from "@/lib/decisions/decision-auto-advance";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized("Authentication required");
  }

  const { id } = await context.params;
  const nsId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const workspacePath = getWorkspacePath(request);
  const decision = getDecision(nsId, orgId, id, workspacePath);

  if (!decision) {
    throw new NotFound("Decision", id);
  }

  // Stale research detection covers decisions that were left in intake by an
  // older self-heal as well as decisions still marked researching. Keep the
  // dead pointer visible to the UI so a human can repair it explicitly.
  const hasUnfinishedResearchPointer =
    (decision.status === "researching")
    || (
      decision.status === "intake"
      && !decision.brief
      && decision.options.length === 0
      && Boolean(decision.researchRunId || decision.activeJobId)
    );
  if (hasUnfinishedResearchPointer) {
    let isStale = false;

    if (decision.researchRunId) {
      const runPath = join(resolveLinkRunsDir(nsId, orgId), decision.researchRunId, "run.json");
      if (!existsSync(runPath)) {
        isStale = true;
      } else {
        try {
          const run = JSON.parse(readFileSync(runPath, "utf8"));
          if (run.status === "completed" || run.status === "complete") {
            const resultPath = join(resolveLinkRunsDir(nsId, orgId), decision.researchRunId, "artifacts", "decision-result.json");
            if (existsSync(resultPath)) {
              try {
                const result = JSON.parse(readFileSync(resultPath, "utf8"));
                const updated = await applyDecisionRunResult({
                  namespaceId: nsId,
                  orgId,
                  decisionId: id,
                  phase: "research",
                  result,
                  runId: decision.researchRunId,
                  workspacePath,
                });
                return apiSuccess({ decision: updated });
              } catch {
                isStale = true;
              }
            } else {
              isStale = true;
            }
          } else {
            isStale = ["failed", "blocked", "cancelled", "stopped", "deleted", "unknown"].includes(run.status);
          }
        } catch {
          isStale = true;
        }
      }
    } else if (!decision.activeJobId) {
      isStale = true;
    } else {
      const job = getJob(decision.activeJobId, nsId);
      isStale = !job
        || job.status === "failed"
        || (job.status === "running" && Date.now() - new Date(job.createdAt).getTime() > 10 * 60 * 1000);
    }

    if (isStale) {
      if (decision.status === "researching") {
        const updated = await updateDecision(nsId, orgId, id, {
          activeJobId: undefined,
        }, workspacePath);
        return apiSuccess({ decision: { ...updated, researchRecovery: "dead" as const } });
      }
      return apiSuccess({ decision: { ...decision, researchRecovery: "dead" as const } });
    }
  }

  // Guided-round self-heal: this GET is the surface the guided-flow UI polls
  // every ~2s while a spinner is up (pollDecisionUntil), not the guided/*
  // POST routes -- they fire once to start a round, then the client watches
  // this endpoint for the round to advance. If the pointed-at run completed
  // but its import never landed (crash after write, mistyped decision id),
  // nudge it here instead of leaving the user staring at a stuck spinner
  // until they manually retry.
  const gf = decision.guidedFlow;
  if (gf) {
    if (gf.round1.status === "in_progress" && gf.round1.questions.length === 0 &&
      isCompletedRunAwaitingDecisionImport(nsId, orgId, gf.round1.generationRunId)) {
      triggerDecisionImportReplay({
        namespaceId: nsId, orgId, decisionId: id, phase: "questions",
        runId: gf.round1.generationRunId!, workspacePath,
      });
    } else if (gf.round2.status === "generating" &&
      isCompletedRunAwaitingDecisionImport(nsId, orgId, gf.round2.generationRunId)) {
      triggerDecisionImportReplay({
        namespaceId: nsId, orgId, decisionId: id, phase: "options",
        runId: gf.round2.generationRunId!, workspacePath,
      });
    } else if (gf.round3.status === "generating" && gf.round2.selectedOptionId &&
      isCompletedRunAwaitingDecisionImport(nsId, orgId, gf.round3.generationRunId)) {
      triggerDecisionImportReplay({
        namespaceId: nsId, orgId, decisionId: id, phase: "plan",
        runId: gf.round3.generationRunId!, workspacePath,
        selectedOptionId: gf.round2.selectedOptionId,
      });
    }
  }

  return apiSuccess({ decision });
});

export const PATCH = withErrorHandling(async (
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
  const nsId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const workspacePath = getWorkspacePath(request);
  const body = await request.json();

  // Allow-list: this generic PATCH may only rename the decision or skip it.
  // Everything else — parentTaskId, taskId, options, resolution, and status
  // transitions other than "skipped" — must flow through the dedicated routes
  // (resolve / research / guided). Letting them through here would desync the
  // decision from its task tree or bypass resolveDecisionToTasks entirely.
  const updates: Record<string, unknown> = {};
  if (typeof body.title === "string") updates.title = body.title;
  if (body.status === "skipped") updates.status = "skipped";

  const existing = typeof updates.title === "string"
    ? getDecision(nsId, orgId, id, workspacePath)
    : null;

  const decision = await updateDecision(nsId, orgId, id, updates, workspacePath);
  if (existing?.taskId && typeof updates.title === "string") {
    taskUpdate(orgId, existing.taskId, { title: updates.title as string }, nsId);
  }
  return apiSuccess({ decision });
});

export const DELETE = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized("Authentication required");
  }

  const { id } = await context.params;
  const nsId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const workspacePath = getWorkspacePath(request);
  await deleteDecisionEntity(nsId, orgId, id, workspacePath);

  return apiSuccess({ success: true });
});
