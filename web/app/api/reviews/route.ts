import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { getOrgIdFromRequest } from "@/lib/namespace-config";
import { getSessionUser } from "@/lib/auth/auth-bridge";
import {
  createReview,
  listReviews,
  type ReviewCreateInput,
} from "@/lib/reviews/review-store";

export const dynamic = "force-dynamic";

/**
 * POST /api/reviews
 * Create a new review assignment for Git changes
 */
export const POST = withErrorHandling(async (req: NextRequest) => {
  const perm = await requirePermission(req, "manage_chains");
  if (perm) return perm;

  const body = await req.json();
  const { workspacePath, selectedFiles, assignment } = body;

  // Validate inputs
  if (!Array.isArray(selectedFiles) || selectedFiles.length === 0) {
    return apiSuccess(
      { ok: false, error: { message: "At least one file must be selected for review" } },
      undefined,
      400
    );
  }

  if (!assignment?.title || !assignment?.source_branch || !assignment?.target_branch) {
    return apiSuccess(
      { ok: false, error: { message: "Title, source branch, and target branch are required" } },
      undefined,
      400
    );
  }

  const orgId = await getOrgIdFromRequest(req);
  const user = await getSessionUser(req);
  const userId = user?.id ?? "unknown";

  // Selected files ride along as a label until they get a dedicated column.
  const fileLabel = `files: ${selectedFiles.join(", ")}`;

  const reviewInput: ReviewCreateInput = {
    title: assignment.title,
    description: assignment.description,
    source_branch: assignment.source_branch,
    target_branch: assignment.target_branch,
    reviewers: assignment.reviewers,
    due_date: assignment.due_date,
    checklist: assignment.checklist,
    labels: [...(assignment.labels || []), fileLabel],
    priority: assignment.priority,
  };

  const review = createReview(orgId, reviewInput, userId, workspacePath);

  return apiSuccess({
    ok: true,
    reviewId: review.id,
    review,
    message: "Review created successfully",
  });
});

/**
 * GET /api/reviews
 * List reviews for the caller's org (optionally narrowed to a workspace)
 */
export const GET = withErrorHandling(async (req: NextRequest) => {
  const perm = await requirePermission(req, "view_chains");
  if (perm) return perm;

  const orgId = await getOrgIdFromRequest(req);

  const { searchParams } = new URL(req.url);
  const workspacePath = searchParams.get("workspacePath");
  const status = searchParams.get("status") || undefined;
  const reviewerId = searchParams.get("reviewer_id") || undefined;
  const createdBy = searchParams.get("created_by") || undefined;
  const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!) : undefined;
  const offset = searchParams.get("offset") ? parseInt(searchParams.get("offset")!) : undefined;

  const reviews = listReviews({
    org_id: orgId,
    workspace_id: workspacePath || undefined,
    status,
    reviewer_id: reviewerId,
    created_by: createdBy,
    limit: Number.isFinite(limit) ? limit : undefined,
    offset: Number.isFinite(offset) ? offset : undefined,
  });

  return apiSuccess({
    ok: true,
    reviews,
    count: reviews.length,
  });
});
