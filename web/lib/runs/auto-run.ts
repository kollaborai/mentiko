/**
 * Auto-run utilities.
 * - isTaskReady: checks all dependencies are closed/resolved
 * - getAutoRunCandidates: returns tasks with auto_run=true that are ready
 */

import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { nsPath } from "@/lib/config";
import { allDeclaredAgentsComplete } from "@/lib/runs/run-completion";
import { isNonExecutionRun } from "@/lib/runs/run-provenance";
import { taskGet, taskList, taskUpdate } from "@/lib/tasks/task-store";
import type { TaskRecord } from "@/lib/tasks/task-store-types";
import { executionStartedLifecycleMetadata } from "@/lib/orchestration/task-lifecycle-metadata";

type DependencyStatus = {
  id: string;
  title?: string;
  status: string;
};

export type ReadyCheckResult = {
  ready: boolean;
  deps: DependencyStatus[];
  blockingDeps: DependencyStatus[];
};

const DONE_STATUSES = new Set(["closed", "resolved", "done", "complete"]);
const RETRYABLE_RUN_STATUSES = new Set(["stopped", "failed", "deleted", "unknown", "cancelled"]);
const COMPLETED_RUN_STATUSES = new Set(["completed", "complete"]);
const ACTIVE_RUN_STATUSES = new Set(["running", "pending"]);
const TERMINAL_RUNNER_V2_ATTEMPT_PHASES = new Set(["completion_failed"]);
const NON_EXECUTION_CHAIN_IDS = new Set([
  "run-summary-generation",
  "chain-recommendation",
  "chain-generation",
  "task-generation",
  "decision-research",
]);

export interface ActiveTaskRun {
  id: string;
  status: string;
  chain?: string;
  chainId?: string;
  started?: string;
}

/**
 * Check if a task's dependencies are all closed/resolved.
 * @param orgId - organization ID
 * @param taskId - task ID to check
 * @param namespaceId - namespace for DB isolation
 */
export function isTaskReady(orgId: string, taskId: string, namespaceId?: string): ReadyCheckResult {
  const task = taskGet(orgId, taskId, namespaceId);
  if (!task) {
    return { ready: false, deps: [], blockingDeps: [] };
  }

  const deps = (task.dependencies || []).map((d) => ({
    id: d.id || d.depends_on_id,
    title: d.title,
    status: d.status || "open",
  }));

  const blockingDeps = deps.filter((d) => !DONE_STATUSES.has(d.status));

  return {
    ready: blockingDeps.length === 0,
    deps,
    blockingDeps,
  };
}

interface AutoRunCandidate {
  taskId: string;
  title: string;
  chainId?: string;
  chainName?: string;
  priority: number;
  createdAt?: string;
  ready: ReadyCheckResult;
}

/**
 * Scan all tasks for auto_run=true candidates that are ready to run.
 * A task is a candidate when:
 *   1. status is open (not already closed/running)
 *   2. metadata.auto_run is true
 *   3. all dependencies are closed/resolved
 * @param orgId - organization ID
 * @param workspaceId - optional workspace ID filter
 */
const MAX_AUTO_RUN_RETRIES = 3;

function compareTaskIds(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function compareCandidates(a: AutoRunCandidate, b: AutoRunCandidate): number {
  const createdA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const createdB = b.createdAt ? new Date(b.createdAt).getTime() : 0;

  return (
    a.priority - b.priority ||
    (Number.isNaN(createdA) ? 0 : createdA) - (Number.isNaN(createdB) ? 0 : createdB) ||
    compareTaskIds(a.taskId, b.taskId)
  );
}

function parseTime(value?: string): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function hasTerminalRunnerV2Attempt(run: { runnerV2?: unknown }): boolean {
  const runnerV2 = run.runnerV2;
  if (!runnerV2 || typeof runnerV2 !== "object" || Array.isArray(runnerV2)) return false;
  const attempts = (runnerV2 as { attempts?: unknown }).attempts;
  if (!Array.isArray(attempts)) return false;
  return attempts.some((attempt) => {
    if (!attempt || typeof attempt !== "object" || Array.isArray(attempt)) return false;
    const phase = (attempt as { phase?: unknown }).phase;
    return typeof phase === "string" && TERMINAL_RUNNER_V2_ATTEMPT_PHASES.has(phase);
  });
}

function hasNonExecutionChainId(run: { chain?: unknown; chainId?: unknown }): boolean {
  const chainId = typeof run.chainId === "string" ? run.chainId : "";
  const chain = typeof run.chain === "string" ? run.chain : "";
  return NON_EXECUTION_CHAIN_IDS.has(chainId) || NON_EXECUTION_CHAIN_IDS.has(chain);
}

export function findActiveRunForTask(taskId: string, namespaceId?: string): ActiveTaskRun | null {
  const runsDir = nsPath(namespaceId || "default", "runs");
  if (!existsSync(runsDir)) return null;

  const activeRuns: ActiveTaskRun[] = [];
  for (const dir of readdirSync(runsDir)) {
    if (!dir.startsWith("run-")) continue;
    const runPath = join(runsDir, dir, "run.json");
    if (!existsSync(runPath)) continue;

    try {
      const run = JSON.parse(readFileSync(runPath, "utf-8")) as {
        id?: string;
        taskId?: string;
        status?: string;
        chain?: string;
        chainId?: string;
        started?: string;
        agents?: Array<{ id?: string; status?: string; completed?: string }>;
        metadata?: unknown;
        runnerV2?: unknown;
      };
      if (run.taskId !== taskId) continue;
      if (hasNonExecutionChainId(run)) continue;
      if (isNonExecutionRun(run)) continue;
      if (!run.status || !ACTIVE_RUN_STATUSES.has(run.status)) continue;
      if (hasTerminalRunnerV2Attempt(run)) continue;
      if (allDeclaredAgentsComplete(run, join(runsDir, dir))) continue;
      activeRuns.push({
        id: run.id || dir,
        status: run.status,
        chain: run.chain,
        chainId: run.chainId,
        started: run.started,
      });
    } catch {
      // Ignore corrupt or partially-written run records during reconciliation.
    }
  }

  activeRuns.sort((a, b) => parseTime(b.started) - parseTime(a.started) || b.id.localeCompare(a.id));
  return activeRuns[0] || null;
}

export function reconcileTaskActiveRun(
  orgId: string,
  task: TaskRecord,
  namespaceId?: string
): { activeRun: ActiveTaskRun | null; reconciled: boolean } {
  // Terminal-state is monotonic: a stale/orphaned "running" run.json must NEVER
  // reopen a task the lifecycle already closed. Without this guard a closed task
  // gets flipped back to in_progress, which re-admits it to auto-run -- the
  // duplicate-execution loop. (Admission for live tasks stays with
  // canAdmitAutoRun; this only refuses to resurrect a done task.)
  if (DONE_STATUSES.has(task.status)) {
    return { activeRun: null, reconciled: false };
  }

  const activeRun = findActiveRunForTask(task.id, namespaceId);
  if (!activeRun) return { activeRun: null, reconciled: false };

  const metadata = task.metadata && typeof task.metadata === "object" ? task.metadata : {};
  const nextMetadata = {
    ...executionStartedLifecycleMetadata({
      taskId: task.id,
      metadata: metadata as Record<string, unknown>,
      runId: activeRun.id,
      chainId: activeRun.chainId,
    }),
    last_run_status: activeRun.status,
    last_run_chain: activeRun.chain || metadata.last_run_chain,
    last_run_started: activeRun.started || metadata.last_run_started,
    last_run_completed: null,
  };

  const needsStatusUpdate = task.status !== "in_progress";
  const needsMetadataUpdate =
    metadata.last_run_id !== activeRun.id ||
    metadata.last_run_status !== activeRun.status ||
    metadata.last_run_chain !== nextMetadata.last_run_chain ||
    metadata.last_run_started !== nextMetadata.last_run_started ||
    metadata.last_run_completed !== null;

  if (needsStatusUpdate || needsMetadataUpdate) {
    taskUpdate(orgId, task.id, {
      ...(needsStatusUpdate ? { status: "in_progress" } : {}),
      metadata: nextMetadata,
    }, namespaceId);
    return { activeRun, reconciled: true };
  }

  return { activeRun, reconciled: false };
}

export function reconcileActiveAutoRunTasks(orgId: string, namespaceId?: string): number {
  const tasks = taskList(orgId, { status: "all" }, undefined, namespaceId);
  let reconciled = 0;

  for (const task of tasks) {
    if (task.issue_type === "epic") continue;
    if (DONE_STATUSES.has(task.status)) continue;
    const metadata = task.metadata as Record<string, unknown> | undefined;
    if (!metadata?.auto_run) continue;
    if (reconcileTaskActiveRun(orgId, task, namespaceId).reconciled) {
      reconciled += 1;
    }
  }

  return reconciled;
}

export type AutoRunRejectReason =
  | "epic"
  | "auto_run_disabled"
  | "paused"
  | "decision_required"
  | "already_completed"
  | "active_run_exists"
  | "not_runnable"
  | "max_retries"
  | "deps_not_ready";

export interface AutoRunAdmission {
  /** Whether the task may auto-run right now. */
  admit: boolean;
  /** Human-readable explanation (also surfaced in API responses). */
  reason: string;
  /** Stable code mirroring triggerAutoRun's action strings (set on rejection). */
  action?: AutoRunRejectReason;
  /** Dependency readiness, populated when admitted (avoids a second lookup). */
  ready?: ReadyCheckResult;
}

/**
 * Single source of truth for "may this task auto-run right now?".
 *
 * Both the candidate scan (getAutoRunCandidates, used by the 60s poller) and the
 * per-task admission machine (triggerAutoRun) MUST funnel through this so the two
 * can never drift -- that drift is what let stale generation metadata re-launch a
 * completed chain.
 *
 * Invariant enforced here: once a task has a real execution chain_id and
 * last_run_status is completed, stale recommendation/generation job metadata must
 * NOT start another execution. Generation state may only advance PRE-execution
 * (a generation_job_id with no chain_id yet).
 *
 * This is a PER-TASK predicate only: global policy (the auto_run_enabled namespace
 * setting) and workspace policy (resolveAutoRun) are enforced by callers, NOT here
 * -- folding those in would mean a settings read per task on every scan.
 */
export function canAdmitAutoRun(
  task: TaskRecord,
  orgId: string,
  namespaceId?: string,
): AutoRunAdmission {
  // epics don't run chains directly -- their subtasks do
  if (task.issue_type === "epic") {
    return { admit: false, reason: "epics do not run chains directly", action: "not_runnable" };
  }

  const metadata = (task.metadata && typeof task.metadata === "object" && !Array.isArray(task.metadata)
    ? task.metadata
    : {}) as Record<string, unknown>;

  if (!metadata.auto_run) {
    return { admit: false, reason: "auto-run is disabled for this task", action: "auto_run_disabled" };
  }
  const pauseReason = typeof metadata.auto_run_paused_reason === "string" ? metadata.auto_run_paused_reason.trim() : "";
  if (metadata.auto_run_paused === true || pauseReason.length > 0) {
    return { admit: false, reason: "auto-run is paused for this task", action: "paused" };
  }
  if (metadata.last_run_decision_required === true) {
    return { admit: false, reason: "last run requires review", action: "decision_required" };
  }

  const chainId = typeof metadata.chain_id === "string" ? metadata.chain_id : undefined;
  const lastRunStatus = typeof metadata.last_run_status === "string" ? metadata.last_run_status : undefined;
  // Terminal ONLY for the current assigned chain's execution. A completed status
  // with no chain_id assigned is recommendation/generation bookkeeping -- allow it
  // to continue toward execution. A stale generation_job_id can NOT reopen a
  // completed execution here, because that state has chain_id set.
  //
  // Presence check (!== undefined), NOT truthiness: chain_id:"" (which
  // task-transforms' String(metadata.chain_id || "") can produce) is falsy but
  // IS a present chain_id key -- a completed status only ever gets set after a
  // real execution ran, and an execution always runs via a real chain_id, so
  // chain_id:"" here means corrupted/lost bookkeeping from a real execution,
  // not "no chain was ever assigned". Genuine no-chain state has the key
  // absent entirely (chainId undefined either way), so that case is unchanged.
  if (lastRunStatus && COMPLETED_RUN_STATUSES.has(lastRunStatus) && chainId !== undefined) {
    return { admit: false, reason: "last execution run already completed", action: "already_completed" };
  }

  if (DONE_STATUSES.has(task.status)) {
    return { admit: false, reason: "task is already done", action: "already_completed" };
  }

  // Trust live run state over stale task metadata: an in-flight run means the
  // task is already executing and must not be retried.
  if (findActiveRunForTask(task.id, namespaceId)) {
    return { admit: false, reason: "a run for this task is already active", action: "active_run_exists" };
  }

  if (task.status !== "open") {
    if (task.status !== "in_progress" || !lastRunStatus || !RETRYABLE_RUN_STATUSES.has(lastRunStatus)) {
      return { admit: false, reason: `task status '${task.status}' is not runnable`, action: "not_runnable" };
    }
  }

  // stop retrying after MAX_AUTO_RUN_RETRIES failures to prevent infinite loops
  const retries = (metadata.auto_run_retries as number) || 0;
  if (retries >= MAX_AUTO_RUN_RETRIES) {
    return { admit: false, reason: "max auto-run retries reached", action: "max_retries" };
  }

  const ready = isTaskReady(orgId, task.id, namespaceId);
  if (!ready.ready) {
    return { admit: false, reason: "dependencies are not ready", action: "deps_not_ready", ready };
  }

  return { admit: true, reason: "ready", ready };
}

export function getAutoRunCandidates(orgId: string, workspaceId?: string, namespaceId?: string): AutoRunCandidate[] {
  const tasks = taskList(orgId, { status: "all" }, workspaceId, namespaceId);
  const candidates: AutoRunCandidate[] = [];

  for (const task of tasks) {
    const admission = canAdmitAutoRun(task, orgId, namespaceId);
    if (!admission.admit || !admission.ready) continue;

    const metadata = (task.metadata as Record<string, unknown> | undefined) || {};
    candidates.push({
      taskId: task.id,
      title: task.title,
      chainId: metadata.chain_id as string | undefined,
      chainName: metadata.chain_name as string | undefined,
      priority: typeof task.priority === "number" ? task.priority : 2,
      createdAt: task.created_at,
      ready: admission.ready,
    });
  }

  return candidates.sort(compareCandidates);
}
