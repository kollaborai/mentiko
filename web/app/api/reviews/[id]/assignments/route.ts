import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { getOrgIdFromRequest } from "@/lib/namespace-config";
import {
  getReview,
  listAssignments,
  createAssignment,
} from "@/lib/reviews/review-store";

export const dynamic = "force-dynamic";

/**
 * GET /api/reviews/[id]/assignments
 * List all assignments for a review (org-scoped)
 */
export const GET = withErrorHandling(async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const perm = await requirePermission(req, "view_chains");
  if (perm) return perm;

  const { id } = await context.params;
  const orgId = await getOrgIdFromRequest(req);
  const review = getReview(id, orgId);
  if (!review) {
    return apiSuccess({ ok: false, error: { message: "Review not found" } }, undefined, 404);
  }

  const assignments = listAssignments(id);

  return apiSuccess({
    ok: true,
    assignments,
  });
});

/**
 * POST /api/reviews/[id]/assignments
 * Add a reviewer to a review (org-scoped)
 */
export const POST = withErrorHandling(async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const perm = await requirePermission(req, "manage_chains");
  if (perm) return perm;

  const { id } = await context.params;
  const orgId = await getOrgIdFromRequest(req);
  const body = await req.json();
  const { reviewer_id } = body;

  if (!reviewer_id) {
    return apiSuccess({ ok: false, error: { message: "Reviewer ID is required" } }, undefined, 400);
  }

  const review = getReview(id, orgId);
  if (!review) {
    return apiSuccess({ ok: false, error: { message: "Review not found" } }, undefined, 404);
  }

  const assignment = createAssignment(id, reviewer_id);

  return apiSuccess({
    ok: true,
    assignment,
    message: "Reviewer added successfully",
  });
});
