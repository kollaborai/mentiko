import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getDecision, updateDecision } from "@/lib/decisions/decision-storage";
import { getWorkspacePath } from "@/lib/workspaces/workspace-params";
import { getTemplate } from "@/lib/generation/generation-template-storage";
import { resolveTemplate } from "@/lib/system/template-resolver";
import { getJob } from "@/lib/runs/job-store";
import { getSessionUser } from "@/lib/auth/auth-bridge";
import type { Decision } from "@/lib/decisions/decision-types";
import { Unauthorized, NotFound, BadRequest, InternalServerError } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { resolveAuthorizedWorkspacePath } from "@/lib/auth/workspace-auth";
import { startDecisionChainRun, startDecisionResearch } from "@/lib/decisions/decision-chain-dispatch";
import { taskUpdate } from "@/lib/tasks/task-store";

export const dynamic = "force-dynamic";

function buildPreviousAnalysis(decision: Decision): string {
  return [
    `ORIGINAL INPUT: ${decision.prompt}`,
    `Title: ${decision.title}`,
    `Priority: ${decision.priority}`,
    `Category: ${decision.category}`,
    decision.brief ? [
      `\nPREVIOUS BRIEF:`,
      `Headline: ${decision.brief.headline}`,
      `Situation: ${decision.brief.situation}`,
      `Problem: ${decision.brief.problem}`,
      `Impact: ${decision.brief.impact}`,
      `Scope: ${decision.brief.scope}`,
    ].join("\n") : "",
    decision.context ? [
      `\nPREVIOUS CONTEXT:`,
      `Problem: ${decision.context.problem}`,
      `Current State: ${decision.context.currentState}`,
      `Impact: ${decision.context.whyProblem}`,
      `Affected Areas: ${decision.context.affectedAreas?.join(", ")}`,
      `Constraints: ${decision.context.constraints?.join("; ")}`,
    ].join("\n") : "",
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

  let body: { steering?: string; jobId?: string } = {};
  try { body = await request.json(); } catch { /* empty body ok */ }

  // phase 2: apply completed job result to decision
  if (body.jobId) {
    const job = getJob(body.jobId, namespaceId);
    if (!job) throw new NotFound("Job", body.jobId);
    if (job.status === "failed") throw new InternalServerError(job.error || "Job failed");
    if (job.status !== "complete") throw new BadRequest("Job not complete");

    const parsed = job.result as Record<string, unknown>;
    const decision = getDecision(namespaceId, orgId, id, workspacePath);
    if (!decision) throw new NotFound("Decision", id);
    const title = (parsed.title as string) || decision.title || decision.prompt.split("\n")[0];
    if (decision.taskId) {
      taskUpdate(orgId, decision.taskId, { title }, namespaceId);
    }

    const updated = await updateDecision(namespaceId, orgId, id, {
      title,
      priority: parsed.priority as string,
      category: parsed.category as string,
      brief: parsed.brief as Decision["brief"],
      context: parsed.context as Decision["context"],
      status: "briefed",
      activeJobId: undefined,
    }, workspacePath);
    return apiSuccess({ decision: updated });
  }

  // phase 1: start research job
  const decision = getDecision(namespaceId, orgId, id, workspacePath);
  if (!decision) throw new NotFound("Decision", id);

  const workspaceContext = authorizedWorkspacePath
    ? `\nWORKSPACE CONTEXT:\n- Source checkout: ${authorizedWorkspacePath}\n- If this decision involves code, inspect files under this checkout and cite repo-relative paths in references.\n`
    : "";

  let run: Awaited<ReturnType<typeof startDecisionChainRun>>;
  if (body.steering) {
    const template = getTemplate(namespaceId, orgId, "decision_steering");
    const researchPrompt = resolveTemplate(template.content, {
      PREVIOUS_ANALYSIS: buildPreviousAnalysis(decision),
      STEERING_INPUT: body.steering,
      WORKSPACE_CONTEXT: workspaceContext,
    });
    run = await startDecisionChainRun({
      request,
      namespaceId,
      orgId,
      decision,
      phase: "research",
      prompt: researchPrompt,
      workspacePath: authorizedWorkspacePath,
    });
  } else {
    // Same path autonomous callers (completion-audit) use, so a decision created
    // by hand and one created automatically get framed and packaged identically.
    run = await startDecisionResearch({
      request,
      namespaceId,
      orgId,
      decision,
      userPrompt: decision.prompt,
      workspacePath: authorizedWorkspacePath,
    });
  }

  const updated = await updateDecision(namespaceId, orgId, id, {
    status: "researching",
    activeJobId: undefined,
    researchRunId: run.runId,
  }, workspacePath);

  return apiSuccess({ runId: run.runId, status: "running", decision: updated });
});
