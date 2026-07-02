import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { getOrgIdFromRequest } from "@/lib/namespace-config";
import { getSessionUser } from "@/lib/auth/auth-bridge";
import {
  getReview,
  getAssignment,
  updateAssignmentStatus,
  deleteAssignment,
  ASSIGNMENT_STATUSES,
  type AssignmentStatus,
} from "@/lib/reviews/review-store";

export const dynamic = "force-dynamic";

/**
 * Resolve the assignment and verify it belongs to the review in the URL and
 * that the review belongs to the caller's org.
 */
async function resolveScopedAssignment(req: NextRequest, reviewId: string, assignmentId: string) {
  const orgId = await getOrgIdFromRequest(req);
  const review = getReview(reviewId, orgId);
  if (!review) return null;

  const assignment = getAssignment(assignmentId);
  if (!assignment || assignment.review_id !== reviewId) return null;

  return assignment;
}

/**
 * PATCH /api/reviews/[id]/assignments/[assignmentId]
 * Update a reviewer's status (pending | approved | changes_requested)
 */
export const PATCH = withErrorHandling(
  async (req: NextRequest, context: { params: Promise<{ id: string; assignmentId: string }> }) => {
    const perm = await requirePermission(req, "manage_chains");
    if (perm) return perm;

    const { id, assignmentId } = await context.params;
    const body = await req.json();
    const status = body.status as AssignmentStatus | undefined;

    if (!status || !ASSIGNMENT_STATUSES.includes(status)) {
      return apiSuccess(
        { ok: false, error: { message: `status must be one of: ${ASSIGNMENT_STATUSES.join(", ")}` } },
        undefined,
        400
      );
    }

    const assignment = await resolveScopedAssignment(req, id, assignmentId);
    if (!assignment) {
      return apiSuccess({ ok: false, error: { message: "Assignment not found" } }, undefined, 404);
    }

    // Only the assigned reviewer may set their own status. Without this, any
    // manage_chains member could approve every assignment (including their own)
    // and unblock the ReviewApprovalGate, defeating the peer-review gate.
    const user = await getSessionUser(req);
    if (!user || user.id !== assignment.reviewer_id) {
      return apiSuccess(
        { ok: false, error: { message: "Only the assigned reviewer can update this assignment" } },
        undefined,
        403
      );
    }

    const updated = updateAssignmentStatus(assignmentId, status);

    return apiSuccess({
      ok: true,
      assignment: updated,
      message: "Assignment updated successfully",
    });
  }
);

/**
 * DELETE /api/reviews/[id]/assignments/[assignmentId]
 * Remove a reviewer from a review
 */
export const DELETE = withErrorHandling(
  async (req: NextRequest, context: { params: Promise<{ id: string; assignmentId: string }> }) => {
    const perm = await requirePermission(req, "manage_chains");
    if (perm) return perm;

    const { id, assignmentId } = await context.params;

    const assignment = await resolveScopedAssignment(req, id, assignmentId);
    if (!assignment) {
      return apiSuccess({ ok: false, error: { message: "Assignment not found" } }, undefined, 404);
    }

    deleteAssignment(assignmentId);

    return apiSuccess({
      ok: true,
      message: "Reviewer removed successfully",
    });
  }
);
