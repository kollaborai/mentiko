import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { getOrgIdFromRequest } from "@/lib/namespace-config";
import { getSessionUser } from "@/lib/auth/auth-bridge";
import {
  getReview,
  listComments,
  createComment,
} from "@/lib/reviews/review-store";

export const dynamic = "force-dynamic";

/**
 * GET /api/reviews/[id]/comments
 * List all comments for a review (org-scoped)
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

  const comments = listComments(id);

  return apiSuccess({
    ok: true,
    comments,
  });
});

/**
 * POST /api/reviews/[id]/comments
 * Add a comment to a review (org-scoped)
 */
export const POST = withErrorHandling(async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const perm = await requirePermission(req, "view_chains");
  if (perm) return perm;

  const { id } = await context.params;
  const body = await req.json();
  const { file_path, line_number, comment } = body;

  if (!comment) {
    return apiSuccess({ ok: false, error: { message: "Comment text is required" } }, undefined, 400);
  }

  if (!file_path) {
    return apiSuccess({ ok: false, error: { message: "File path is required" } }, undefined, 400);
  }

  const orgId = await getOrgIdFromRequest(req);
  const review = getReview(id, orgId);
  if (!review) {
    return apiSuccess({ ok: false, error: { message: "Review not found" } }, undefined, 404);
  }

  const user = await getSessionUser(req);
  const userId = user?.id ?? "unknown";
  const newComment = createComment(id, file_path, line_number || null, userId, comment);

  return apiSuccess({
    ok: true,
    comment: newComment,
    message: "Comment added successfully",
  });
});
