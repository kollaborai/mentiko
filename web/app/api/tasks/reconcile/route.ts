import { NextRequest } from "next/server";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { checkAuth } from "@/lib/auth/api-auth";
import { taskList, taskUpdate } from "@/lib/tasks/task-store";
import { validateTaskId } from "@/lib/tasks/task-store";
import { startTaskOutcomeAudit } from "@/lib/tasks/task-outcome-audit";
import { getWorkspaceId, hasWorkspaceParam } from "@/lib/workspaces/workspace-params";
import { getLiveSessions } from "@/lib/pty/pty-client";
import { createNotification } from "@/lib/notifications/notification-server";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import config from "@/lib/config";
import { writeLog } from "@/lib/system/system-logger";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { cleanTaskExecutionRunMetadata, isNonExecutionRun } from "@/lib/runs/run-provenance";
import { allDeclaredAgentsComplete, latestAgentCompletion } from "@/lib/runs/run-completion";

export const dynamic = "force-dynamic";

const DONE_TASK_STATUSES = new Set(["closed", "resolved", "done", "complete"]);
const COMPLETED_RUN_STATUSES = new Set(["completed", "complete"]);
const RUN_STARTUP_GRACE_MS = 2 * 60 * 1000;
const RUN_HANDOFF_GRACE_MS = 5 * 60 * 1000;

interface ReconcileResult {
  taskId: string;
  runId: string;
  previousStatus: string;
  newStatus: string;
  reason: string;
}

// A completed auto-run is eligible for a completion audit once per run, as long
// as it hasn't already been audited and isn't a generation/meta run.
function shouldAuditCompletedAutoRun(meta: Record<string, unknown>): boolean {
  return (
    meta.auto_run === true &&
    !meta.generation_job_id &&
    !!meta.last_run_id &&
    meta.completion_audit_run_id !== meta.last_run_id
  );
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
  const completedAutoRunTasks = issues.filter((issue) => {
    if (DONE_TASK_STATUSES.has(issue.status)) return false;
    const meta = parseMetadata(issue.metadata);
    const lastRunStatus =
      typeof meta?.last_run_status === "string" ? meta.last_run_status : undefined;
    return (
      !!meta &&
      !!lastRunStatus &&
      COMPLETED_RUN_STATUSES.has(lastRunStatus) &&
      shouldAuditCompletedAutoRun(meta)
    );
  });

  if (runningTasks.length === 0 && completedAutoRunTasks.length === 0) {
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
          if (allDeclaredAgentsComplete(run, runDir)) {
            run.status = "completed";
            run.completed = latestAgentCompletion(run) || run.completed || new Date().toISOString();
            writeFileSync(runJsonPath, JSON.stringify(run, null, 2));
            newStatus = "completed";
            reason = "all declared agents are complete";
          }
          const anyAlive = agents.some(
            (a: { status: string; session?: string }) =>
              a.status === "running" && a.session && liveSessions.has(a.session)
          );

          if (!newStatus && !anyAlive) {
            const anyRunning = agents.some((a: { status: string }) => a.status === "running");
            const anyPending = agents.some((a: { status: string }) => a.status === "pending");
            if (anyRunning || anyPending) {
              const startedAt = parseTimeMs(run.started) || parseTimeMs(meta.last_run_started);
              const ageMs = startedAt ? Date.now() - startedAt : RUN_STARTUP_GRACE_MS;
              const lastCompletionMs = latestAgentCompletionMs(agents);
              const inHandoffWindow = lastCompletionMs
                ? Date.now() - lastCompletionMs < RUN_HANDOFF_GRACE_MS
                : false;
              if (ageMs >= RUN_STARTUP_GRACE_MS && !inHandoffWindow) {
                newStatus = "stopped";
                reason = "no live sessions found";
              }
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
        const updatedMeta: Record<string, unknown> = { ...meta, last_run_status: newStatus };
        if (newStatus === "completed") {
          updatedMeta.last_run_completed = new Date().toISOString();
        }
        taskUpdate(orgId, safeId, { metadata: updatedMeta }, namespaceId);

        // auto-run handling: on success, hand the completed run to the
        // completion auditor (which decides close/decision/retry); on failure,
        // clear state so the auto-run poller retries from scratch.
        const autoRun = meta?.auto_run === true;
        if (autoRun && newStatus === "completed") {
          try {
            await startTaskOutcomeAudit({ request, namespaceId, orgId, taskId: safeId });
          } catch (auditError) {
            failed.push({
              taskId: issue.id,
              error: `Failed to start completion audit: ${(auditError as Error).message}`,
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

  for (const issue of completedAutoRunTasks) {
    const meta = parseMetadata(issue.metadata)!;
    const runId = meta.last_run_id as string;
    const runDir = join(config.runsDir, runId);
    const runJsonPath = join(runDir, "run.json");

    try {
      if (!existsSync(runDir) || !existsSync(runJsonPath)) {
        failed.push({ taskId: issue.id, error: `Completed run ${runId} no longer exists` });
        continue;
      }

      const run = JSON.parse(readFileSync(runJsonPath, "utf-8"));
      if (isNonExecutionRun(run)) {
        const safeId = validateTaskId(issue.id);
        const cleaned = cleanTaskExecutionRunMetadata(meta, run, runId);
        taskUpdate(orgId, safeId, { metadata: cleaned }, namespaceId);
        writeLog(namespaceId, orgId, "warn", "task-reconciler",
          `task ${issue.id} ignored completed non-execution run ${runId}`,
          "non-execution run is not a task execution run");
        results.push({
          taskId: issue.id,
          runId,
          previousStatus: String(meta.last_run_status || "completed"),
          newStatus: "non_execution_ignored",
          reason: "non-execution run is not a task execution run",
        });
        continue;
      }

      if (!run.status || !COMPLETED_RUN_STATUSES.has(run.status)) {
        continue;
      }

      const safeId = validateTaskId(issue.id);
      const audit = await startTaskOutcomeAudit({ request, namespaceId, orgId, taskId: safeId });
      writeLog(namespaceId, orgId, "warn", "task-reconciler",
        `task ${issue.id} run ${runId}: audit ${audit.status}`,
        "completion audit triggered for completed auto-run task");
      results.push({
        taskId: issue.id,
        runId,
        previousStatus: String(meta.last_run_status || "completed"),
        newStatus: `audit_${audit.status}`,
        reason: "completion audit triggered",
      });
    } catch (error) {
      failed.push({
        taskId: issue.id,
        error: (error as Error).message,
      });
    }
  }

  return apiSuccess({
    reconciled: results.length,
    checked: runningTasks.length + completedAutoRunTasks.length,
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

function parseTimeMs(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function latestAgentCompletionMs(agents: Array<{ completed?: unknown }>): number | undefined {
  return agents
    .map((agent) => parseTimeMs(agent.completed))
    .filter((ms): ms is number => typeof ms === "number")
    .sort((a, b) => b - a)[0];
}
