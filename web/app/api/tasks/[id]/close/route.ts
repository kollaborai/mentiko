import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/api-auth";
import { enforceGuestWrites } from "@/lib/middleware";
import { taskClose } from "@/lib/task-store";
import { validateTaskId } from "@/lib/task-store";
import { InternalServerError } from "@/lib/api-errors";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

// POST /api/tasks/[id]/close - close a task (requires manage_tasks)
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

  try {
    taskClose(orgId, safeId, undefined, namespaceId);
  } catch (error: unknown) {
    throw new InternalServerError((error as Error).message);
  }

  return apiSuccess({ closed: true });
});
