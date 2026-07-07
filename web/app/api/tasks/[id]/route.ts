import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/api-auth";
import { enforceGuestWrites } from "@/lib/middleware";
import { taskGet, taskList, taskUpdate } from "@/lib/tasks/task-store";
import { validateTaskId } from "@/lib/tasks/task-store";
import { filterVisibleTaskRecords } from "@/lib/tasks/task-visibility";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { validateChainId, buildChainMetadata } from "@/lib/chains/chain-validation";
import { NotFound, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

// GET /api/tasks/[id] - show task detail (requires view_tasks)
export const GET = requirePermission("view_tasks")(
  withErrorHandling(
    async (
      request: NextRequest,
      _context: { params: Promise<{ id: string }> }
    ) => {
      const namespaceId = await getNamespaceIdFromRequest(request);
      const orgId = await getOrgIdFromRequest(request);
      const { id } = await _context.params;
      const safeId = validateTaskId(decodeURIComponent(id));
      const issue = taskGet(orgId, safeId, namespaceId);

      if (!issue) {
        throw new NotFound("Task", id);
      }
      const visibleTaskIds = new Set(
        filterVisibleTaskRecords(
          taskList(orgId, { status: "all" }, undefined, namespaceId),
        ).map((task) => task.id),
      );
      if (!visibleTaskIds.has(issue.id)) {
        throw new NotFound("Task", id);
      }

      return apiSuccess({ issue });
    }
  )
);

// PATCH /api/tasks/[id] - update task fields (requires manage_tasks)
export const PATCH = requirePermission("manage_tasks")(
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

      // Handle chainAssignment - validate before update
      let chainMetadata: Record<string, unknown> | null = null;
      if (body.chainAssignment !== undefined) {
        if (body.chainAssignment === null) {
          chainMetadata = {};
        } else if (body.chainAssignment?.chainId) {
          const validation = validateChainId(
            body.chainAssignment.chainId,
            namespaceId,
            orgId
          );
          if (!validation.valid) {
            throw new BadRequest(validation.error || "Chain validation failed");
          }
          chainMetadata = buildChainMetadata(
            body.chainAssignment.chainId,
            validation.chainName || body.chainAssignment.chainName,
            body.chainAssignment.autoRun ?? false
          );
        }
      }

      // Build update fields
      const updateFields: Record<string, unknown> = {};
      if (body.title) updateFields.title = body.title;
      if (body.description !== undefined) updateFields.description = body.description;
      if (body.status) updateFields.status = body.status;
      if (body.priority !== undefined) updateFields.priority = body.priority;
      if (body.assignee) updateFields.assignee = body.assignee;
      if (body.acceptance) updateFields.acceptance_criteria = body.acceptance;
      if (body.design !== undefined) updateFields.design = body.design;
      if (body.notes !== undefined) updateFields.notes = body.notes;
      if (body.add_labels?.length) updateFields.add_labels = body.add_labels;
      if (body.remove_labels?.length) updateFields.remove_labels = body.remove_labels;

      // Handle metadata merge
      if (chainMetadata !== null || body.metadata !== undefined) {
        const incomingMeta = body.metadata
          ? typeof body.metadata === "string"
            ? JSON.parse(body.metadata)
            : body.metadata
          : {};

        // explicit clear: chainAssignment=null or metadata="{}" -> replace, don't merge
        const isExplicitClear =
          body.chainAssignment === null ||
          (body.metadata !== undefined &&
            Object.keys(incomingMeta).length === 0 &&
            !chainMetadata);

        if (isExplicitClear) {
          updateFields.metadata = {};
        } else {
          const current = taskGet(orgId, safeId, namespaceId);
          const existingMeta =
            current?.metadata && typeof current.metadata === "object"
              ? (current.metadata as Record<string, unknown>)
              : {};
          updateFields.metadata = {
            ...existingMeta,
            ...incomingMeta,
            ...(chainMetadata || {}),
          };
        }
      }

      if (Object.keys(updateFields).length === 0) {
        throw new BadRequest("No update fields provided");
      }

      taskUpdate(orgId, safeId, updateFields, namespaceId);

      // Re-fetch updated issue
      const updated = taskGet(orgId, safeId, namespaceId);
      if (!updated) {
        throw new NotFound("Task", id);
      }

      return apiSuccess({ issue: updated });
    }
  )
);
