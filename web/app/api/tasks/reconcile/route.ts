import { NextRequest } from "next/server";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { checkAuth } from "@/lib/auth/api-auth";
import { taskList, taskUpdate } from "@/lib/tasks/task-store";
import { validateTaskId } from "@/lib/tasks/task-store";
import { startTaskOutcomeAudit } from "@/lib/tasks/task-outcome-audit";
import { getWorkspaceId, hasWorkspaceParam } from "@/lib/workspaces/workspace-params";
import { getLiveSessions } from "@/lib/pty/pty-client";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import config from "@/lib/config";
import { writeLog } from "@/lib/system/system-logger";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { cleanTaskExecutionRunMetadata, isNonExecutionRun } from "@/lib/runs/run-provenance";
import { allDeclaredAgentsComplete, latestAgentCompletion } from "@/lib/runs/run-completion";
import { hasExecutionRetriesRemaining, nextExecutionRetryMetadata } from "@/lib/tasks/execution-retry-policy";
import { applyTypedExecutorPlan } from "@/lib/runner-v2/adapters";
import { recoverLateCompletionEvents } from "@/lib/runner-v2/completion-recovery";
import { parseRunnerEvent, type RunnerEventRecord } from "@/lib/runner-v2/events";
import { buildTypedExecutorPlan } from "@/lib/runner-v2/executor";
import type { RoutingChain } from "@/lib/runner-v2/routing";

export const dynamic = "force-dynamic";

const DONE_TASK_STATUSES = new Set(["closed", "resolved", "done", "complete"]);
// Any terminal run state hands off to the completion auditor, which owns the
// retry-vs-decision-vs-close call. A genuine failure becomes the auditor's
// "retry"; a run that needs a human becomes "decision".
const TERMINAL_RUN_STATUSES = new Set(["completed", "complete", "failed", "stopped"]);
const RUN_STARTUP_GRACE_MS = 2 * 60 * 1000;
const RUN_HANDOFF_GRACE_MS = 5 * 60 * 1000;

interface ReconcileResult {
  taskId: string;
  runId: string;
  previousStatus: string;
  newStatus: string;
  reason: string;
}

// A completed auto-run is eligible for a completion audit when it points at an
// execution chain. The audit helper owns idempotency by run terminal
// fingerprint; reconcile must not suppress a later terminal audit from a stale
// completion_audit_run_id alone.
function shouldAuditCompletedAutoRun(meta: Record<string, unknown>): boolean {
  const generatedTaskHasExecutionChain =
    !meta.generation_job_id ||
    typeof meta.chain_id === "string" ||
    typeof meta.chain_name === "string" ||
    typeof meta.last_run_chain === "string";

  return (
    meta.auto_run === true &&
    !!meta.last_run_id &&
    generatedTaskHasExecutionChain
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
  const terminalAutoRunTasks = issues.filter((issue) => {
    if (DONE_TASK_STATUSES.has(issue.status)) return false;
    const meta = parseMetadata(issue.metadata);
    const lastRunStatus =
      typeof meta?.last_run_status === "string" ? meta.last_run_status : undefined;
    return (
      !!meta &&
      !!lastRunStatus &&
      TERMINAL_RUN_STATUSES.has(lastRunStatus) &&
      shouldAuditCompletedAutoRun(meta)
    );
  });

  if (runningTasks.length === 0 && terminalAutoRunTasks.length === 0) {
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

        const lateRecovery = recoverLateCompletionIfPossible({
          runDir,
          runJsonPath,
          runId,
          run,
          namespaceId,
          orgId,
        });
        if (lateRecovery.recovered) {
          newStatus = lateRecovery.status;
          reason = lateRecovery.reason;
        } else if (run.status !== "running" && run.status !== "pending") {
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

        const autoRun = meta?.auto_run === true;
        if (autoRun && TERMINAL_RUN_STATUSES.has(newStatus)) {
          if (hasExecutionRetriesRemaining(updatedMeta, newStatus)) {
            const retryMeta = nextExecutionRetryMetadata(updatedMeta, newStatus, reason);
            taskUpdate(orgId, safeId, { status: "open", metadata: retryMeta }, namespaceId);
            newStatus = "retry_requested";
            reason = `execution retry scheduled before outcome summary: ${reason}`;
          } else {
            try {
              await startTaskOutcomeAudit({ request, namespaceId, orgId, taskId: safeId });
            } catch (auditError) {
              failed.push({
                taskId: issue.id,
                error: `Failed to start completion audit: ${(auditError as Error).message}`,
              });
            }
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

  for (const issue of terminalAutoRunTasks) {
    const meta = parseMetadata(issue.metadata)!;
    const runId = meta.last_run_id as string;
    const runDir = join(config.runsDir, runId);
    const runJsonPath = join(runDir, "run.json");

    try {
      if (!existsSync(runDir) || !existsSync(runJsonPath)) {
        failed.push({ taskId: issue.id, error: `Terminal run ${runId} no longer exists` });
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

      const safeId = validateTaskId(issue.id);
      const lateRecovery = recoverLateCompletionIfPossible({
        runDir,
        runJsonPath,
        runId,
        run,
        namespaceId,
        orgId,
      });
      if (lateRecovery.recovered) {
        const updatedMeta: Record<string, unknown> = {
          ...meta,
          last_run_status: lateRecovery.status,
        };
        if (lateRecovery.status === "completed") {
          updatedMeta.last_run_completed = new Date().toISOString();
        }
        taskUpdate(orgId, safeId, { metadata: updatedMeta }, namespaceId);
        writeLog(namespaceId, orgId, "warn", "task-reconciler",
          `task ${issue.id} run ${runId}: ${lateRecovery.status}`, lateRecovery.reason);
        results.push({
          taskId: issue.id,
          runId,
          previousStatus: String(meta.last_run_status || run.status || "terminal"),
          newStatus: lateRecovery.status,
          reason: lateRecovery.reason,
        });
        continue;
      }

      if (!run.status || !TERMINAL_RUN_STATUSES.has(run.status)) {
        continue;
      }

      if (hasExecutionRetriesRemaining(meta, run.status)) {
        const retryMeta = nextExecutionRetryMetadata(meta, run.status, `run.json status is ${run.status}`);
        taskUpdate(orgId, safeId, { status: "open", metadata: retryMeta }, namespaceId);
        writeLog(namespaceId, orgId, "warn", "task-reconciler",
          `task ${issue.id} run ${runId}: retry requested`,
          `execution retry scheduled before outcome summary: ${run.status}`);
        results.push({
          taskId: issue.id,
          runId,
          previousStatus: String(meta.last_run_status || run.status),
          newStatus: "retry_requested",
          reason: "execution retry scheduled before outcome summary",
        });
        continue;
      }

      const audit = await startTaskOutcomeAudit({ request, namespaceId, orgId, taskId: safeId });
      writeLog(namespaceId, orgId, "warn", "task-reconciler",
        `task ${issue.id} run ${runId}: audit ${audit.status}`,
        "completion audit triggered for terminal auto-run task");
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
    checked: runningTasks.length + terminalAutoRunTasks.length,
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

function recoverLateCompletionIfPossible(input: {
  runDir: string;
  runJsonPath: string;
  runId: string;
  run: Record<string, unknown>;
  namespaceId: string;
  orgId: string;
}): { recovered: false } | { recovered: true; status: string; reason: string } {
  const chainPath = join(input.runDir, "chain.json");
  if (!existsSync(chainPath)) return { recovered: false };

  const chain = readRoutingChain(chainPath);
  if (!chain) return { recovered: false };

  const events = readEventsFromDirs([
    config.eventsDir,
    join(input.runDir, "events"),
    join(dirname(chainPath), "events"),
  ]);
  const recovery = recoverLateCompletionEvents({
    runJsonPath: input.runJsonPath,
    runId: input.runId,
    chain,
    events,
  });
  if (recovery.recovered.length === 0) return { recovered: false };

  for (const item of recovery.recovered) {
    const plan = buildTypedExecutorPlan({
      pipeline: {
        decision: {
          action: "route",
          event: item.event,
          route: item.route,
          run: recovery.run,
        },
        loopStateBefore: { visited: [], round: 0 },
      },
      allEvents: events,
      routeContext: {
        chainPath,
        workspacePath: typeof input.run.workspacePath === "string" ? input.run.workspacePath : undefined,
        taskId: typeof input.run.taskId === "string" ? input.run.taskId : undefined,
        runDir: input.runDir,
        env: {
          MENTIKO_RUN_ID: input.runId,
          RUN_ID: input.runId,
          NAMESPACE_ID: input.namespaceId,
          ORG_ID: input.orgId,
          MENTIKO_RUNNER_V2: "1",
          MENTIKO_RUNNER_V2_COMPLETION: "1",
        },
      },
      terminal: {
        runId: input.runId,
        chainId: typeof input.run.chainId === "string" ? input.run.chainId : chain.id,
        chainName: chain.name || chain.id || "unknown",
        chainPath,
        taskId: typeof input.run.taskId === "string" ? input.run.taskId : undefined,
        lastAgentId: item.agentId,
      },
    });
    applyTypedExecutorPlan(plan, {
      runJsonPath: input.runJsonPath,
      stateDir: config.stateDir,
      namespaceId: input.namespaceId,
      orgId: input.orgId,
      eventsDir: config.eventsDir,
      eventsArchiveDir: join(config.eventsDir, "archive"),
    });
  }

  return {
    recovered: true,
    status: recovery.run.status,
    reason: `late completion event recovered for ${recovery.recovered.map((item) => item.agentId).join(", ")}`,
  };
}

function readRoutingChain(chainPath: string): RoutingChain | undefined {
  try {
    const chain = JSON.parse(readFileSync(chainPath, "utf-8")) as RoutingChain;
    return Array.isArray(chain.agents) ? chain : undefined;
  } catch {
    return undefined;
  }
}

function readEventsFromDirs(eventsDirs: string[]): RunnerEventRecord[] {
  const seenDirs = new Set<string>();
  const seenFiles = new Set<string>();
  const events: RunnerEventRecord[] = [];
  for (const dir of eventsDirs) {
    if (!dir || seenDirs.has(dir) || !existsSync(dir)) continue;
    seenDirs.add(dir);
    let files: string[] = [];
    try {
      files = readdirSync(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".event")) continue;
      const path = join(dir, file);
      if (seenFiles.has(path)) continue;
      seenFiles.add(path);
      events.push({ ...parseRunnerEvent(readFileSync(path, "utf-8")), path });
    }
  }
  return events;
}
