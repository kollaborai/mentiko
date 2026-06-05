import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/api-auth";
import { enforceGuestWrites } from "@/lib/middleware";
import { taskGet, taskUpdate, taskList } from "@/lib/tasks/task-store";
import { validateTaskId } from "@/lib/tasks/task-store";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { NotFound, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

/**
 * POST /api/tasks/[id]/auto-run
 * Toggle auto_run on an epic and propagate to all subtasks.
 * Body: { auto_run: boolean }
 */
export const POST = requirePermission("manage_tasks")(
  withErrorHandling(
    async (
      request: NextRequest,
      _context: { params: Promise<{ id: string }> }
    ) => {
      const blockResult = await enforceGuestWrites(request);
      if (blockResult?.blocked) return blockResult.response;

      const orgId = await getOrgIdFromRequest(request);
      const namespaceId = await getNamespaceIdFromRequest(request);
      const { id } = await _context.params;
      const safeId = validateTaskId(decodeURIComponent(id));
      const body = await request.json();

      if (typeof body.auto_run !== "boolean") {
        throw new BadRequest("auto_run (boolean) is required");
      }

      const epic = taskGet(orgId, safeId, namespaceId);
      if (!epic) {
        throw new NotFound("Task", id);
      }

      // toggle on the epic itself
      const epicMeta = epic.metadata && typeof epic.metadata === "object"
        ? (epic.metadata as Record<string, unknown>)
        : {};
      taskUpdate(orgId, safeId, {
        metadata: {
          ...epicMeta,
          auto_run: body.auto_run,
          ...(body.auto_run ? { auto_run_retries: 0, last_run_error: undefined } : {}),
        },
      }, namespaceId);

      // find all subtasks (children with parent_id = this epic)
      const allTasks = taskList(orgId, { status: "all" }, undefined, namespaceId);
      const children = allTasks.filter(t => t.parent_id === safeId);

      const updated: string[] = [safeId];

      for (const child of children) {
        const childMeta = child.metadata && typeof child.metadata === "object"
          ? (child.metadata as Record<string, unknown>)
          : {};
        taskUpdate(orgId, child.id, {
          metadata: {
            ...childMeta,
            auto_run: body.auto_run,
            ...(body.auto_run ? { auto_run_retries: 0, last_run_error: undefined } : {}),
          },
        }, namespaceId);
        updated.push(child.id);
      }

      return apiSuccess({ updated, auto_run: body.auto_run });
    }
  )
);
