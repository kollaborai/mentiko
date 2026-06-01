import { NextRequest } from "next/server";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { checkAuth } from "@/lib/api-auth";
import { taskList, taskUpdate, taskClose } from "@/lib/task-store";
import { validateTaskId } from "@/lib/task-store";
import { getWorkspaceId, hasWorkspaceParam } from "@/lib/workspace-params";
import { getLiveSessions } from "@/lib/pty-client";
import { createNotification } from "@/lib/notification-server";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import config from "@/lib/config";
import { writeLog } from "@/lib/system-logger";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { cleanTaskExecutionRunMetadata, isNonExecutionRun } from "@/lib/run-provenance";

export const dynamic = "force-dynamic";

const DONE_TASK_STATUSES = new Set(["closed", "resolved", "done", "complete"]);

interface ReconcileResult {
  taskId: string;
  runId: string;
  previousStatus: string;
  newStatus: string;
  reason: string;
}

// GET /api/tasks/reconcile - sweep tasks with stale "running" status
export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const workspaceId = getWorkspaceId(request);

  if (hasWorkspaceParam(request) && !workspaceId) {
    throw new BadRequest(
      "Tasks not initialized in this workspace."
    );
  }

  const results: ReconcileResult[] = [];
  const failed: Array<{ taskId: string; error: string }> = [];

  const issues = taskList(orgId, { status: "all" }, workspaceId, namespaceId);

  // filter to tasks with last_run_status=running in metadata
  const runningTasks = issues.filter((issue) => {
    const meta = parseMetadata(issue.metadata);
    return meta?.last_run_status === "running" && meta?.last_run_id;
  });

  if (runningTasks.length === 0) {
    return apiSuccess({ reconciled: 0, results: [] });
  }

  const liveSessions = await getLiveSessions();

  for (const issue of runningTasks) {
    const meta = parseMetadata(issue.metadata)!;
    const runId = meta.last_run_id as string;
    const runDir = join(config.runsDir, runId);
    const runJsonPath = join(runDir, "run.json");

    let newStatus: string | null = null;
    let reason = "";

    if (!existsSync(runDir) || !existsSync(runJsonPath)) {
      newStatus = "deleted";
      reason = "run directory no longer exists";
    } else {
      try {
        const run = JSON.parse(readFileSync(runJsonPath, "utf-8"));
        if (isNonExecutionRun(run)) {
          const safeId = validateTaskId(issue.id);
          const cleaned = cleanTaskExecutionRunMetadata(meta, run, runId);
          taskUpdate(orgId, safeId, { metadata: cleaned }, namespaceId);
          writeLog(namespaceId, orgId, "warn", "task-reconciler",
            `task ${issue.id} ignored non-execution run ${runId}`, "non-execution run is not a task execution run");
          results.push({
            taskId: issue.id,
            runId,
            previousStatus: "running",
            newStatus: "non_execution_ignored",
            reason: "non-execution run is not a task execution run",
          });
          continue;
        }

        if (run.status !== "running" && run.status !== "pending") {
          newStatus = run.status;
          reason = `run.json status is ${run.status}`;
        } else {
          const agents = run.agents || [];
          const anyAlive = agents.some(
            (a: { status: string; session?: string }) =>
              a.status === "running" && a.session && liveSessions.has(a.session)
          );

          if (!anyAlive) {
            const anyRunning = agents.some((a: { status: string }) => a.status === "running");
            const anyPending = agents.some((a: { status: string }) => a.status === "pending");
            if (anyRunning || anyPending) {
              newStatus = "stopped";
              reason = "no live sessions found";
            }
          }
        }
      } catch {
        newStatus = "unknown";
        reason = "failed to read run.json";
      }
    }

    if (newStatus) {
      try {
        const safeId = validateTaskId(issue.id);
        const updatedMeta = { ...meta, last_run_status: newStatus };
        taskUpdate(orgId, safeId, { metadata: updatedMeta }, namespaceId);

        // auto-run handling: close on success, clear state on failure so retry works
        const autoRun = meta?.auto_run === true;
        if (autoRun && newStatus === "completed") {
          try {
            taskClose(orgId, safeId, undefined, namespaceId);
            createNotification(namespaceId, {
              type: "success",
              title: "Auto-run completed",
              message: `Task "${issue.title}" completed successfully and was closed.`,
              metadata: { taskId: issue.id, runId },
            });
          } catch (closeError) {
            failed.push({
              taskId: issue.id,
              error: `Failed to close task: ${(closeError as Error).message}`,
            });
          }
        } else if (autoRun && (newStatus === "stopped" || newStatus === "failed")) {
          // clear run state so next auto-run poll cycle retries from scratch
          try {
            const updateFields = DONE_TASK_STATUSES.has(issue.status)
              ? {}
              : { status: "open" };
            taskUpdate(orgId, safeId, {
              ...updateFields,
              metadata: {
                ...meta,
                last_run_status: newStatus,
                last_run_id: undefined,
                auto_run_retries: ((meta.auto_run_retries as number) || 0) + 1,
              },
            }, namespaceId);
            createNotification(namespaceId, {
              type: "warning",
              title: "Auto-run failed",
              message: `Task "${issue.title}" run ${newStatus}. Will retry on next cycle.`,
              metadata: { taskId: issue.id, runId, status: newStatus },
            });
          } catch (retryError) {
            failed.push({
              taskId: issue.id,
              error: `Failed to clear run state for retry: ${(retryError as Error).message}`,
            });
          }
        }

        writeLog(namespaceId, orgId, "warn", "task-reconciler",
          `task ${issue.id} run ${runId}: ${newStatus}`, reason);
        results.push({
          taskId: issue.id,
          runId,
          previousStatus: "running",
          newStatus,
          reason,
        });
      } catch (error) {
        failed.push({
          taskId: issue.id,
          error: (error as Error).message,
        });
      }
    }
  }

  return apiSuccess({
    reconciled: results.length,
    checked: runningTasks.length,
    failed: failed.length,
    results,
    errors: failed,
  });
});

function parseMetadata(
  raw: string | Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  return raw;
}
