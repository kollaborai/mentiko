import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import {
  getApprovalRequest,
  updateApprovalRequest,
} from "@/lib/system/approval-storage";
import { BadRequest, Forbidden, NotFound, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { getSessionUser } from "@/lib/auth/auth-bridge";
import type { ApprovalRequest } from "@/lib/system/approval-types";

export const dynamic = "force-dynamic";

type ApprovalActor = NonNullable<ApprovalRequest["approvalActor"]>;

async function requireSessionActor(request: Request): Promise<ApprovalActor> {
  const session = await getSessionUser(request);
  if (!session?.id) throw new Unauthorized("Authenticated session user required");
  return {
    user_id: session.id,
    ...(session.sessionId ? { session_id: session.sessionId } : {}),
    ...(session.role ? { org_role: session.role } : {}),
  };
}

function enforceApprover(approval: ApprovalRequest, actor: ApprovalActor): void {
  const metadataApprovers = Array.isArray(approval.metadata?.approvers)
    ? approval.metadata.approvers.filter((value): value is string => typeof value === "string")
    : undefined;
  const approvers = approval.approvers ?? metadataApprovers;
  if (approvers?.length && !approvers.includes(actor.user_id)) {
    throw new Forbidden("Authenticated session user is not an allowed approver");
  }
}

function recordActor(approval: ApprovalRequest, actor: ApprovalActor): void {
  approval.approvedBy = actor.user_id;
  approval.approvalActor = actor;
  approval.approvedAt = new Date().toISOString();
}

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

  const actor = await requireSessionActor(request);

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

  enforceApprover(approval, actor);

  approval.status = "approved";
  recordActor(approval, actor);

  await updateApprovalRequest(namespaceId, orgId, approval);

  return apiSuccess({ approval });
});

export const PATCH = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const actor = await requireSessionActor(request);

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

  enforceApprover(approval, actor);

  const body = await request.json();
  const { reason } = body as { reason?: string };

  approval.status = "rejected";
  approval.rejectionReason = reason;
  recordActor(approval, actor);

  await updateApprovalRequest(namespaceId, orgId, approval);

  return apiSuccess({ approval });
});

export const DELETE = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const actor = await requireSessionActor(request);
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { id } = await context.params;
  const approval = await getApprovalRequest(namespaceId, orgId, id);

  if (!approval) throw new NotFound("Approval request", id);
  if (approval.status !== "pending") {
    throw new BadRequest(`Request already ${approval.status}`);
  }

  enforceApprover(approval, actor);
  approval.status = "cancelled";
  recordActor(approval, actor);
  await updateApprovalRequest(namespaceId, orgId, approval);

  return apiSuccess({ approval });
});
