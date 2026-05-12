import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getDecision, updateDecision, deleteDecision } from "@/lib/decision-storage";
import { getWorkspacePath } from "@/lib/workspace-params";
import { getJob } from "@/lib/job-store";
import { NotFound, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

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

    if (!decision.activeJobId) {
      // no job id at all - stuck
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

  const decision = await updateDecision(nsId, orgId, id, body, workspacePath);
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
  deleteDecision(nsId, orgId, id, workspacePath);
  return apiSuccess({ success: true });
});
