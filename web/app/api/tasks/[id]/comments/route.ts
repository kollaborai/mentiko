import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/api-auth";
import { enforceGuestWrites } from "@/lib/middleware";
import { taskGetComments, taskAddComment } from "@/lib/tasks/task-store";
import { validateTaskId } from "@/lib/tasks/task-store";
import { BadRequest } from "@/lib/api-errors";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

// GET /api/tasks/[id]/comments - list comments (requires view_tasks)
export const GET = requirePermission("view_tasks")(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { id } = await context.params;
  const safeId = validateTaskId(decodeURIComponent(id));
  const comments = taskGetComments(orgId, safeId, namespaceId);
  return apiSuccess({ comments });
});

// POST /api/tasks/[id]/comments - add a comment (requires manage_tasks)
export const POST = requirePermission("manage_tasks")(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const blockResult = await enforceGuestWrites(request);
  if (blockResult?.blocked) return blockResult.response;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { id } = await context.params;
  const safeId = validateTaskId(decodeURIComponent(id));
  const body = await request.json();

  if (!body.text) {
    throw new BadRequest("Comment text is required", { field: "text" });
  }

  taskAddComment(orgId, safeId, body.author || "", body.text, namespaceId);

  // re-fetch comments to return the new one
  const comments = taskGetComments(orgId, safeId, namespaceId);
  const comment = comments.length > 0 ? comments[comments.length - 1] : null;
  return apiSuccess({ comment, comments }, undefined, 201);
});
