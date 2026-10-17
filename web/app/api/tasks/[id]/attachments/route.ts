import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/api-auth";
import { enforceGuestWrites } from "@/lib/middleware";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getSessionUser } from "@/lib/auth/auth-bridge";
import { taskAttachmentCreate, taskAttachmentsForTask } from "@/lib/tasks/task-attachment-store";
import { BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

/**
 * Extract upload bytes from a File. Prefers arrayBuffer() (all real server
 * runtimes); falls back to streaming through Response for environments whose
 * FormData returns a proxied File without prototype methods.
 */
async function fileToBuffer(file: File): Promise<Buffer> {
  if (typeof file.arrayBuffer === "function") {
    return Buffer.from(await file.arrayBuffer());
  }
  return Buffer.from(await new Response(file as unknown as BodyInit).arrayBuffer());
}

// GET /api/tasks/[id]/attachments - list a task's stored attachments
export const GET = requirePermission("view_tasks")(
  withErrorHandling(
    async (
      request: NextRequest,
      context: { params: Promise<{ id: string }> }
    ) => {
      const namespaceId = await getNamespaceIdFromRequest(request);
      const orgId = await getOrgIdFromRequest(request);
      const { id } = await context.params;

      return apiSuccess({
        attachments: taskAttachmentsForTask(orgId, decodeURIComponent(id), namespaceId),
      });
    }
  )
);

// POST /api/tasks/[id]/attachments - upload one image attachment
// (requires manage_tasks; the one proven TASK-004 upload path)
export const POST = requirePermission("manage_tasks")(
  withErrorHandling(
    async (
      request: NextRequest,
      context: { params: Promise<{ id: string }> }
    ) => {
      const blockResult = await enforceGuestWrites(request);
      if (blockResult?.blocked) return blockResult.response;

      const namespaceId = await getNamespaceIdFromRequest(request);
      const orgId = await getOrgIdFromRequest(request);
      const actor = await getSessionUser(request);
      const { id } = await context.params;
      const taskId = decodeURIComponent(id);

      const contentType = request.headers.get("content-type") ?? "";
      if (!contentType.includes("multipart/form-data")) {
        throw new BadRequest("multipart/form-data body required", {
          field: "file",
          reason: "invalid_content_type",
        });
      }

      const formData = await request.formData();
      const file = formData.get("file");
      if (!(file instanceof File)) {
        throw new BadRequest("file is required", { field: "file" });
      }

      const attachment = taskAttachmentCreate({
        orgId,
        taskId,
        namespaceId,
        createdBy: actor?.id,
        file: {
          name: file.name,
          type: file.type,
          bytes: await fileToBuffer(file),
        },
      });

      return apiSuccess({ attachment }, undefined, 201);
    }
  )
);
