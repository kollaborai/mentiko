import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/api-auth";
import { enforceGuestWrites } from "@/lib/middleware";
import { taskCreate } from "@/lib/task-store";
import { getWorkspaceId, hasWorkspaceParam } from "@/lib/workspace-params";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { validateChainId, buildChainMetadata } from "@/lib/chain-validation";
import { BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

// POST /api/tasks/create - create a new task (requires manage_tasks)
export const POST = requirePermission("manage_tasks")(
  withErrorHandling(async (request: NextRequest) => {
    const blockResult = await enforceGuestWrites(request);
    if (blockResult?.blocked) return blockResult.response;

    const namespaceId = await getNamespaceIdFromRequest(request);
    const orgId = await getOrgIdFromRequest(request);
    const workspaceId = getWorkspaceId(request);

    if (hasWorkspaceParam(request) && !workspaceId) {
      throw new BadRequest(
        "Tasks not initialized in this workspace."
      );
    }

    const body = await request.json();
    const {
      title,
      description,
      type,
      priority,
      parent,
      labels,
      assignee,
      chainAssignment,
    } = body;

    if (!title) {
      throw new BadRequest("Title is required", { field: "title" });
    }

    // Validate chain assignment if provided
    let metadata: Record<string, unknown> = {};
    // Store workspace path so auto-run executes in the right directory
    if (workspaceId) {
      metadata.workspace_path = workspaceId;
    }
    if (chainAssignment?.chainId) {
      const validation = validateChainId(
        chainAssignment.chainId,
        namespaceId,
        orgId
      );
      if (!validation.valid) {
        throw new BadRequest(validation.error || "Chain validation failed");
      }
      metadata = {
        ...metadata,
        ...buildChainMetadata(
          chainAssignment.chainId,
          validation.chainName || chainAssignment.chainName,
          chainAssignment.autoRun ?? false
        ),
      };
    } else if (chainAssignment?.autoRun) {
      // auto-run without a specific chain: system will analyze + generate
      metadata.auto_run = true;
    }

    const issue = taskCreate(orgId, {
      title,
      description,
      issue_type: type,
      priority:
        priority !== undefined && priority >= 0 && priority <= 4
          ? priority
          : undefined,
      parent_id: parent,
      assignee,
      labels,
      workspace_id: workspaceId,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    }, namespaceId);

    return apiSuccess({ issue }, undefined, 201);
  })
);
