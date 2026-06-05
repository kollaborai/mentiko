import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/api-auth";
import { enforceGuestWrites } from "@/lib/middleware";
import { taskClose, taskDelete, validateTaskId } from "@/lib/tasks/task-store";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

// POST /api/tasks/bulk - bulk close or delete tasks
export const POST = requirePermission("manage_tasks")(
  withErrorHandling(async (request: NextRequest) => {
    const blockResult = await enforceGuestWrites(request);
    if (blockResult?.blocked) return blockResult.response;

    const namespaceId = await getNamespaceIdFromRequest(request);
    const orgId = await getOrgIdFromRequest(request);
    const { ids, action } = await request.json();

    if (!Array.isArray(ids) || ids.length === 0) {
      throw new BadRequest("ids must be a non-empty array");
    }
    if (action !== "close" && action !== "delete") {
      throw new BadRequest("action must be 'close' or 'delete'");
    }

    const results: { id: string; ok: boolean; error?: string }[] = [];

    for (const rawId of ids) {
      try {
        const safeId = validateTaskId(rawId);
        if (action === "close") {
          taskClose(orgId, safeId, undefined, namespaceId);
        } else {
          taskDelete(orgId, safeId, namespaceId);
        }
        results.push({ id: rawId, ok: true });
      } catch (err) {
        results.push({ id: rawId, ok: false, error: (err as Error).message });
      }
    }

    const succeeded = results.filter((r) => r.ok).length;
    return apiSuccess({ action, total: ids.length, succeeded, results });
  })
);
