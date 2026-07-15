import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/api-auth";
import { apiSuccess, withErrorHandling } from "@/lib/api-response";
import { BadRequest, NotFound } from "@/lib/api-errors";
import { getSessionUser } from "@/lib/auth/auth-bridge";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { taskGet, validateTaskId } from "@/lib/tasks/task-store";
import {
  currentRunStatus,
  isOutcomeSummaryTerminalStatus,
  isOutcomeSummaryExecutionSource,
  metadataRecord,
} from "@/lib/tasks/run-outcome-evidence";
import { EXECUTION_RETRY_LIMIT, RETRYABLE_EXECUTION_STATUSES } from "@/lib/tasks/execution-retry-policy";
import { hydrateLifecycleState } from "@/lib/orchestration/task-lifecycle-hydrate";
import { startTaskOutcomeAudit } from "@/lib/tasks/task-outcome-audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = requirePermission("manage_tasks")(
  withErrorHandling(async (
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
  ) => {
    const namespaceId = await getNamespaceIdFromRequest(request);
    const orgId = await getOrgIdFromRequest(request);
    const session = await getSessionUser(request);
    const { id } = await context.params;
    const taskId = validateTaskId(decodeURIComponent(id));
    const task = taskGet(orgId, taskId, namespaceId);
    if (!task) throw new NotFound("Task", taskId);

    const metadata = metadataRecord(task.metadata);
    const sourceRunId = typeof metadata.last_run_id === "string" ? metadata.last_run_id : "";
    if (!sourceRunId) {
      throw new BadRequest("Task has no execution run to summarize");
    }
    if (!isOutcomeSummaryExecutionSource(namespaceId, orgId, sourceRunId)) {
      throw new BadRequest("Task outcome summary source must be an execution run");
    }
    const runStatus = currentRunStatus(namespaceId, orgId, sourceRunId);
    if (!isOutcomeSummaryTerminalStatus(runStatus)) {
      throw new BadRequest(`Execution run ${sourceRunId} is ${runStatus}; outcome summary requires a terminal run`);
    }
    const lifecycleState = hydrateLifecycleState(taskId, {
      ...metadata,
      last_run_status: runStatus,
      last_run_id: sourceRunId,
    });
    if (
      RETRYABLE_EXECUTION_STATUSES.has(runStatus) &&
      lifecycleState.executionRetryCount < lifecycleState.retryBudget
    ) {
      throw new BadRequest(
        `Execution run ${sourceRunId} ended with ${runStatus}; retry ${lifecycleState.executionRetryCount + 1}/${EXECUTION_RETRY_LIMIT} must run before outcome summary`
      );
    }
    const result = await startTaskOutcomeAudit({
      request,
      namespaceId,
      orgId,
      taskId,
      userId: session?.id,
    });
    if (result.status === "already_exists") {
      return apiSuccess({
        status: "already_exists",
        summary: metadata.task_outcome_summary,
        sourceRunId: result.sourceRunId ?? sourceRunId,
      });
    }

    return apiSuccess({
      status: result.status === "started" ? "running" : result.status,
      jobId: result.jobId,
      runId: result.runId,
      sourceRunId: result.sourceRunId ?? sourceRunId,
    });
  })
);
