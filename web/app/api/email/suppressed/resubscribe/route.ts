import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/rbac-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { unsuppress, type SuppressionReason } from "@/lib/email-suppression";
import { BadRequest, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

/**
 * POST /api/email/suppressed/resubscribe
 * unsubscribe-specific endpoint for users to resubscribe.
 * only removes soft_bounce or unsubscribe suppressions (not hard_bounce/complaint).
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "view_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const body = await request.json();

  const { email } = body;

  if (!email || typeof email !== "string") {
    throw new BadRequest("email is required", { field: "email" });
  }

  // validate email format
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequest("invalid email format", { field: "email" });
  }

  // only allow resubscribe if reason is soft_bounce or unsubscribe
  const allowedReasons: SuppressionReason[] = ["soft_bounce", "unsubscribe"];
  const removed = unsuppress(namespaceId, orgId, email, allowedReasons);

  if (!removed) {
    throw new NotFound("Email suppression not found", email);
  }

  return apiSuccess({ resubscribed: true });
});
