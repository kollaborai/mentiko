import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/api-auth";
import { enforceGuestWrites } from "@/lib/middleware";
import { taskAddDep } from "@/lib/task-store";
import { validateTaskId } from "@/lib/task-store";
import { getWorkspaceId, hasWorkspaceParam } from "@/lib/workspace-params";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

// POST /api/tasks/deps - add a dependency between two tasks
// body: { from: string, to: string } => "from" depends on "to" (to blocks from)
export const POST = requirePermission("manage_tasks")(
  withErrorHandling(async (request: NextRequest) => {
    const blockResult = await enforceGuestWrites(request);
    if (blockResult?.blocked) return blockResult.response;

    const workspaceId = getWorkspaceId(request);
    const namespaceId = await getNamespaceIdFromRequest(request);
    const orgId = await getOrgIdFromRequest(request);

    if (hasWorkspaceParam(request) && !workspaceId) {
      throw new BadRequest(
        "Tasks not initialized in this workspace."
      );
    }

    const body = await request.json();

    if (!body.from) {
      throw new BadRequest("Missing required field: from (the task to be blocked)", {
        field: "from",
      });
    }
    if (!body.to) {
      throw new BadRequest("Missing required field: to (the task that blocks)", {
        field: "to",
      });
    }

    const from = validateTaskId(body.from);
    const to = validateTaskId(body.to);

    taskAddDep(orgId, from, to, namespaceId, workspaceId);

    return apiSuccess({ ok: true, from, to });
  })
);
