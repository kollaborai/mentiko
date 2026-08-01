import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/api-auth";
import { enforceGuestWrites } from "@/lib/middleware";
import { getWorkspaceId, hasWorkspaceParam } from "@/lib/workspaces/workspace-params";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getSessionUser } from "@/lib/auth/auth-bridge";
import { createTask } from "@/lib/tasks/task-creation-service";
import { BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

// POST /api/tasks/create - create a new task (requires manage_tasks)
//
// Thin adapter over task-creation-service.ts (chain-contract Track C). This
// route implements no defaults of its own -- it only translates the UI's
// wire shape (title/type/parent/chainAssignment, ?workspace= query param)
// into the service's canonical request and back.
export const POST = requirePermission("manage_tasks")(
  withErrorHandling(async (request: NextRequest) => {
    const blockResult = await enforceGuestWrites(request);
    if (blockResult?.blocked) return blockResult.response;

    const namespaceId = await getNamespaceIdFromRequest(request);
    const orgId = await getOrgIdFromRequest(request);
    const actor = await getSessionUser(request);
    const workspaceId = getWorkspaceId(request);
    const malformedWorkspaceRef = hasWorkspaceParam(request) && !workspaceId;

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
      idempotencyKey,
    } = body;

    if (!title) {
      throw new BadRequest("Title is required", { field: "title" });
    }

    const result = await createTask({
      namespaceId,
      orgId,
      source: "ui",
      actorUserId: actor?.id,
      title,
      description,
      issueType: type,
      priority,
      parentId: parent,
      assignee,
      labels,
      workspaceRef: workspaceId,
      malformedWorkspaceRef,
      chainAssignment: chainAssignment
        ? {
            chainId: chainAssignment.chainId,
            chainName: chainAssignment.chainName,
            autoRun: typeof chainAssignment.autoRun === "boolean" ? chainAssignment.autoRun : undefined,
          }
        : undefined,
      idempotencyKey: typeof idempotencyKey === "string" ? idempotencyKey : undefined,
    });

    return apiSuccess(
      {
        issue: result.task,
        creation: {
          outcome: result.outcome,
          effectiveAutoRun: result.effectiveAutoRun,
          chainBinding: result.chainBinding,
          ...(result.decision ? { decision: result.decision } : {}),
        },
      },
      undefined,
      result.outcome === "existing" ? 200 : 201,
    );
  })
);
