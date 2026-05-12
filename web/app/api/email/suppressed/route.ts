import { NextRequest } from "next/server";
import { requirePermission, getCurrentUser } from "@/lib/rbac-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import {
  listSuppressed,
  unsuppress,
  suppressManually,
  type SuppressionReason,
} from "@/lib/email-suppression";
import { BadRequest, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

// GET /api/email/suppressed - list suppressed entries
export const GET = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "view_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { searchParams } = new URL(request.url);

  const limit = parseInt(searchParams.get("limit") || "50", 10);
  const offset = parseInt(searchParams.get("offset") || "0", 10);
  const reason = searchParams.get("reason") as SuppressionReason | null;

  const result = listSuppressed(namespaceId, orgId, {
    limit: Math.min(limit, 200), // max 200
    offset,
    reason: reason || undefined,
  });

  return apiSuccess(result);
});

// DELETE /api/email/suppressed - remove suppression (requires manage_org)
export const DELETE = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "manage_org");
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

  const removed = unsuppress(namespaceId, orgId, email);

  if (!removed) {
    throw new NotFound("Email suppression not found", email);
  }

  return apiSuccess({ removed: true });
});

// POST /api/email/suppressed - manually suppress an email
export const POST = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "manage_org");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const user = await getCurrentUser(request);
  const body = await request.json();

  const { email, reason, expiresAt } = body;

  if (!email || typeof email !== "string") {
    throw new BadRequest("email is required", { field: "email" });
  }

  // validate email format
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequest("invalid email format", { field: "email" });
  }

  // validate reason if provided
  const validReasons: SuppressionReason[] = [
    "hard_bounce",
    "soft_bounce",
    "complaint",
    "manual",
    "unsubscribe",
  ];

  if (reason && !validReasons.includes(reason)) {
    throw new BadRequest(`reason must be one of: ${validReasons.join(", ")}`, {
      field: "reason",
      validReasons
    });
  }

  // validate expiresAt if provided
  if (expiresAt && isNaN(Date.parse(expiresAt))) {
    throw new BadRequest("expiresAt must be a valid ISO date", { field: "expiresAt" });
  }

  suppressManually(
    namespaceId,
    orgId,
    email,
    user?.id || "unknown",
    reason || "manual",
    expiresAt || null
  );

  return apiSuccess({ suppressed: true });
});
