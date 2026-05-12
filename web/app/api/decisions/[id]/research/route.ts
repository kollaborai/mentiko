import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getDecision, updateDecision } from "@/lib/decision-storage";
import { getWorkspacePath } from "@/lib/workspace-params";
import { getTemplate } from "@/lib/generation-template-storage";
import { resolveTemplate } from "@/lib/template-resolver";
import { createJob, getJob } from "@/lib/job-store";
import { getSessionUser } from "@/lib/auth-bridge";
import { join } from "node:path";
import { openSync, closeSync } from "node:fs";
import config from "@/lib/config";
import type { Decision } from "@/lib/decision-types";
import { Unauthorized, NotFound, BadRequest, InternalServerError } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { launchJobRunner } from "@/lib/job-runner-launch";
import { resolveAuthorizedWorkspacePath } from "@/lib/workspace-auth";

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

    const updated = await updateDecision(namespaceId, orgId, id, {
      title: (parsed.title as string) || decision.prompt,
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

  let researchPrompt: string;
  if (body.steering) {
    const template = getTemplate(namespaceId, orgId, "decision_steering");
    researchPrompt = resolveTemplate(template.content, {
      PREVIOUS_ANALYSIS: buildPreviousAnalysis(decision),
      STEERING_INPUT: body.steering,
      WORKSPACE_CONTEXT: workspaceContext,
    });
  } else {
    const template = getTemplate(namespaceId, orgId, "decision_research");
    researchPrompt = resolveTemplate(template.content, {
      USER_PROMPT: decision.prompt,
      WORKSPACE_CONTEXT: workspaceContext,
    });
  }

  const jobType = body.steering ? "decision_steering" : "decision_research";
  const job = createJob(jobType, { prompt: researchPrompt, workspacePath: authorizedWorkspacePath }, undefined, id, userId, namespaceId);

  await updateDecision(namespaceId, orgId, id, { status: "researching", activeJobId: job.id }, workspacePath);

  const logPath = join(config.jobsDir, `${job.id}.log`);
  const logFd = openSync(logPath, "a");
  launchJobRunner({
    job,
    namespaceId,
    orgId,
    origin: request.nextUrl.origin,
    stdio: ["ignore", logFd, logFd],
  });
  closeSync(logFd);

  return apiSuccess({ jobId: job.id, status: job.status });
});
