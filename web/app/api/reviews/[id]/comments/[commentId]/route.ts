import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { getOrgIdFromRequest } from "@/lib/namespace-config";
import { getSessionUser } from "@/lib/auth/auth-bridge";
import {
  getReview,
  getComment,
  updateComment,
  deleteComment,
  resolveComment,
} from "@/lib/reviews/review-store";

export const dynamic = "force-dynamic";

/**
 * Resolve the comment and verify it belongs to the review in the URL and that
 * the review belongs to the caller's org.
 */
async function resolveScopedComment(req: NextRequest, reviewId: string, commentId: string) {
  const orgId = await getOrgIdFromRequest(req);
  const review = getReview(reviewId, orgId);
  if (!review) return null;

  const comment = getComment(commentId);
  if (!comment || comment.review_id !== reviewId) return null;

  return comment;
}

/**
 * PATCH /api/reviews/[id]/comments/[commentId]
 * Update or resolve a comment (org-scoped)
 */
export const PATCH = withErrorHandling(async (req: NextRequest, context: { params: Promise<{ id: string; commentId: string }> }) => {
  const perm = await requirePermission(req, "view_chains");
  if (perm) return perm;

  const { id, commentId } = await context.params;
  const body = await req.json();
  const { comment, resolved } = body;

  const existingComment = await resolveScopedComment(req, id, commentId);
  if (!existingComment) {
    return apiSuccess({ ok: false, error: { message: "Comment not found" } }, undefined, 404);
  }

  const user = await getSessionUser(req);
  const userId = user?.id ?? "unknown";
  let updatedComment;

  if (resolved === true) {
    updatedComment = resolveComment(commentId, userId);
  } else if (comment !== undefined) {
    updatedComment = updateComment(commentId, comment);
  } else {
    updatedComment = existingComment;
  }

  return apiSuccess({
    ok: true,
    comment: updatedComment,
    message: "Comment updated successfully",
  });
});

/**
 * DELETE /api/reviews/[id]/comments/[commentId]
 * Delete a comment (org-scoped)
 */
export const DELETE = withErrorHandling(async (req: NextRequest, context: { params: Promise<{ id: string; commentId: string }> }) => {
  const perm = await requirePermission(req, "manage_chains");
  if (perm) return perm;

  const { id, commentId } = await context.params;

  const existingComment = await resolveScopedComment(req, id, commentId);
  if (!existingComment) {
    return apiSuccess({ ok: false, error: { message: "Comment not found" } }, undefined, 404);
  }

  deleteComment(commentId);

  return apiSuccess({
    ok: true,
    message: "Comment deleted successfully",
  });
});
