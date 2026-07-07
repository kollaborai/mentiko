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
  const activeRun = findActiveRunForTask(task.id, namespaceId);
  if (!activeRun) return { activeRun: null, reconciled: false };

  const metadata = task.metadata && typeof task.metadata === "object" ? task.metadata : {};
  const nextMetadata = {
    ...metadata,
    last_run_id: activeRun.id,
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

export function getAutoRunCandidates(orgId: string, workspaceId?: string, namespaceId?: string): AutoRunCandidate[] {
  const tasks = taskList(orgId, { status: "all" }, workspaceId, namespaceId);
  const candidates: AutoRunCandidate[] = [];

  for (const task of tasks) {
    // epics don't run chains directly -- their subtasks do
    if (task.issue_type === "epic") continue;

    const metadata = task.metadata as Record<string, unknown> | undefined;
    if (!metadata?.auto_run) continue;
    if (metadata.last_run_decision_required === true) continue;
    if (metadata.last_run_status === "completed" || metadata.last_run_status === "complete") continue;

    if (DONE_STATUSES.has(task.status)) continue;

    // Trust live run state over stale task metadata. If a run for this task is
    // currently active, this task is already in flight and must not be retried.
    if (findActiveRunForTask(task.id, namespaceId)) continue;

    if (task.status !== "open") {
      const lastRunStatus = metadata.last_run_status as string | undefined;
      if (task.status !== "in_progress" || !lastRunStatus || !RETRYABLE_RUN_STATUSES.has(lastRunStatus)) {
        continue;
      }
    }

    // stop retrying after MAX_AUTO_RUN_RETRIES failures to prevent infinite loops
    const retries = (metadata.auto_run_retries as number) || 0;
    if (retries >= MAX_AUTO_RUN_RETRIES) continue;

    const ready = isTaskReady(orgId, task.id, namespaceId);
    if (!ready.ready) continue;

    candidates.push({
      taskId: task.id,
      title: task.title,
      chainId: metadata.chain_id as string | undefined,
      chainName: metadata.chain_name as string | undefined,
      priority: typeof task.priority === "number" ? task.priority : 2,
      createdAt: task.created_at,
      ready,
    });
  }

  return candidates.sort(compareCandidates);
}
