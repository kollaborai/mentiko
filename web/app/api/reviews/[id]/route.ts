import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { getOrgIdFromRequest } from "@/lib/namespace-config";
import {
  getReview,
  updateReview,
  deleteReview,
  listAssignments,
  listComments,
  type ReviewUpdateFields,
} from "@/lib/reviews/review-store";

export const dynamic = "force-dynamic";

const REVIEW_STATUSES = new Set(["pending", "in_progress", "completed", "cancelled"]);

/**
 * GET /api/reviews/[id]
 * Get a single review by ID (org-scoped)
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
  const comments = listComments(id);

  return apiSuccess({
    ok: true,
    review: {
      ...review,
      assignments,
      comments,
    },
  });
});

/**
 * PATCH /api/reviews/[id]
 * Update a review (org-scoped)
 */
export const PATCH = withErrorHandling(async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const perm = await requirePermission(req, "manage_chains");
  if (perm) return perm;

  const { id } = await context.params;
  const orgId = await getOrgIdFromRequest(req);
  const body = await req.json();
  const updates: ReviewUpdateFields = {};

  if (body.status !== undefined && !REVIEW_STATUSES.has(body.status)) {
    return apiSuccess(
      { ok: false, error: { message: `Invalid status. Allowed: ${[...REVIEW_STATUSES].join(", ")}` } },
      undefined,
      400
    );
  }

  if (body.title !== undefined) updates.title = body.title;
  if (body.description !== undefined) updates.description = body.description;
  if (body.status !== undefined) updates.status = body.status;
  if (body.due_date !== undefined) updates.due_date = body.due_date;
  if (body.labels !== undefined) updates.labels = body.labels;
  if (body.checklist !== undefined) updates.checklist = body.checklist;
  if (body.priority !== undefined) updates.priority = body.priority;

  const review = updateReview(id, updates, orgId);

  if (!review) {
    return apiSuccess({ ok: false, error: { message: "Review not found" } }, undefined, 404);
  }

  return apiSuccess({
    ok: true,
    review,
    message: "Review updated successfully",
  });
});

/**
 * DELETE /api/reviews/[id]
 * Delete a review (org-scoped)
 */
export const DELETE = withErrorHandling(async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const perm = await requirePermission(req, "manage_chains");
  if (perm) return perm;

  const { id } = await context.params;
  const orgId = await getOrgIdFromRequest(req);
  const success = deleteReview(id, orgId);

  if (!success) {
    return apiSuccess({ ok: false, error: { message: "Review not found" } }, undefined, 404);
  }

  return apiSuccess({
    ok: true,
    message: "Review deleted successfully",
  });
});
