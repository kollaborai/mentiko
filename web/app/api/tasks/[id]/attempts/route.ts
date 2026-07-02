import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/api-auth";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { NotFound } from "@/lib/api-errors";
import { listTaskAttempts } from "@/lib/tasks/task-attempts";
import { taskGet, validateTaskId } from "@/lib/tasks/task-store";

export const dynamic = "force-dynamic";

function metadataRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export const GET = requirePermission("view_tasks")(
  withErrorHandling(
    async (
      request: NextRequest,
      context: { params: Promise<{ id: string }> }
    ) => {
      const namespaceId = await getNamespaceIdFromRequest(request);
      const orgId = await getOrgIdFromRequest(request);
      const { id } = await context.params;
      const safeId = validateTaskId(decodeURIComponent(id));
      const task = taskGet(orgId, safeId, namespaceId);

      if (!task) {
        throw new NotFound("Task", id);
      }

      const metadata = metadataRecord(task.metadata);
      const attempts = listTaskAttempts({
        namespaceId,
        orgId,
        taskId: safeId,
        metadata,
      });

      return apiSuccess({
        taskId: safeId,
        currentExecutionRunId:
          typeof metadata.last_run_id === "string" ? metadata.last_run_id : undefined,
        attempts,
      });
    }
  )
);
