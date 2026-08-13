// Server-side operational read model for the Operations Timeline.
//
// Composes truth that Mentiko already persists — the sqlite task store, the
// runs directory, the monitor status digest, decisions, and task lifecycle
// metadata — into one typed view. It creates no new stores and no new event
// ledger; every field names the persisted source it came from.
//
// Read amplification is bounded and NEVER per-task:
//   - one taskList + one taskGetAllDeps (two sqlite queries)
//   - one buildRunsSnapshot walk (the same authoritative index auto-run uses)
//   - one bounded timeline scan over the newest run dirs (parsed once each)
//   - buildMonitorStatusDigest (its own internal capped scan) for health
//   - one artifacts listing per surfaced accomplishment (capped at 8)
//
// Dependency truth is org-wide even when a workspace filter is applied: a
// blocker living in another workspace still blocks. Only the *view* sections
// are workspace-scoped.

import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { nsPath } from "@/lib/config";
import {
  buildRunsSnapshot,
  canAdmitAutoRun,
  hasDurableAuditedClose,
  type RunsSnapshot,
} from "@/lib/runs/auto-run";
import { taskGetAllDeps, taskList } from "@/lib/tasks/task-store";
import { isTerminalTaskStatus } from "@/lib/tasks/task-status";
import { resolveAutoRunState, MAX_AUTO_RUN_RETRIES } from "@/lib/tasks/auto-run-state";
import { resolveTaskAutoRunDefault } from "@/lib/tasks/task-auto-run-default";
import { hasExecutionRetriesRemaining } from "@/lib/tasks/execution-retry-policy";
import { currentRunArtifacts, metadataRecord } from "@/lib/tasks/run-outcome-evidence";
import { buildMonitorStatusDigest, type MonitorStatusDigest } from "@/lib/monitor/status-digest";
import { getBackgroundWorkerStatus } from "@/lib/system/background-worker-control";
import { resolveMaxConcurrentChains } from "@/lib/system/system-settings";
import { listDecisions } from "@/lib/decisions/decision-storage";
import type { Decision } from "@/lib/decisions/decision-types";
import { createNotification } from "@/lib/notifications/notification-server";
import {
  ATTENTION_REASONS,
  WAITING_REASONS,
  buildOperationsNotifications,
  classifyTaskOperation,
  computeDownstreamImpact,
  computeOverall,
  detectDependencyCycles,
  isTaskMetadataErrored,
  shortestCausalPath,
  type DepEdgeInput,
  type LiveSystemRunInput,
  type OperationsOverall,
  type TaskOpReason,
} from "./operations-classify";

const TIMELINE_RUN_SCAN_CAP = 150;
const TIMELINE_ITEM_CAP = 250;
const ACCOMPLISHMENT_CAP = 8;
const STALE_LOOP_MS = 5 * 60 * 1000;
const DETAIL_MAX_CHARS = 240;

// ---------- response contract ----------

export interface OpsLoopState {
  status: "running" | "stopped";
  lastCheck?: string;
  stale: boolean;
  lastError?: string;
}

export interface OpsSystemState {
  worker: OpsLoopState & { startedAt?: string; pid?: number };
  autoRun: OpsLoopState & { lastTriggered?: number };
  watchdog: OpsLoopState;
  decisionReconciler: OpsLoopState;
  chainWatcher: OpsLoopState;
  health: MonitorStatusDigest["health"];
  mode: string;
  recentErrors: MonitorStatusDigest["errorsRecent"];
  recentRecoveries: MonitorStatusDigest["autoFixes"];
  headline: string;
}

export type OpsSeverity = "info" | "warn" | "critical";

export interface OpsAttentionItem {
  severity: OpsSeverity;
  reason: string;
  message: string;
  detail?: string;
  source: string;
  taskId?: string;
  runId?: string;
  decisionId?: string;
  blockedDownstreamTaskIds: string[];
  actionUrl?: string;
  updatedAt?: string;
}

export interface OpsTaskState {
  taskId: string;
  title: string;
  issueType: string;
  status: string;
  reason: TaskOpReason;
  detail: string;
  source: string;
  priority: number;
  workspaceId: string | null;
  updatedAt: string;
  autoRun: { enabled: boolean; source: string; retries: number; maxRetries: number; paused: boolean };
  runId?: string;
  chainId?: string;
  chainName?: string;
  decisionId?: string;
  blockingTaskIds: string[];
  blockedDownstreamTaskIds: string[];
  directBlockedTaskIds: string[];
  /** Shortest upstream path from a root blocker to this task's direct blocker. */
  causalPath: string[];
  /** More than one independent unfinished blocker exists. */
  hasIndependentBlockers: boolean;
  actionUrl: string;
}

export interface OpsRunningItem {
  runId: string;
  chainId?: string;
  chainName?: string;
  status: string;
  started?: string;
  taskId?: string;
  taskTitle?: string;
  goal?: string;
  agentsTotal: number;
  agentsActive: number;
  agentsComplete: number;
  /** Non-execution system work (recommendation / generation / audit / decision). */
  kind: "execution" | "recommendation" | "generation" | "audit" | "task_generation" | "decision";
  actionUrl: string;
}

export interface OpsUpNextItem {
  position: number;
  taskId: string;
  title: string;
  reason: TaskOpReason;
  detail: string;
  chainId?: string;
  chainName?: string;
  priority: number;
  blockingTaskIds: string[];
  actionUrl: string;
}

export interface OpsAccomplishment {
  taskId: string;
  title: string;
  headline?: string;
  narrative?: string;
  outcome?: string;
  whatHappened: string[];
  evidence: string[];
  improvementSignals: string[];
  nextActions: string[];
  auditVerdict?: string;
  sourceRunId?: string;
  closedAt?: string;
  artifacts: Array<{ name: string; path: string }>;
  artifactCount: number;
  /** Open downstream tasks this completion made admissible — from the dep store, never the model. */
  unlockedTaskIds: string[];
  actionUrl: string;
}

export type OpsTimelineKind =
  | "task_created"
  | "task_closed"
  | "run_started"
  | "run_completed"
  | "run_failed"
  | "run_reaped"
  | "audit_completed"
  | "decision_created"
  | "decision_resolved"
  | "system_error"
  | "system_recovery";

export interface OpsTimelineItem {
  at: string;
  kind: OpsTimelineKind;
  severity: OpsSeverity;
  title: string;
  detail?: string;
  source: string;
  taskId?: string;
  runId?: string;
  chainId?: string;
  decisionId?: string;
  actionUrl?: string;
}

export interface OpsHumanGate {
  kind: "decision" | "run_review";
  taskId?: string;
  decisionId?: string;
  runId?: string;
  title: string;
  detail: string;
  status?: string;
  updatedAt?: string;
  actionUrl: string;
}

export interface OperationsView {
  generatedAt: string;
  overall: OperationsOverall;
  overallDetail: string;
  system: OpsSystemState;
  attention: OpsAttentionItem[];
  runningNow: OpsRunningItem[];
  upNext: OpsUpNextItem[];
  waiting: OpsTaskState[];
  humanGates: OpsHumanGate[];
  recentAccomplishments: OpsAccomplishment[];
  timeline: OpsTimelineItem[];
  taskStates: OpsTaskState[];
  dependencyCycleTaskIds: string[];
  counts: {
    tasksOpen: number;
    tasksInProgress: number;
    tasksClosed: number;
    runsActive: number;
    maxConcurrentRuns: number;
    availableSlots: number;
    attention: number;
    ready: number;
    waiting: number;
    humanGates: number;
  };
}

// ---------- helpers ----------

function clampDetail(detail: string): string {
  const flattened = detail.replace(/\s+/g, " ").trim();
  return flattened.length > DETAIL_MAX_CHARS
    ? `${flattened.slice(0, DETAIL_MAX_CHARS)}… [truncated]`
    : flattened;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function strArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

const SYSTEM_CHAIN_KINDS: Record<string, LiveSystemRunInput["kind"]> = {
  "chain-recommendation": "recommendation",
  "chain-generation": "generation",
  "run-summary-generation": "audit",
  "task-generation": "task_generation",
  "decision-research": "decision",
};

function runKind(chainId?: string, chain?: string): OpsRunningItem["kind"] {
  return SYSTEM_CHAIN_KINDS[chainId ?? ""] ?? SYSTEM_CHAIN_KINDS[chain ?? ""] ?? "execution";
}

function loopState(
  loop: { status?: string; lastCheck?: string | null; lastError?: string | null } | undefined,
  now: number,
  workerRunning: boolean,
): OpsLoopState {
  const status = loop?.status === "running" && workerRunning ? "running" : "stopped";
  const lastCheck = typeof loop?.lastCheck === "string" ? loop.lastCheck : undefined;
  const checkAge = lastCheck ? now - Date.parse(lastCheck) : Number.POSITIVE_INFINITY;
  return {
    status,
    ...(lastCheck ? { lastCheck } : {}),
    stale: status === "running" && !(checkAge <= STALE_LOOP_MS),
    ...(loop?.lastError ? { lastError: clampDetail(String(loop.lastError)) } : {}),
  };
}

/** Dispatch-order comparator — mirrors auto-run's compareCandidates (priority, createdAt, id). */
function compareDispatchOrder(
  a: { priority: number; createdAt?: string; taskId: string },
  b: { priority: number; createdAt?: string; taskId: string },
): number {
  const createdA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const createdB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
  return (
    a.priority - b.priority
    || (Number.isNaN(createdA) ? 0 : createdA) - (Number.isNaN(createdB) ? 0 : createdB)
    || a.taskId.localeCompare(b.taskId, undefined, { numeric: true, sensitivity: "base" })
  );
}

interface TimelineRunRecordLite {
  id: string;
  chain?: string;
  chainId?: string;
  status?: string;
  started?: string;
  completed?: string;
  status_message?: string;
  taskId?: string;
  goal?: string;
  workspacePath?: string;
  agents?: Array<{ status?: string }>;
}

/**
 * One bounded pass over the newest run directories for timeline events.
 * Sorted by directory name descending (run ids embed their timestamp), capped,
 * each run.json parsed once. Corrupt records are surfaced diagnostically
 * instead of crashing the view.
 */
export function scanRunsForTimeline(namespaceId: string): {
  runs: TimelineRunRecordLite[];
  corrupt: string[];
} {
  const runsDir = nsPath(namespaceId, "runs");
  const runs: TimelineRunRecordLite[] = [];
  const corrupt: string[] = [];
  if (!existsSync(runsDir)) return { runs, corrupt };

  let names: string[];
  try {
    names = readdirSync(runsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("run-"))
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a));
  } catch {
    return { runs, corrupt };
  }

  for (const name of names.slice(0, TIMELINE_RUN_SCAN_CAP)) {
    const runPath = join(runsDir, name, "run.json");
    if (!existsSync(runPath)) continue;
    try {
      const parsed = JSON.parse(readFileSync(runPath, "utf-8")) as TimelineRunRecordLite;
      runs.push({ ...parsed, id: parsed.id || name });
    } catch {
      corrupt.push(name);
    }
  }
  return { runs, corrupt };
}

// ---------- injectable sources (tests count calls to prove no N+1) ----------

export interface OperationsSources {
  listTasks: typeof taskList;
  listDeps: typeof taskGetAllDeps;
  buildSnapshot: typeof buildRunsSnapshot;
  buildDigest: typeof buildMonitorStatusDigest;
  workerStatus: typeof getBackgroundWorkerStatus;
  maxConcurrent: typeof resolveMaxConcurrentChains;
  decisions: typeof listDecisions;
  scanRuns: typeof scanRunsForTimeline;
  workspaceAutoRunDefault: (namespaceId: string, orgId: string, workspacePath: string) => boolean;
  runArtifacts: typeof currentRunArtifacts;
  now: () => number;
}

const defaultSources: OperationsSources = {
  listTasks: taskList,
  listDeps: taskGetAllDeps,
  buildSnapshot: buildRunsSnapshot,
  buildDigest: buildMonitorStatusDigest,
  workerStatus: getBackgroundWorkerStatus,
  maxConcurrent: resolveMaxConcurrentChains,
  decisions: listDecisions,
  scanRuns: scanRunsForTimeline,
  workspaceAutoRunDefault: (namespaceId, orgId, workspacePath) =>
    resolveTaskAutoRunDefault({ namespaceId, orgId, workspacePath }),
  runArtifacts: currentRunArtifacts,
  now: () => Date.now(),
};

// ---------- the read model ----------

export async function buildOperationsView(
  namespaceId: string,
  orgId: string,
  workspaceId?: string,
  sources: OperationsSources = defaultSources,
): Promise<OperationsView> {
  const now = sources.now();
  const generatedAt = new Date(now).toISOString();

  // Org-wide task set: dependency truth must see blockers outside the selected
  // workspace. Workspace scoping is applied to the view sections below.
  const tasks = sources.listTasks(orgId, { status: "all" }, undefined, namespaceId);
  const allEdges: DepEdgeInput[] = sources.listDeps(orgId, namespaceId);
  const snapshot: RunsSnapshot = sources.buildSnapshot(namespaceId);
  const digest = await sources.buildDigest(namespaceId, orgId, workspaceId);
  const worker = sources.workerStatus();
  const maxConcurrent = sources.maxConcurrent(namespaceId);
  const timelineScan = sources.scanRuns(namespaceId);

  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const isOpenTask = (id: string) => {
    const task = taskById.get(id);
    return !!task && !isTerminalTaskStatus(task.status);
  };
  const inWorkspace = (taskWorkspaceId: string | null) =>
    !workspaceId || taskWorkspaceId === workspaceId;

  // Live non-execution runs per task (recommendation / generation / audit).
  const liveSystemRunByTask = new Map<string, LiveSystemRunInput>();
  for (const record of snapshot.activeRuns) {
    if (!record.taskId || record.admissionRelevant) continue;
    const kind = SYSTEM_CHAIN_KINDS[record.active.chainId ?? ""]
      ?? SYSTEM_CHAIN_KINDS[record.active.chain ?? ""];
    if (!kind) continue;
    liveSystemRunByTask.set(record.taskId, { kind, runId: record.active.id });
  }

  // Errored-blocker lookup for blocked_failed_dependency. Retries accumulate
  // only while auto-run is active, so a raw >= cap check is truthful here.
  const erroredByTaskId = new Map<string, boolean>();
  for (const task of tasks) {
    const metadata = metadataRecord(task.metadata);
    const retries = typeof metadata.auto_run_retries === "number" ? metadata.auto_run_retries : 0;
    erroredByTaskId.set(task.id, isTaskMetadataErrored(metadata, retries >= MAX_AUTO_RUN_RETRIES));
  }

  // Unfinished blocking deps per task, derived once from the org-wide edge list
  // (taskList does not hydrate per-task dependency rows; no per-task queries).
  const blockersByTask = new Map<string, string[]>();
  for (const edge of allEdges) {
    if (edge.type && edge.type !== "blocks") continue;
    const list = blockersByTask.get(edge.task_id);
    if (list) list.push(edge.depends_on_id);
    else blockersByTask.set(edge.task_id, [edge.depends_on_id]);
  }

  // ---- classify every task (canAdmitAutoRun is the single admission contract) ----
  const wsDefaultCache = new Map<string, boolean>();
  const states: OpsTaskState[] = [];
  for (const task of tasks) {
    const metadata = metadataRecord(task.metadata);
    const wsPath = typeof task.workspace_id === "string" ? task.workspace_id : "";
    let wsDefault = wsPath ? wsDefaultCache.get(wsPath) : false;
    if (wsPath && wsDefault === undefined) {
      wsDefault = sources.workspaceAutoRunDefault(namespaceId, orgId, wsPath);
      wsDefaultCache.set(wsPath, wsDefault);
    }
    const admission = canAdmitAutoRun(task, orgId, namespaceId, wsDefault ?? false, snapshot);
    const autoRun = resolveAutoRunState({
      explicitAutoRun: typeof metadata.auto_run === "boolean" ? metadata.auto_run : undefined,
      workspaceDefault: wsDefault ?? false,
      retries: typeof metadata.auto_run_retries === "number" ? metadata.auto_run_retries : 0,
      userPaused: metadata.auto_run_paused === true,
      pausedReason: str(metadata.auto_run_paused_reason) ?? "",
      completed: isTerminalTaskStatus(task.status),
    });

    const blockers = (blockersByTask.get(task.id) ?? [])
      .filter((id) => isOpenTask(id))
      .map((id) => ({
        id,
        title: taskById.get(id)?.title,
        status: taskById.get(id)?.status,
        errored: erroredByTaskId.get(id) ?? false,
      }));

    const classification = classifyTaskOperation({
      taskId: task.id,
      status: task.status,
      issueType: task.issue_type,
      metadata,
      admission,
      autoRunEnabled: autoRun.enabled,
      autoRunRetries: autoRun.retries,
      autoRunUserPaused: autoRun.userPaused,
      autoRunRetriesExhausted: autoRun.retriesExhausted,
      activeExecutionRunId: snapshot.activeRunByTask.get(task.id)?.id,
      liveSystemRun: liveSystemRunByTask.get(task.id),
      blockingDeps: blockers,
      retryPending: hasExecutionRetriesRemaining(metadata, str(metadata.last_run_status)),
    });

    const impact = computeDownstreamImpact(task.id, allEdges, isOpenTask);
    const causalPath = blockers.length > 0
      ? shortestCausalPath(task.id, allEdges, (id) => isOpenTask(id))
      : [];

    states.push({
      taskId: task.id,
      title: task.title,
      issueType: task.issue_type,
      status: task.status,
      reason: classification.reason,
      detail: clampDetail(classification.detail),
      source: classification.source,
      priority: task.priority,
      workspaceId: task.workspace_id,
      updatedAt: task.updated_at,
      autoRun: {
        enabled: autoRun.enabled,
        source: autoRun.source,
        retries: autoRun.retries,
        maxRetries: MAX_AUTO_RUN_RETRIES,
        paused: autoRun.userPaused || autoRun.retriesExhausted,
      },
      runId: classification.runId,
      chainId: str(metadata.chain_id),
      chainName: str(metadata.chain_name),
      decisionId: classification.decisionId ?? str(metadata.decision_id),
      blockingTaskIds: blockers.map((dep) => dep.id),
      blockedDownstreamTaskIds: impact.total,
      directBlockedTaskIds: impact.direct,
      causalPath,
      hasIndependentBlockers: blockers.length > 1,
      actionUrl: `/tasks?id=${encodeURIComponent(task.id)}`,
    });
  }

  // ---- capacity: first N ready tasks (dispatch order) keep "ready", rest queue ----
  const readyStates = states
    .filter((state) => state.reason === "ready")
    .sort((a, b) => compareDispatchOrder(
      { priority: a.priority, createdAt: taskById.get(a.taskId)?.created_at, taskId: a.taskId },
      { priority: b.priority, createdAt: taskById.get(b.taskId)?.created_at, taskId: b.taskId },
    ));
  const activeRunCount = snapshot.activeRuns.length;
  const availableSlots = Math.max(0, maxConcurrent - activeRunCount);
  readyStates.forEach((state, index) => {
    if (index >= availableSlots) {
      state.reason = "queued_capacity";
      state.detail = `Ready, waiting for a concurrency slot (${activeRunCount}/${maxConcurrent} active)`;
      state.source = "canAdmitAutoRun + max_concurrent_runs";
    }
  });

  // ---- dependency cycles are an error, not a queue ----
  const openTaskIds = new Set(tasks.filter((task) => !isTerminalTaskStatus(task.status)).map((t) => t.id));
  const dependencyCycleTaskIds = detectDependencyCycles(openTaskIds, allEdges);

  // Workspace-scoped projection of task states for the view sections.
  const visibleTasks = tasks.filter((task) => inWorkspace(task.workspace_id));
  const visibleStates = states.filter((state) => inWorkspace(state.workspaceId));
  const visibleTaskIds = new Set(visibleTasks.map((task) => task.id));
  const scopedDependencyCycleTaskIds = !workspaceId
    || dependencyCycleTaskIds.some((taskId) => visibleTaskIds.has(taskId))
    ? dependencyCycleTaskIds
    : [];

  // ---- running now (live snapshot, includes system runs holding slots) ----
  const runningNow: OpsRunningItem[] = snapshot.activeRuns
    .filter((record) => {
      if (!workspaceId) return true;
      const task = record.taskId ? taskById.get(record.taskId) : undefined;
      if (task) return task.workspace_id === workspaceId;
      return (record.raw as unknown as TimelineRunRecordLite).workspacePath === workspaceId;
    })
    .map((record) => {
      const raw = record.raw as unknown as TimelineRunRecordLite;
      const agents = Array.isArray(raw.agents) ? raw.agents : [];
      const task = record.taskId ? taskById.get(record.taskId) : undefined;
      return {
        runId: record.active.id,
        chainId: record.active.chainId,
        chainName: record.active.chain,
        status: record.active.status,
        started: record.active.started,
        taskId: record.taskId,
        taskTitle: task?.title,
        goal: str(raw.goal) ? clampDetail(String(raw.goal)) : undefined,
        agentsTotal: agents.length,
        agentsActive: agents.filter((a) => a.status === "running" || a.status === "pending").length,
        agentsComplete: agents.filter((a) => a.status === "complete" || a.status === "completed").length,
        kind: runKind(record.active.chainId, record.active.chain),
        actionUrl: `/runs?runId=${encodeURIComponent(record.active.id)}`,
      };
    })
    .sort((a, b) => (b.started ?? "").localeCompare(a.started ?? ""));

  // ---- expected next: dispatch-ordered admitted tasks, then dependency lookahead ----
  const upNext: OpsUpNextItem[] = [];
  let position = 1;
  for (const state of readyStates.filter((state) => inWorkspace(state.workspaceId))) {
    upNext.push({
      position: position++,
      taskId: state.taskId,
      title: state.title,
      reason: state.reason,
      detail: state.reason === "ready"
        ? `${state.detail} — next auto-run scan dispatches it`
        : state.detail,
      chainId: state.chainId,
      chainName: state.chainName,
      priority: state.priority,
      blockingTaskIds: [],
      actionUrl: state.actionUrl,
    });
  }
  // Lookahead: dependency-blocked tasks auto-run will pick up once their
  // blockers finish, in dependency-safe stable order.
  const lookahead = visibleStates
    .filter((state) => state.reason === "blocked_dependency" && state.autoRun.enabled
      && !dependencyCycleTaskIds.includes(state.taskId))
    .sort((a, b) => compareDispatchOrder(
      { priority: a.priority, createdAt: taskById.get(a.taskId)?.created_at, taskId: a.taskId },
      { priority: b.priority, createdAt: taskById.get(b.taskId)?.created_at, taskId: b.taskId },
    ));
  for (const state of lookahead.slice(0, Math.max(0, 15 - upNext.length))) {
    upNext.push({
      position: position++,
      taskId: state.taskId,
      title: state.title,
      reason: state.reason,
      detail: `After ${state.blockingTaskIds.join(", ")}`,
      chainId: state.chainId,
      chainName: state.chainName,
      priority: state.priority,
      blockingTaskIds: state.blockingTaskIds,
      actionUrl: state.actionUrl,
    });
  }

  // ---- waiting + attention ----
  const waiting = visibleStates.filter((state) =>
    WAITING_REASONS.has(state.reason) && !isTerminalTaskStatus(state.status));
  const attention: OpsAttentionItem[] = [];
  for (const state of visibleStates) {
    if (!ATTENTION_REASONS.has(state.reason)) continue;
    if (isTerminalTaskStatus(state.status)) continue;
    attention.push({
      severity: state.reason === "blocked_error" || state.reason === "outcome_audit_failed"
        ? "critical"
        : "warn",
      reason: state.reason,
      message: `${state.taskId}: ${state.title}`,
      detail: state.detail,
      source: state.source,
      taskId: state.taskId,
      runId: state.runId,
      decisionId: state.decisionId,
      blockedDownstreamTaskIds: state.blockedDownstreamTaskIds,
      actionUrl: state.actionUrl,
      updatedAt: state.updatedAt,
    });
  }
  if (scopedDependencyCycleTaskIds.length > 0) {
    attention.push({
      severity: "critical",
      reason: "dependency_cycle",
      message: `Dependency cycle: ${scopedDependencyCycleTaskIds.join(" → ")}`,
      detail: "These tasks block each other — no valid execution order exists until an edge is removed",
      source: "task_dependencies (Kahn peel)",
      blockedDownstreamTaskIds: [],
      actionUrl: "/tasks",
    });
  }
  for (const item of digest.attention) {
    attention.push({
      severity: item.severity === "critical" ? "critical" : "warn",
      reason: "system",
      message: item.message,
      source: "monitor status digest",
      blockedDownstreamTaskIds: [],
      actionUrl: item.actionUrl,
    });
  }
  // A corrupt record has no trustworthy workspace identity. Keep it visible
  // in the global view, but never attribute it to a selected workspace.
  for (const corrupt of (workspaceId ? [] : timelineScan.corrupt).slice(0, 3)) {
    attention.push({
      severity: "warn",
      reason: "corrupt_run_record",
      message: `Run record ${corrupt} is unreadable (invalid run.json)`,
      source: "runs directory",
      blockedDownstreamTaskIds: [],
      actionUrl: `/runs?runId=${encodeURIComponent(corrupt)}`,
    });
  }
  attention.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1));

  // ---- human gates ----
  const humanGates: OpsHumanGate[] = [];
  for (const state of visibleStates) {
    if (state.reason !== "waiting_human_decision") continue;
    humanGates.push({
      kind: state.issueType === "decision" ? "decision" : "run_review",
      taskId: state.taskId,
      decisionId: state.decisionId,
      runId: state.runId,
      title: state.title,
      detail: state.detail,
      updatedAt: state.updatedAt,
      actionUrl: state.decisionId
        ? `/decisions?id=${encodeURIComponent(state.decisionId)}`
        : state.runId
          ? `/runs?runId=${encodeURIComponent(state.runId)}`
          : state.actionUrl,
    });
  }
  let decisions: Decision[] = [];
  try {
    decisions = [
      ...sources.decisions(namespaceId, orgId),
      ...(workspaceId ? sources.decisions(namespaceId, orgId, workspaceId) : []),
    ];
  } catch {
    // decisions dir unreadable — gates from decision tasks above still stand
  }
  const gateDecisionIds = new Set(humanGates.map((gate) => gate.decisionId).filter(Boolean));
  for (const decision of decisions) {
    const awaitingSelection = decision.guidedFlow?.round2?.status === "ready";
    const awaitingReview = decision.status === "briefed" || decision.status === "pending";
    if (!awaitingSelection && !awaitingReview) continue;
    if (gateDecisionIds.has(decision.id)) continue;
    humanGates.push({
      kind: "decision",
      decisionId: decision.id,
      taskId: decision.taskId,
      title: decision.title || decision.prompt.slice(0, 80),
      detail: awaitingSelection ? "Options ready — select one to continue" : `Decision is ${decision.status}`,
      status: decision.status,
      updatedAt: decision.updatedAt,
      actionUrl: `/decisions?id=${encodeURIComponent(decision.id)}`,
    });
  }

  // ---- accomplishments (audited closes only) ----
  const recentAccomplishments: OpsAccomplishment[] = [];
  const closedAudited = visibleTasks
    .filter((task) => isTerminalTaskStatus(task.status))
    .map((task) => ({ task, metadata: metadataRecord(task.metadata) }))
    .filter(({ metadata }) => !!metadata.task_outcome_summary && hasDurableAuditedClose(metadata))
    .sort((a, b) => (b.task.closed_at ?? b.task.updated_at).localeCompare(a.task.closed_at ?? a.task.updated_at))
    .slice(0, ACCOMPLISHMENT_CAP);
  for (const { task, metadata } of closedAudited) {
    const summary = metadataRecord(metadata.task_outcome_summary);
    const sourceRunId = str(metadata.task_outcome_summary_source_run_id)
      ?? str(metadata.completion_audit_run_id);
    let artifacts: Array<{ name: string; path: string }> = [];
    let artifactCount = 0;
    if (sourceRunId) {
      try {
        const evidence = sources.runArtifacts(namespaceId, orgId, sourceRunId, metadata.last_run_artifacts, metadata) as {
          disk?: Array<{ name: string; path: string }>;
        };
        const disk = Array.isArray(evidence?.disk) ? evidence.disk : [];
        artifactCount = disk.length;
        artifacts = disk.slice(0, 5).map((file) => ({ name: file.name, path: file.path }));
      } catch {
        // artifact evidence unavailable — the accomplishment still stands on the audit
      }
    }
    const unlockedTaskIds = (allEdges
      .filter((edge) => edge.depends_on_id === task.id && (!edge.type || edge.type === "blocks"))
      .map((edge) => edge.task_id))
      .filter((id, index, list) => list.indexOf(id) === index)
      .filter((id) => isOpenTask(id))
      .filter((id) => (blockersByTask.get(id) ?? []).every((blockerId) => !isOpenTask(blockerId)));
    recentAccomplishments.push({
      taskId: task.id,
      title: task.title,
      headline: str(summary.headline),
      narrative: str(summary.narrative),
      outcome: str(summary.outcome),
      whatHappened: strArray(summary.what_happened),
      evidence: strArray(summary.evidence),
      improvementSignals: strArray(summary.improvement_signals),
      nextActions: strArray(summary.next_actions),
      auditVerdict: str(metadata.last_audit_verdict),
      sourceRunId,
      closedAt: task.closed_at ?? undefined,
      artifacts,
      artifactCount,
      unlockedTaskIds,
      actionUrl: sourceRunId ? `/runs?runId=${encodeURIComponent(sourceRunId)}` : `/tasks?id=${encodeURIComponent(task.id)}`,
    });
  }

  // ---- timeline (real persisted timestamps only, deduped) ----
  const timeline: OpsTimelineItem[] = [];
  const timelineKeys = new Set<string>();
  const push = (item: OpsTimelineItem) => {
    if (!item.at || Number.isNaN(Date.parse(item.at))) return;
    const key = `${item.kind}:${item.taskId ?? item.runId ?? item.decisionId ?? item.title}:${item.at}`;
    if (timelineKeys.has(key)) return;
    timelineKeys.add(key);
    timeline.push(item);
  };

  for (const task of tasks) {
    if (!inWorkspace(task.workspace_id)) continue;
    push({
      at: task.created_at,
      kind: "task_created",
      severity: "info",
      title: `${task.id} created`,
      detail: task.title,
      source: "task store (created_at)",
      taskId: task.id,
      actionUrl: `/tasks?id=${encodeURIComponent(task.id)}`,
    });
    if (task.closed_at) {
      push({
        at: task.closed_at,
        kind: "task_closed",
        severity: "info",
        title: `${task.id} closed`,
        detail: task.title,
        source: "task store (closed_at)",
        taskId: task.id,
        actionUrl: `/tasks?id=${encodeURIComponent(task.id)}`,
      });
    }
  }
  for (const run of timelineScan.runs) {
    if (workspaceId && !(run.taskId && visibleTaskIds.has(run.taskId))
      && run.workspacePath !== workspaceId) continue;
    const kind = runKind(run.chainId, run.chain);
    const label = kind === "execution" ? "Run" : `${kind.replace(/_/g, " ")} run`;
    if (run.started) {
      push({
        at: run.started,
        kind: "run_started",
        severity: "info",
        title: `${label} started: ${run.chain ?? run.id}`,
        detail: run.taskId ? `Task ${run.taskId}` : str(run.goal) ? clampDetail(String(run.goal)) : undefined,
        source: "run.json (started)",
        runId: run.id,
        chainId: run.chainId,
        taskId: run.taskId,
        actionUrl: `/runs?runId=${encodeURIComponent(run.id)}`,
      });
    }
    const statusMessage = str(run.status_message);
    if (statusMessage?.startsWith("reaped:")) {
      push({
        at: run.completed ?? run.started ?? "",
        kind: "run_reaped",
        severity: "warn",
        title: `Recovered dead run: ${run.chain ?? run.id}`,
        detail: clampDetail(statusMessage),
        source: "run.json (status_message)",
        runId: run.id,
        taskId: run.taskId,
        actionUrl: `/runs?runId=${encodeURIComponent(run.id)}`,
      });
    } else if (run.completed && run.status === "completed") {
      push({
        at: run.completed,
        kind: kind === "audit" ? "audit_completed" : "run_completed",
        severity: "info",
        title: `${label} completed: ${run.chain ?? run.id}`,
        detail: run.taskId ? `Task ${run.taskId}` : undefined,
        source: "run.json (completed)",
        runId: run.id,
        chainId: run.chainId,
        taskId: run.taskId,
        actionUrl: `/runs?runId=${encodeURIComponent(run.id)}`,
      });
    } else if (run.completed && (run.status === "failed" || run.status === "stopped" || run.status === "blocked")) {
      push({
        at: run.completed,
        kind: "run_failed",
        severity: "warn",
        title: `${label} ${run.status}: ${run.chain ?? run.id}`,
        detail: statusMessage ? clampDetail(statusMessage) : run.taskId ? `Task ${run.taskId}` : undefined,
        source: "run.json (completed/status)",
        runId: run.id,
        chainId: run.chainId,
        taskId: run.taskId,
        actionUrl: `/runs?runId=${encodeURIComponent(run.id)}`,
      });
    }
  }
  for (const decision of decisions) {
    push({
      at: decision.createdAt,
      kind: "decision_created",
      severity: "info",
      title: `Decision created: ${decision.title || decision.id}`,
      source: "decision store (createdAt)",
      decisionId: decision.id,
      taskId: decision.taskId,
      actionUrl: `/decisions?id=${encodeURIComponent(decision.id)}`,
    });
    if (decision.status === "done" || decision.status === "approved") {
      push({
        at: decision.updatedAt,
        kind: "decision_resolved",
        severity: "info",
        title: `Decision ${decision.status}: ${decision.title || decision.id}`,
        source: "decision store (status/updatedAt)",
        decisionId: decision.id,
        taskId: decision.taskId,
        actionUrl: `/decisions?id=${encodeURIComponent(decision.id)}`,
      });
    }
  }
  for (const error of digest.errorsRecent) {
    push({
      at: error.ts,
      kind: "system_error",
      severity: error.level === "error" ? "critical" : "warn",
      title: `${error.source}: ${error.message}`,
      source: "system log",
      actionUrl: "/settings/logs",
    });
  }
  for (const fix of digest.autoFixes) {
    if (!fix.at) continue;
    push({
      at: fix.at,
      kind: "system_recovery",
      severity: "info",
      title: fix.detail,
      source: `monitor digest (${fix.kind})`,
      actionUrl: "/settings/system",
    });
  }
  timeline.sort((a, b) => b.at.localeCompare(a.at));
  const boundedTimeline = timeline.slice(0, TIMELINE_ITEM_CAP);

  // ---- system + overall ----
  const workerRunning = worker.status === "running";
  const system: OpsSystemState = {
    worker: {
      ...loopState({ status: worker.status, lastCheck: worker.lastCheck }, now, true),
      status: worker.status,
      startedAt: worker.startedAt,
      pid: worker.pid,
    },
    autoRun: {
      ...loopState(worker.autoRun, now, workerRunning),
      ...(worker.autoRun?.lastTriggered !== undefined ? { lastTriggered: worker.autoRun.lastTriggered } : {}),
    },
    watchdog: loopState(worker.watchdog, now, workerRunning),
    decisionReconciler: loopState(worker.decisionReconciler, now, workerRunning),
    chainWatcher: loopState(worker.chainWatcher, now, workerRunning),
    health: digest.health,
    mode: digest.mode,
    recentErrors: digest.errorsRecent,
    recentRecoveries: digest.autoFixes,
    headline: digest.headline,
  };

  const readyCount = visibleStates.filter((state) => state.reason === "ready").length;
  const openBlockerCount = visibleStates.filter((state) =>
    ATTENTION_REASONS.has(state.reason) && !isTerminalTaskStatus(state.status)).length;
  const overall = computeOverall({
    digestOverall: digest.overall,
    activeRunCount,
    readyCount,
    attentionCount: attention.length,
    openBlockerCount,
  });
  const overallDetail = overall === "unhealthy"
    ? digest.headline
    : overall === "blocked"
      ? `No runs active and nothing admissible — ${openBlockerCount} task${openBlockerCount === 1 ? "" : "s"} need attention`
      : overall === "degraded"
        ? attention[0]?.message ?? digest.headline
        : overall === "running"
          ? `${activeRunCount} run${activeRunCount === 1 ? "" : "s"} active, ${readyCount} ready`
          : "Nothing running, nothing pending";

  return {
    generatedAt,
    overall,
    overallDetail,
    system,
    attention,
    runningNow,
    upNext,
    waiting,
    humanGates,
    recentAccomplishments,
    timeline: boundedTimeline,
    taskStates: visibleStates,
    dependencyCycleTaskIds: scopedDependencyCycleTaskIds,
    counts: {
      tasksOpen: visibleTasks.filter((task) => task.status === "open").length,
      tasksInProgress: visibleTasks.filter((task) => task.status === "in_progress").length,
      tasksClosed: visibleTasks.filter((task) => isTerminalTaskStatus(task.status)).length,
      runsActive: activeRunCount,
      maxConcurrentRuns: maxConcurrent,
      availableSlots,
      attention: attention.length,
      ready: readyCount,
      waiting: waiting.length,
      humanGates: humanGates.length,
    },
  };
}

// ---------- notification emission (idempotent, called by the route) ----------

export function emitOperationsNotifications(
  namespaceId: string,
  view: OperationsView,
): { created: number; failed: number } {
  const states = view.taskStates
    .filter((state) => !isTerminalTaskStatus(state.status))
    .map((state) => ({
      taskId: state.taskId,
      title: state.title,
      reason: state.reason,
      runId: state.runId,
      decisionId: state.decisionId,
      retries: state.autoRun.retries,
      downstreamOpenCount: state.blockedDownstreamTaskIds.length,
      updatedAt: state.updatedAt,
    }));

  // A recently closed task that released downstream work → recovery notification.
  const unblocked = view.recentAccomplishments
    .filter((item) => item.closedAt && item.unlockedTaskIds.length > 0)
    .map((item) => ({
      taskId: item.taskId,
      closedAt: item.closedAt!,
      releasedTaskIds: item.unlockedTaskIds,
    }));

  const loopErrors: Array<{ loop: string; error: string }> = [];
  for (const [loop, state] of Object.entries({
    autoRun: view.system.autoRun,
    watchdog: view.system.watchdog,
    decisionReconciler: view.system.decisionReconciler,
    chainWatcher: view.system.chainWatcher,
  })) {
    if (state.lastError) loopErrors.push({ loop, error: state.lastError });
  }

  const specs = buildOperationsNotifications(states, {
    workerStatus: view.system.worker.status,
    workerStale: view.system.worker.stale,
    workerAnchor: view.system.worker.startedAt ?? view.system.worker.lastCheck ?? "unknown",
    loopErrors,
    reapedRuns: view.timeline
      .filter((item) => item.kind === "run_reaped" && item.runId)
      .map((item) => ({ runId: item.runId!, detail: item.detail ?? item.title })),
    unblocked,
  });

  let created = 0;
  let failed = 0;
  for (const spec of specs) {
    try {
      const result = createNotification(namespaceId, {
        type: spec.type,
        title: spec.title,
        message: spec.message,
        metadata: spec.metadata,
        idempotencyKey: spec.idempotencyKey,
      });
      // addNotification returns the pre-existing record when the idempotency
      // key was already used — only genuinely new inserts stamp a timestamp at
      // or after this view's generation time.
      if (result.timestamp >= view.generatedAt) created += 1;
    } catch {
      failed += 1;
    }
  }
  return { created, failed };
}
