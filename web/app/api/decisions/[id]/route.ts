import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getDecision, updateDecision, deleteDecision } from "@/lib/decisions/decision-storage";
import { getWorkspacePath } from "@/lib/workspaces/workspace-params";
import { getJob } from "@/lib/runs/job-store";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NotFound, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { resolveLinkRunsDir } from "@/lib/links/link-run-runtime";
import { applyDecisionRunResult } from "@/lib/decisions/decision-run-results";
import { taskDelete, taskGet, taskUpdate } from "@/lib/tasks/task-store";

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

  // stale job detection: if decision is "researching" but the job is dead, reset
  if (decision.status === "researching") {
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
            isStale = run.status === "failed" || run.status === "cancelled" || run.status === "stopped";
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
      const updated = await updateDecision(nsId, orgId, id, {
        status: "intake",
        activeJobId: undefined,
      }, workspacePath);
      return apiSuccess({ decision: updated });
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
  const decision = getDecision(nsId, orgId, id, workspacePath);

  deleteDecision(nsId, orgId, id, workspacePath);

  const decisionTaskId = typeof decision?.taskId === "string" ? decision.taskId : undefined;
  const parentTaskId = typeof decision?.parentTaskId === "string" ? decision.parentTaskId : undefined;
  const decisionTask = decisionTaskId ? taskGet(orgId, decisionTaskId, nsId) : null;
  const effectiveParentTaskId = parentTaskId || decisionTask?.parent_id || undefined;

  if (decisionTaskId) {
    taskDelete(orgId, decisionTaskId, nsId);
  }

  if (effectiveParentTaskId) {
    const parentTask = taskGet(orgId, effectiveParentTaskId, nsId);
    const metadata = parentTask?.metadata && typeof parentTask.metadata === "object" && !Array.isArray(parentTask.metadata)
      ? { ...parentTask.metadata as Record<string, unknown> }
      : {};
    const changed = removeDeletedDecisionReferences(metadata, id, decisionTaskId);
    if (changed) {
      taskUpdate(orgId, effectiveParentTaskId, { metadata }, nsId);
    }
  }

  return apiSuccess({ success: true });
});

function removeDeletedDecisionReferences(
  metadata: Record<string, unknown>,
  decisionId: string,
  decisionTaskId?: string,
): boolean {
  let changed = false;
  const matchesDecisionTask = (value: unknown) => (
    typeof decisionTaskId === "string" && value === decisionTaskId
  );
  const matchesDecision = (value: unknown) => value === decisionId;

  for (const key of [
    "decision_subtask_id",
    "last_decision_subtask_id",
  ]) {
    if (matchesDecisionTask(metadata[key])) {
      delete metadata[key];
      changed = true;
    }
  }

  for (const key of [
    "decision_id",
    "last_decision_id",
  ]) {
    if (matchesDecision(metadata[key])) {
      delete metadata[key];
      changed = true;
    }
  }

  for (const key of [
    "superseded_decision_subtask_ids",
    "duplicate_decision_subtask_ids",
  ]) {
    if (!Array.isArray(metadata[key])) continue;
    const next = metadata[key].filter((item) => !matchesDecisionTask(item));
    if (next.length !== metadata[key].length) {
      if (next.length > 0) metadata[key] = next;
      else delete metadata[key];
      changed = true;
    }
  }

  if (changed && metadata.last_run_decision_required === true && !metadata.decision_subtask_id) {
    metadata.last_run_decision_required = false;
  }

  return changed;
}
