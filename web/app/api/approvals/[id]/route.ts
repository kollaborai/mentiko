import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import {
  getApprovalRequest,
  updateApprovalRequest,
} from "@/lib/system/approval-storage";
import { BadRequest, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const perm = await requirePermission(request, "view_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { id } = await context.params;

  const approvalReq = await getApprovalRequest(namespaceId, orgId, id);

  if (!approvalReq) {
    throw new NotFound("Approval request", id);
  }

  return apiSuccess({ request: approvalReq });
});

export const POST = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { id } = await context.params;

  const approval = await getApprovalRequest(namespaceId, orgId, id);

  if (!approval) {
    throw new NotFound("Approval request", id);
  }

  if (approval.status !== "pending") {
    throw new BadRequest(`Request already ${approval.status}`);
  }

  if (approval.expiresAt && new Date(approval.expiresAt) < new Date()) {
    approval.status = "cancelled";
    await updateApprovalRequest(namespaceId, orgId, approval);
    throw new BadRequest("Request expired");
  }

  const userId = request.headers.get("x-user-id") || "unknown";

  approval.status = "approved";
  approval.approvedBy = userId;
  approval.approvedAt = new Date().toISOString();

  await updateApprovalRequest(namespaceId, orgId, approval);

  return apiSuccess({ approval });
});

export const PATCH = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { id } = await context.params;

  const approval = await getApprovalRequest(namespaceId, orgId, id);

  if (!approval) {
    throw new NotFound("Approval request", id);
  }

  if (approval.status !== "pending") {
    throw new BadRequest(`Request already ${approval.status}`);
  }

  const body = await request.json();
  const { reason } = body as { reason?: string };

  approval.status = "rejected";
  approval.rejectionReason = reason;
  approval.approvedBy = request.headers.get("x-user-id") || "unknown";
  approval.approvedAt = new Date().toISOString();

  await updateApprovalRequest(namespaceId, orgId, approval);

  return apiSuccess({ approval });
});
