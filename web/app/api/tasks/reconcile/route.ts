import { NextRequest } from "next/server";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { randomUUID } from "node:crypto";
import { join } from "path";
import { checkAuth } from "@/lib/auth/api-auth";
import { taskGet, taskList, taskUpdate } from "@/lib/tasks/task-store";
import { validateTaskId } from "@/lib/tasks/task-store";
import { applyCompletionAudit, supersedeStaleCompletionAuditDecision } from "@/lib/tasks/completion-audit-apply";
import { hasDurableAuditedClose } from "@/lib/runs/auto-run";
import { resolveTaskAutoRunDefault } from "@/lib/tasks/task-auto-run-default";
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
import {
  acknowledgeLateCompletionDelivery,
  claimLateCompletionDelivery,
  recoverLateCompletionEvents,
  releaseLateCompletionDelivery,
  type LateCompletionRecovery,
} from "@/lib/runner-v2/completion-recovery";
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
import { currentRunTerminalFingerprint, outcomeSummarySourceEligibility } from "@/lib/tasks/run-outcome-evidence";
import { hasLivePendingHandoff } from "@/lib/runner-v2/handoff-liveness";

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
function shouldAuditCompletedAutoRun(meta: Record<string, unknown>, autoRunEnabled: boolean): boolean {
  const generatedTaskHasExecutionChain =
    !meta.generation_job_id ||
    typeof meta.chain_id === "string" ||
    typeof meta.chain_name === "string" ||
    typeof meta.last_run_chain === "string";

  return (
    autoRunEnabled &&
    !!meta.last_run_id &&
    generatedTaskHasExecutionChain
  );
}

// Audit eligibility must use the SAME auto-run resolution as admission
// (explicit meta.auto_run, else the workspace default): a workspace-default
// task carries no explicit flag, so gating on meta.auto_run===true let it
// execute its chain but never close (ISSUE-006). The workspace default is
// fs-backed, so cache it per workspace path for the scan.
function makeAutoRunEnabledResolver(namespaceId: string, orgId: string) {
  const wsDefaultCache = new Map<string, boolean>();
  return (issue: { workspace_id?: string | null }, meta: Record<string, unknown>): boolean => {
    if (typeof meta.auto_run === "boolean") return meta.auto_run;
    const wsPath = typeof issue.workspace_id === "string" ? issue.workspace_id : "";
    if (!wsPath) return false;
    let enabled = wsDefaultCache.get(wsPath);
    if (enabled === undefined) {
      enabled = resolveTaskAutoRunDefault({ namespaceId, orgId, workspacePath: wsPath });
      wsDefaultCache.set(wsPath, enabled);
    }
    return enabled;
  };
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
  const autoRunEnabledFor = makeAutoRunEnabledResolver(namespaceId, orgId);

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
      shouldAuditCompletedAutoRun(meta, autoRunEnabledFor(issue, meta))
    );
  });
  const issueById = new Map(issues.map((issue) => [issue.id, issue]));
  const followupBlockedTasks = issues.filter((issue) => {
    if (DONE_TASK_STATUSES.has(issue.status)) return false;
    const meta = parseMetadata(issue.metadata);
    return meta?.lifecycle_phase === "followup_blocked" && stringArray(meta.followup_task_ids).length > 0;
  });
  // Reopened after an audited close, with the last_run_* evidence wiped: the
  // terminal filter above needs last_run_status, which the non-execution-run
  // repair deletes (the reopen-clobbers-close race, ISSUE-007). The durable
  // completion_audit_* evidence survives the wipe, so re-apply the close here
  // -- applyCompletionAudit's closeVerdictNotYetClosed path re-closes, restores
  // the execution metadata, and fires the dependents-only nudge. Tasks the
  // running/terminal sweeps CAN process are excluded: a fresh terminal run
  // deserves its own audit verdict, not a re-close on stale evidence.
  const activeSweepTaskIds = new Set(
    [...runningTasks, ...terminalAutoRunTasks].map((issue) => issue.id),
  );
  const reopenedAuditedCloseTasks = issues.filter((issue) => {
    if (DONE_TASK_STATUSES.has(issue.status)) return false;
    if (activeSweepTaskIds.has(issue.id)) return false;
    const meta = parseMetadata(issue.metadata);
    return (
      !!meta &&
      hasDurableAuditedClose(meta) &&
      typeof meta.completion_audit_run_id === "string"
    );
  });

  const staleCompletionAuditDecisions = issues.filter((issue) => {
    if (issue.issue_type !== "decision" || DONE_TASK_STATUSES.has(issue.status)) return false;
    const decisionMeta = parseMetadata(issue.metadata);
    if (decisionMeta?.decision_source !== "completion-audit" || !issue.parent_id) return false;
    const parent = issueById.get(issue.parent_id);
    if (!parent || DONE_TASK_STATUSES.has(parent.status)) return false;
    const parentMeta = parseMetadata(parent.metadata) || {};
    const sourceRunId = typeof decisionMeta.completion_audit_source_run_id === "string"
      ? decisionMeta.completion_audit_source_run_id
      : "";
    const sourceFingerprint = typeof decisionMeta.completion_audit_run_fingerprint === "string"
      ? decisionMeta.completion_audit_run_fingerprint
      : undefined;
    const conflictsWithRetry = ["retrying", "executing", "resuming"].includes(String(parentMeta.lifecycle_phase))
      && parentMeta.last_run_decision_required !== true;
    return conflictsWithRetry || !sourceRunId || !outcomeSummarySourceEligibility(
      namespaceId,
      orgId,
      sourceRunId,
      sourceFingerprint,
    ).eligible;
  });

  for (const decisionTask of staleCompletionAuditDecisions) {
    const parentTask = decisionTask.parent_id ? issueById.get(decisionTask.parent_id) : undefined;
    if (!parentTask) continue;
    try {
      await supersedeStaleCompletionAuditDecision({
        namespaceId,
        orgId,
        parentTask,
        decisionTask,
        reason: "Superseded because the completion audit source is no longer the current terminal execution state.",
        workspacePath: parentTask.workspace_id || undefined,
      });
      results.push({
        taskId: parentTask.id,
        runId: String((parseMetadata(decisionTask.metadata) || {}).completion_audit_source_run_id || "unknown"),
        previousStatus: "decision_blocked",
        newStatus: "stale_decision_superseded",
        reason: `removed stale decision gate ${decisionTask.id}`,
      });
    } catch (error) {
      failed.push({ taskId: parentTask.id, error: (error as Error).message });
    }
  }

  if (
    runningTasks.length === 0 &&
    terminalAutoRunTasks.length === 0 &&
    followupBlockedTasks.length === 0 &&
    reopenedAuditedCloseTasks.length === 0
  ) {
    return apiSuccess({ reconciled: results.length, results, failed: failed.length, errors: failed });
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
          const handoffAlive = hasLivePendingHandoff(run);

          if (!newStatus && !anyAlive && !handoffAlive) {
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
                // Persist the exact terminal state before lifecycle reduction.
                // Fingerprints must never observe this logically stopped run as
                // `running:no-terminal-time` and consume retry/audit twice.
                run.status = "stopped";
                run.completed = run.completed || new Date().toISOString();
                writeFileSync(runJsonPath, JSON.stringify(run, null, 2));
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

        const autoRun = autoRunEnabledFor(issue, meta);
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

  for (const issue of reopenedAuditedCloseTasks) {
    const meta = parseMetadata(issue.metadata)!;
    const runId = meta.completion_audit_run_id as string;
    try {
      const safeId = validateTaskId(issue.id);
      const outcome = await applyCompletionAudit({
        request,
        namespaceId,
        orgId,
        task: issue,
        audit: {
          verdict: "close",
          reason: "Re-applied audited close verdict after a reopen wiped the run evidence (task-reconciler).",
        },
        runId,
        runFingerprint: typeof meta.completion_audit_run_fingerprint === "string"
          ? meta.completion_audit_run_fingerprint
          : undefined,
        workspacePath: typeof issue.workspace_id === "string" ? issue.workspace_id : undefined,
        metadata: meta,
      });
      writeLog(namespaceId, orgId, "warn", "task-reconciler",
        `task ${safeId} run ${runId}: reclose_${outcome.action}`,
        "re-applied durable audited close after reopen");
      results.push({
        taskId: issue.id,
        runId,
        previousStatus: issue.status,
        newStatus: `reclose_${outcome.action}`,
        reason: "audited close re-applied after reopen wiped run evidence",
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
    checked: runningTasks.length + terminalAutoRunTasks.length + followupBlockedTasks.length
      + reopenedAuditedCloseTasks.length,
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
  // Reconcile requests can overlap. Re-read the durable task claim immediately
  // before reducing so a stale request cannot consume the same terminal run a
  // second time after another request already cleared last_run_id for retry.
  const currentTask = taskGet(input.orgId, input.taskId, input.namespaceId);
  const currentMetadata = parseMetadata(currentTask?.metadata) ?? input.metadata;
  if (currentMetadata.last_run_id !== input.runId) {
    return { effects: [] };
  }
  const runFingerprint = currentRunTerminalFingerprint(input.namespaceId, input.orgId, input.runId);
  let auditStatus: string | undefined;
  const transition = await applyLifecycleEvent({
    state: hydrateLifecycleState(input.taskId, currentMetadata),
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
      metadata: currentMetadata,
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

  const events = readEvents(config.eventsDir);
  const recovery = recoverLateCompletionEvents({
    runJsonPath: input.runJsonPath,
    runId: input.runId,
    chain,
    events,
  });
  if (recovery.deliveries.length === 0) return { recovered: false };

  for (const item of recovery.deliveries) {
    const latestRun = readRunForDelivery(input.runJsonPath, recovery.run);
    if (deliveryTargetsAlreadyStarted(item, latestRun)) {
      acknowledgeLateCompletionDelivery({
        runJsonPath: input.runJsonPath,
        deliveryId: item.deliveryId,
        evidence: "downstream-state",
      });
      continue;
    }

    const claimId = `reconcile:${process.pid}:${randomUUID()}`;
    if (!claimLateCompletionDelivery({
      runJsonPath: input.runJsonPath,
      deliveryId: item.deliveryId,
      claimId,
    })) continue;

    let planApplied = false;
    try {
      // Building is intentionally inside the claimed try/catch. A crash or
      // exception after event consumption but before adapter application leaves
      // the durable delivery retryable instead of stranded in `applying`.
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
          workspacePath: typeof recovery.run.workspacePath === "string" ? recovery.run.workspacePath : undefined,
          taskId: typeof recovery.run.taskId === "string" ? recovery.run.taskId : undefined,
          runDir: input.runDir,
          fanGroupId: `late-recovery-${item.deliveryId}`,
          env: {
            MENTIKO_RUN_ID: input.runId,
            RUN_ID: input.runId,
            NAMESPACE_ID: input.namespaceId,
            ORG_ID: input.orgId,
            MENTIKO_RUNNER_V2: "1",
            MENTIKO_RUNNER_V2_COMPLETION: "1",
            MENTIKO_RUNNER_V2_DELIVERY_ID: item.deliveryId,
          },
        },
        terminal: {
          runId: input.runId,
          chainId: typeof input.run.chainId === "string" ? input.run.chainId : chain.id,
          chainName: chain.name || chain.id || "unknown",
          chainPath,
          taskId: typeof recovery.run.taskId === "string" ? recovery.run.taskId : undefined,
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
      planApplied = true;
      if (!acknowledgeLateCompletionDelivery({
        runJsonPath: input.runJsonPath,
        deliveryId: item.deliveryId,
        claimId,
        evidence: "plan-applied",
      })) {
        throw new Error(`late completion delivery acknowledgement failed: ${item.deliveryId}`);
      }
    } catch (error) {
      // A failed plan can be safely retried. Once application returned, keep the
      // claim: releasing it would allow a duplicate launch if only the durable
      // acknowledgement failed. The next reconcile uses downstream run state to
      // converge that claim to applied without launching again.
      if (!planApplied) {
        releaseLateCompletionDelivery({
          runJsonPath: input.runJsonPath,
          deliveryId: item.deliveryId,
          claimId,
        });
      }
      throw error;
    }
  }

  return {
    recovered: true,
    status: recovery.run.status,
    reason: `late completion event recovered for ${recovery.deliveries.map((item) => item.agentId).join(", ")}`,
  };
}

function readRunForDelivery(runJsonPath: string, fallback: Record<string, unknown>): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(runJsonPath, "utf8")) as Record<string, unknown>;
  } catch {
    return fallback;
  }
}

function deliveryTargetsAlreadyStarted(
  delivery: LateCompletionRecovery,
  run: Record<string, unknown>,
): boolean {
  if (delivery.route.action !== "launch") return false;
  const agents = Array.isArray(run.agents)
    ? run.agents.filter((agent): agent is Record<string, unknown> => Boolean(agent) && typeof agent === "object")
    : [];
  return delivery.route.agentIds.every((agentId) => {
    const agent = agents.find((candidate) => candidate.id === agentId);
    return Boolean(
      agent
      && (
        agent.status === "running"
        || agent.status === "complete"
        || agent.status === "completed"
        || typeof agent.session === "string"
      )
    );
  });
}

function readRoutingChain(chainPath: string): RoutingChain | undefined {
  try {
    const chain = JSON.parse(readFileSync(chainPath, "utf-8")) as RoutingChain;
    return Array.isArray(chain.agents) ? chain : undefined;
  } catch {
    return undefined;
  }
}

function readEvents(eventsDir: string): RunnerEventRecord[] {
  const events: RunnerEventRecord[] = [];
  if (!existsSync(eventsDir)) return events;
  let files: string[] = [];
  try {
    files = readdirSync(eventsDir);
  } catch {
    return events;
  }
  for (const file of files) {
    if (!file.endsWith(".event")) continue;
    const path = join(eventsDir, file);
    try {
      events.push({ ...parseRunnerEvent(readFileSync(path, "utf-8")), path });
    } catch {
      // Invalid raw event files cannot participate in reconciliation.
    }
  }
  return events;
}
