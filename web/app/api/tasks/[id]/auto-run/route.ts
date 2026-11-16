import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/api-auth";
import { enforceGuestWrites } from "@/lib/middleware";
import { taskGet, taskMutateMetadata, taskList } from "@/lib/tasks/task-store";
import { validateTaskId } from "@/lib/tasks/task-store";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { NotFound, BadRequest, Conflict } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { ResumeResetConflictError, withTaskResumeClaim } from "@/lib/runs/resume-reset";

export const dynamic = "force-dynamic";

/**
 * A reset writes nulls, not undefined: the metadata round-trip drops undefined
 * keys, so undefined would leave the stale error/pause alive (#142). Enabling
 * auto-run is an explicit reset: it increments resume_series (invalidating
 * older resume outcomes against this task), clears the retry budget and the
 * recorded errors, and releases any operational pause so dispatch resumes.
 */
function resetAutoRunMetadata(
  metadata: Record<string, unknown>,
  autoRun: boolean,
): Record<string, unknown> | null {
  if (!autoRun) {
    return metadata.auto_run === false ? null : { ...metadata, auto_run: false };
  }
  const series = typeof metadata.resume_series === "number"
    && Number.isFinite(metadata.resume_series) && metadata.resume_series >= 0
    ? Math.floor(metadata.resume_series)
    : 0;
  return {
    ...metadata,
    auto_run: true,
    auto_run_retries: 0,
    last_run_error: null,
    resume_last_error: null,
    resume_series: series + 1,
    auto_run_paused: false,
    auto_run_paused_reason: null,
  };
}

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

      // Guarded merge on the epic itself (issue #141 CAS loop), serialized
      // against a resume acceptance by the run's .resume-claim (#142 round 2):
      // enabling auto-run is a reset, and a reset never optimistically
      // succeeds while a resume holds the claim.
      try {
        withTaskResumeClaim({ orgId, namespaceId, taskId: safeId }, () =>
          taskMutateMetadata(orgId, safeId, (metadata) =>
            resetAutoRunMetadata(metadata, body.auto_run), namespaceId));
      } catch (error) {
        if (error instanceof ResumeResetConflictError) throw new Conflict(error.message);
        throw error;
      }

      // find all subtasks (children with parent_id = this epic)
      const allTasks = taskList(orgId, { status: "all" }, undefined, namespaceId);
      const children = allTasks.filter(t => t.parent_id === safeId);

      const updated: string[] = [safeId];

      for (const child of children) {
        try {
          withTaskResumeClaim({ orgId, namespaceId, taskId: child.id }, () =>
            taskMutateMetadata(orgId, child.id, (metadata) =>
              resetAutoRunMetadata(metadata, body.auto_run), namespaceId));
        } catch (error) {
          if (error instanceof ResumeResetConflictError) throw new Conflict(error.message);
          throw error;
        }
        updated.push(child.id);
      }

      return apiSuccess({ updated, auto_run: body.auto_run });
    }
  )
);
