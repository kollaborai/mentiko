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
import { triggerAutoRunScan } from "@/lib/runs/auto-run-service";
import { applyTypedExecutorPlan } from "@/lib/runner-v2/adapters";
import { recoverLateCompletionEvents } from "@/lib/runner-v2/completion-recovery";
import { parseRunnerEvent, type RunnerEventRecord } from "@/lib/runner-v2/events";
import { buildTypedExecutorPlan } from "@/lib/runner-v2/executor";
import type { RoutingChain } from "@/lib/runner-v2/routing";
import { hydrateLifecycleState } from "@/lib/orchestration/task-lifecycle-hydrate";
import {
  applyLifecycleEvent,
  type LifecycleEffectDeps,
  type StartOutcomeSummaryInput,
} from "@/lib/orchestration/task-lifecycle-service";
import type { TaskLifecycleEffect, TaskLifecycleState } from "@/lib/orchestration/task-lifecycle-types";
import { currentRunTerminalFingerprint } from "@/lib/tasks/run-outcome-evidence";

export const dynamic = "force-dynamic";

const DONE_TASK_STATUSES = new Set(["closed", "resolved", "done", "complete"]);
// Any terminal run state hands off to the completion auditor, which owns the
// retry-vs-decision-vs-close call. A genuine failure becomes the auditor's
// "retry"; a run that needs a human becomes "decision".
const TERMINAL_RUN_STATUSES = new Set(["completed", "complete", "failed", "stopped", "deleted", "unknown", "cancelled"]);
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
    // Never reconcile a done task back to life: a stale last_run_status="running"
    // on a closed task must not reopen it (the reopen-clobbers-close loop that
    // kept re-admitting TASK-095). Mirrors the guard on the two filters below.
    if (DONE_TASK_STATUSES.has(issue.status)) return false;
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
  const issueById = new Map(issues.map((issue) => [issue.id, issue]));
  const followupBlockedTasks = issues.filter((issue) => {
    if (DONE_TASK_STATUSES.has(issue.status)) return false;
    const meta = parseMetadata(issue.metadata);
    return meta?.lifecycle_phase === "followup_blocked" && stringArray(meta.followup_task_ids).length > 0;
  });

  if (runningTasks.length === 0 && terminalAutoRunTasks.length === 0 && followupBlockedTasks.length === 0) {
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
          try {
            const lifecycle = await applyExecutionLifecycle({
              request,
              namespaceId,
              orgId,
              workspaceId,
              taskId: safeId,
              metadata: updatedMeta,
              runId,
              runStatus: newStatus,
              reason,
            });
            if (lifecycle.effects.some((effect) => effect.type === "retry_execution")) {
              reason = `execution retry scheduled before outcome summary: ${reason}`;
            }
            if (lifecycle.effects.some((effect) => effect.type === "retry_execution")) {
              newStatus = "retry_requested";
            } else if (lifecycle.effects.some((effect) => effect.type === "start_outcome_summary")) {
              newStatus = `audit_${lifecycle.auditStatus ?? "skipped"}`;
              reason = "completion audit triggered";
            }
          } catch (auditError) {
            failed.push({
              taskId: issue.id,
              error: `Failed to apply lifecycle event: ${(auditError as Error).message}`,
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
        let resultStatus = lateRecovery.status;
        let resultReason = lateRecovery.reason;
        if (TERMINAL_RUN_STATUSES.has(lateRecovery.status)) {
          const lifecycle = await applyExecutionLifecycle({
            request,
            namespaceId,
            orgId,
            workspaceId,
            taskId: safeId,
            metadata: updatedMeta,
            runId,
            runStatus: lateRecovery.status,
            reason: lateRecovery.reason,
          });
          if (lifecycle.effects.some((effect) => effect.type === "retry_execution")) {
            resultStatus = "retry_requested";
            resultReason = `execution retry scheduled after late recovery: ${lateRecovery.reason}`;
          } else if (lifecycle.effects.some((effect) => effect.type === "start_outcome_summary")) {
            resultStatus = `audit_${lifecycle.auditStatus ?? "skipped"}`;
            resultReason = "completion audit triggered after late recovery";
          } else {
            resultStatus = "lifecycle_noop";
            resultReason = "late-recovered terminal run already handled";
          }
        }
        writeLog(namespaceId, orgId, "warn", "task-reconciler",
          `task ${issue.id} run ${runId}: ${resultStatus}`, resultReason);
        results.push({
          taskId: issue.id,
          runId,
          previousStatus: String(meta.last_run_status || run.status || "terminal"),
          newStatus: resultStatus,
          reason: resultReason,
        });
        continue;
      }

      if (!run.status || !TERMINAL_RUN_STATUSES.has(run.status)) {
        continue;
      }

      const lifecycle = await applyExecutionLifecycle({
        request,
        namespaceId,
        orgId,
        workspaceId,
        taskId: safeId,
        metadata: meta,
        runId,
        runStatus: run.status,
        reason: `run.json status is ${run.status}`,
      });
      const retried = lifecycle.effects.some((effect) => effect.type === "retry_execution");
      if (retried) {
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

      const startedSummary = lifecycle.effects.some((effect) => effect.type === "start_outcome_summary");
      if (!startedSummary) {
        writeLog(namespaceId, orgId, "warn", "task-reconciler",
          `task ${issue.id} run ${runId}: lifecycle no-op`,
          "terminal run was already handled by lifecycle state");
        results.push({
          taskId: issue.id,
          runId,
          previousStatus: String(meta.last_run_status || "completed"),
          newStatus: "lifecycle_noop",
          reason: "terminal run already handled",
        });
        continue;
      }

      writeLog(namespaceId, orgId, "warn", "task-reconciler",
        `task ${issue.id} run ${runId}: audit ${lifecycle.auditStatus ?? "skipped"}`,
        "completion audit triggered for terminal auto-run task");
      results.push({
        taskId: issue.id,
        runId,
        previousStatus: String(meta.last_run_status || "completed"),
        newStatus: `audit_${lifecycle.auditStatus ?? "skipped"}`,
        reason: "completion audit triggered",
      });
    } catch (error) {
      failed.push({
        taskId: issue.id,
        error: (error as Error).message,
      });
    }
  }

  for (const issue of followupBlockedTasks) {
    const meta = parseMetadata(issue.metadata)!;
    const followUpTaskIds = stringArray(meta.followup_task_ids);
    const allFollowUpsComplete = followUpTaskIds.every((id) => {
      const followUp = issueById.get(id);
      return !!followUp && DONE_TASK_STATUSES.has(followUp.status);
    });
    if (!allFollowUpsComplete) continue;

    try {
      const safeId = validateTaskId(issue.id);
      const state = hydrateLifecycleState(safeId, meta);
      await applyLifecycleEvent({
        state,
        event: { type: "followups.completed", taskId: safeId, followUpTaskIds },
        context: { request, namespaceId, orgId, workspaceId },
        deps: makeLifecycleDeps({
          namespaceId,
          orgId,
          workspaceId,
          taskId: safeId,
          metadata: meta,
          runStatus: undefined,
          reason: "all follow-up tasks are complete",
        }),
      });
      writeLog(namespaceId, orgId, "warn", "task-reconciler",
        `task ${issue.id}: followups completed`,
        "all follow-up tasks are complete");
      results.push({
        taskId: issue.id,
        runId: typeof meta.last_run_id === "string" ? meta.last_run_id : "",
        previousStatus: "followup_blocked",
        newStatus: "followups_completed",
        reason: "all follow-up tasks are complete",
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
    checked: runningTasks.length + terminalAutoRunTasks.length + followupBlockedTasks.length,
    failed: failed.length,
    results,
    errors: failed,
  });
});

async function applyExecutionLifecycle(input: {
  request: NextRequest;
  namespaceId: string;
  orgId: string;
  workspaceId?: string;
  taskId: string;
  metadata: Record<string, unknown>;
  runId: string;
  runStatus: string;
  reason: string;
}): Promise<{ effects: TaskLifecycleEffect[]; auditStatus?: string }> {
  const runFingerprint = currentRunTerminalFingerprint(input.namespaceId, input.orgId, input.runId);
  let auditStatus: string | undefined;
  const transition = await applyLifecycleEvent({
    state: hydrateLifecycleState(input.taskId, input.metadata),
    event:
      input.runStatus === "completed" || input.runStatus === "complete"
        ? { type: "execution.completed", taskId: input.taskId, runId: input.runId, fingerprint: runFingerprint }
        : {
            type: "execution.failed",
            taskId: input.taskId,
            runId: input.runId,
            fingerprint: runFingerprint,
            reason: input.reason,
          },
    context: {
      request: input.request,
      namespaceId: input.namespaceId,
      orgId: input.orgId,
      workspaceId: input.workspaceId,
    },
    deps: makeLifecycleDeps({
      namespaceId: input.namespaceId,
      orgId: input.orgId,
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      metadata: input.metadata,
      runId: input.runId,
      runStatus: input.runStatus,
      reason: input.reason,
      onAuditStatus: (status) => {
        auditStatus = status;
      },
    }),
  });
  return { effects: transition.effects, auditStatus };
}

function makeLifecycleDeps(input: {
  namespaceId: string;
  orgId: string;
  workspaceId?: string;
  taskId: string;
  metadata: Record<string, unknown>;
  runId?: string;
  runStatus?: string;
  reason: string;
  onAuditStatus?: (status: string) => void;
}): LifecycleEffectDeps {
  return {
    startOutcomeSummary: async (summaryInput: StartOutcomeSummaryInput) => {
      const result = await startTaskOutcomeAudit(summaryInput);
      input.onAuditStatus?.(result.status);
      return result;
    },
    createDecisionGate: async () => undefined,
    blockOnDecision: () => undefined,
    createFollowupDependencies: () => undefined,
    resumeOriginalTask: ({ lifecycleState }) => {
      taskUpdate(input.orgId, input.taskId, {
        status: "open",
        metadata: {
          ...metadataWithLifecycleState(input.metadata, lifecycleState),
          last_run_decision_required: false,
          decision_subtask_id: undefined,
          followup_task_ids: [],
        },
      }, input.namespaceId);
    },
    closeTask: () => undefined,
    clearDecisionGate: async () => undefined,
    // Surgical dependents-only nudge: scan ONLY this reconciled task's direct dependents
    // (the ones whose last blocker just cleared), fire-and-forget. Storm-safe -- the
    // terminal rule blocks any completed chain -- and O(dependents), not O(org).
    scanUnblockedAutoRunTasks: () => { void triggerAutoRunScan(input.namespaceId, input.orgId, input.taskId); },
    retryExecution: ({ lifecycleState }) => {
      taskUpdate(input.orgId, input.taskId, {
        status: "open",
        metadata: {
          ...metadataWithLifecycleState(input.metadata, lifecycleState),
          last_run_id: undefined,
          last_run_status: "retry_requested",
          last_run_error: input.reason || `Execution run ended with ${input.runStatus || "failed"}`,
          last_run_decision_required: false,
        },
      }, input.namespaceId);
    },
  };
}

function metadataWithLifecycleState(
  metadata: Record<string, unknown>,
  state: TaskLifecycleState,
): Record<string, unknown> {
  return {
    ...metadata,
    lifecycle_phase: state.phase,
    execution_retries: state.executionRetryCount,
    summarized_run_fingerprints: state.summarizedFingerprints,
    gated_run_fingerprints: state.gatedFingerprints,
    decision_subtask_id: state.decisionTaskId,
    followup_task_ids: state.followUpTaskIds,
  };
}

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

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
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
