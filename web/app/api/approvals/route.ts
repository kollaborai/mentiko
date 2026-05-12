import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/rbac-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import {
  listApprovalRequests,
  cleanupExpiredRequests,
  createApprovalRequest,
} from "@/lib/approval-storage";
import type { ApprovalStatus, ApprovalRequest } from "@/lib/approval-types";
import { BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "view_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { searchParams } = new URL(request.url);
  const chainId = searchParams.get("chainId") || undefined;
  const runId = searchParams.get("runId") || undefined;
  const statusParam = searchParams.get("status");
  const status: ApprovalStatus | undefined =
    statusParam === "pending" || statusParam === "approved" || statusParam === "rejected" || statusParam === "cancelled"
      ? (statusParam as ApprovalStatus)
      : undefined;
  const limit = searchParams.get("limit")
    ? parseInt(searchParams.get("limit")!)
    : undefined;

  await cleanupExpiredRequests(namespaceId, orgId);

  const requests = await listApprovalRequests(namespaceId, orgId, {
    chainId,
    runId,
    status,
    limit,
  });

  return apiSuccess({ requests });
});

export const POST = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  const body = await request.json();
  const { chainId, runId, agentName, stepName, action, description, method, timeoutMinutes } = body as Partial<ApprovalRequest> & { timeoutMinutes?: number };

  if (!chainId || !runId || !agentName || !action) {
    throw new BadRequest("chainId, runId, agentName, action required", { fields: ["chainId", "runId", "agentName", "action"] });
  }

  const now = new Date().toISOString();
  const timeout = timeoutMinutes ?? 60;
  const expiresAt = new Date(Date.now() + timeout * 60 * 1000).toISOString();

  const approval: ApprovalRequest = {
    id: crypto.randomUUID(),
    chainId,
    runId,
    agentName,
    stepName: stepName ?? agentName,
    status: "pending",
    requestedBy: "api",
    requestedAt: now,
    expiresAt,
    method: method ?? "web",
    action,
    description: description ?? action,
    metadata: {},
  };

  await createApprovalRequest(namespaceId, orgId, approval);
  return apiSuccess({ approval });
});
