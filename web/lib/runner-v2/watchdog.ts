import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from "fs";
import { join } from "path";
import { spawn } from "child_process";
import { createHash } from "crypto";
import config from "@/lib/config";
import { hasLivePendingHandoff, processIsAlive } from "@/lib/runner-v2/handoff-liveness";
import { emitRunnerEvent } from "@/lib/runner-v2/event-emitter";
import { scanRunnerEventFiles } from "@/lib/runner-v2/event-lifecycle";
import { pty, type SessionInfo } from "@/lib/pty/pty-client";
import { readRunJson, updateRunJson, type RunAgentRecord, type RunRecord } from "@/lib/runner-v2/run-state";
import type { AdapterOperation } from "@/lib/runner-v2/adapters";
import { enqueueExternalEffectsOnce } from "@/lib/runner-v2/external-effects";
import { withExclusiveFileClaim } from "@/lib/runner-v2/file-claim";
import { shouldRecordTaskExecutionMetadata } from "@/lib/runs/run-provenance";
import { releaseRunAgentCapacitySlots } from "@/lib/runner-v2/agent-attempt";

const RESUME_GRACE_MS = 120_000;
const MISSING_SESSION_STARTUP_GRACE_MS = 10_000;
const SESSION_EXIT_HANDOFF_GRACE_MS = 300_000;
const SESSIONLESS_AGENT_GRACE_MS = 120_000;
const PENDING_RUN_GRACE_MS = 120_000;
const RECENT_COMPLETION_HANDOFF_GRACE_MS = 300_000;
const HOOK_TIMEOUT_MS = 30_000;

const TERMINAL_RUN_STATUSES = new Set(["completed", "complete", "failed", "cancelled", "stopped"]);
const ACTIVE_AGENT_STATUSES = new Set(["running", "idle", "waiting"]);
const PROTECTED_SESSION_PREFIXES = [
  "mentiko-watchdog",
  "mentiko-chain-watcher",
  "term-",
  "gh-auth-",
  "cli-auth-",
  "link-",
  "peer-",
  "complete-",
];

export type WatchdogSession = Pick<SessionInfo, "name" | "alive">;

export interface WatchdogTransport {
  list(): Promise<WatchdogSession[]>;
  remove(name: string): Promise<void>;
}

export interface WatchdogHookInput {
  event: "run-stalled";
  runId: string;
  idempotencyKey: string;
  details: Record<string, string>;
  hooksDir: string;
  stateDir: string;
  /** Test/embedding override; production uses the bounded defaults. */
  timeoutMs?: number;
  /** Test/embedding override; production uses the bounded defaults. */
  killGraceMs?: number;
}

export interface WatchdogDependencies {
  transport: WatchdogTransport;
  processAlive: (pid: number) => boolean;
  dispatchHooks: (input: WatchdogHookInput) => void | Promise<void>;
}

export interface TypedWatchdogScanOptions {
  runsDir?: string;
  eventsDir?: string;
  stateDir?: string;
  hooksDir?: string;
  namespaceId?: string;
  orgId?: string;
  now?: Date;
  reapOrphans?: boolean;
  dependencies?: Partial<WatchdogDependencies>;
}

export interface WatchdogStallDetails {
  runId: string;
  lastAgent: string;
  lastAgentStatus: string;
  pendingAgents: string[];
  reason: string;
}

export interface WatchdogRunMarker extends WatchdogStallDetails {
  status: "stalled";
  detectedAt: string;
  eventEmittedAt?: string;
  externalEffectsQueuedAt?: string;
  hooksDispatchedAt?: string;
}

export type WatchdogRunAssessment =
  | { outcome: "skip"; reason: "not-running" | "no-active-agents" }
  | { outcome: "alive"; reason: string }
  | ({ outcome: "stalled" } & WatchdogStallDetails);

export interface TypedWatchdogScanResult {
  transportAvailable: boolean;
  scanned: number;
  stalled: string[];
  events: string[];
  sessionsRemoved: string[];
  sessionRemovalFailures: string[];
  orphanSessionsRemoved: string[];
  externalEffectsQueued: number;
  hookDispatches: number;
  errors: string[];
}

interface ScopedRun {
  runJsonPath: string;
  run: RunRecord;
}

interface TerminalizeResult {
  terminalized: boolean;
  run: RunRecord;
  previousRun?: RunRecord;
  assessment?: Extract<WatchdogRunAssessment, { outcome: "stalled" }>;
}

const defaultDependencies: WatchdogDependencies = {
  transport: pty,
  processAlive: processIsAlive,
  dispatchHooks: dispatchExecutableWatchdogHooks,
};

/**
 * One background-worker watchdog pass. PTY transport failure skips mutation:
 * an empty session list is evidence only when the typed daemon answered.
 */
export async function runTypedWatchdogScan(
  options: TypedWatchdogScanOptions = {},
): Promise<TypedWatchdogScanResult> {
  const runsDir = options.runsDir || config.runsDir;
  const eventsDir = options.eventsDir || config.eventsDir;
  const stateDir = options.stateDir || config.stateDir;
  const hooksDir = options.hooksDir || config.watchdogHooksDir;
  const namespaceId = options.namespaceId || config.namespaceId;
  const orgId = options.orgId || config.orgId;
  const now = options.now || new Date();
  const dependencies: WatchdogDependencies = {
    ...defaultDependencies,
    ...options.dependencies,
  };
  const result: TypedWatchdogScanResult = {
    transportAvailable: true,
    scanned: 0,
    stalled: [],
    events: [],
    sessionsRemoved: [],
    sessionRemovalFailures: [],
    orphanSessionsRemoved: [],
    externalEffectsQueued: 0,
    hookDispatches: 0,
    errors: [],
  };

  let initialSessions: WatchdogSession[];
  try {
    initialSessions = await dependencies.transport.list();
  } catch (error) {
    result.transportAvailable = false;
    result.errors.push(`pty transport unavailable: ${errorMessage(error)}`);
    return result;
  }

  const initialSessionMap = sessionMap(initialSessions);
  const finalizedRunIds = new Set<string>();
  const deferredRunIds = new Set<string>();
  for (const scopedRun of readScopedRuns(runsDir, result.errors)) {
    if (scopedRun.run.status !== "running") continue;
    result.scanned += 1;
    const firstAssessment = assessRunForWatchdog(
      scopedRun.run,
      initialSessionMap,
      now,
      dependencies.processAlive,
    );
    if (firstAssessment.outcome !== "stalled") continue;

    // A launch or completion handoff can race the scan. Query the daemon again
    // and re-read run.json under the shared run lock before terminal mutation.
    let currentSessions: WatchdogSession[];
    try {
      currentSessions = await dependencies.transport.list();
    } catch (error) {
      result.errors.push(`skipped ${scopedRun.run.id}: PTY recheck failed: ${errorMessage(error)}`);
      continue;
    }
    const currentSessionMap = sessionMap(currentSessions);
    const terminalized = terminalizeIfStillStalled(
      scopedRun.runJsonPath,
      currentSessionMap,
      now,
      dependencies.processAlive,
    );
    if (!terminalized.terminalized || !terminalized.assessment) continue;

    // The write above is provisional. A session can register immediately after
    // the pre-write read, so observe the daemon once more before cleanup or any
    // irreversible event/outbox/hook effect. Roll back only the watchdog-owned
    // fields while preserving any concurrent session-registration mutation.
    let postMutationSessions: WatchdogSession[];
    try {
      postMutationSessions = await dependencies.transport.list();
    } catch (error) {
      deferredRunIds.add(terminalized.run.id);
      const rolledBack = rollbackWatchdogTerminalization(scopedRun.runJsonPath, terminalized);
      result.errors.push(
        `skipped ${terminalized.run.id}: PTY post-mutation recheck failed: ${errorMessage(error)}`
        + (rolledBack ? "" : "; watchdog transition changed before rollback"),
      );
      continue;
    }
    const postMutationRun = readRunJson(scopedRun.runJsonPath);
    if (hasLiveRunSession(postMutationRun, postMutationSessions)) {
      deferredRunIds.add(terminalized.run.id);
      if (!rollbackWatchdogTerminalization(scopedRun.runJsonPath, terminalized, true)) {
        result.errors.push(
          `skipped ${terminalized.run.id}: live PTY appeared and watchdog transition changed before rollback`,
        );
      }
      continue;
    }

    result.stalled.push(terminalized.run.id);
    const cleanup = await removeRunSessions(
      terminalized.run,
      sessionMap(postMutationSessions),
      dependencies.transport,
    );
    result.sessionsRemoved.push(...cleanup.removed);
    result.sessionRemovalFailures.push(...cleanup.failed);
    await finalizeWatchdogTerminalization({
      scopedRun: { runJsonPath: scopedRun.runJsonPath, run: terminalized.run },
      eventsDir,
      stateDir,
      hooksDir,
      namespaceId,
      orgId,
      now,
      dependencies,
      result,
    });
    finalizedRunIds.add(terminalized.run.id);
  }

  // Terminal status and its durable marker are committed together. If the
  // worker crashed after that atomic write but before an event/outbox/hook,
  // later passes finish the missing steps instead of losing the diagnosis.
  for (const scopedRun of readScopedRuns(runsDir, result.errors)) {
    if (
      finalizedRunIds.has(scopedRun.run.id)
      || deferredRunIds.has(scopedRun.run.id)
      || !TERMINAL_RUN_STATUSES.has(String(scopedRun.run.status))
      || !watchdogMarker(scopedRun.run)
    ) continue;
    await finalizeWatchdogTerminalization({
      scopedRun,
      eventsDir,
      stateDir,
      hooksDir,
      namespaceId,
      orgId,
      now,
      dependencies,
      result,
    });
  }

  if (options.reapOrphans !== false) {
    try {
      const currentSessions = await dependencies.transport.list();
      const orphanCleanup = await reapProvableScopedOrphans(
        readScopedRuns(runsDir, result.errors),
        currentSessions,
        dependencies.transport,
      );
      result.orphanSessionsRemoved.push(...orphanCleanup.removed);
      result.sessionRemovalFailures.push(...orphanCleanup.failed);
    } catch (error) {
      result.errors.push(`orphan cleanup skipped: ${errorMessage(error)}`);
    }
  }

  return result;
}

export function assessRunForWatchdog(
  run: RunRecord,
  sessions: ReadonlyMap<string, WatchdogSession>,
  now: Date,
  isProcessAlive: (pid: number) => boolean = processIsAlive,
): WatchdogRunAssessment {
  if (run.status !== "running") return { outcome: "skip", reason: "not-running" };
  const agents = Array.isArray(run.agents) ? run.agents : [];
  const nowMs = now.getTime();

  const resumedAt = timestampMs(run.resumedAt);
  if (resumedAt !== undefined && nowMs - resumedAt < RESUME_GRACE_MS) {
    return { outcome: "alive", reason: "resume-grace" };
  }
  if (hasLivePendingHandoff(run, isProcessAlive, nowMs)) {
    return { outcome: "alive", reason: "typed-handoff" };
  }

  const runMonitor = sessions.get(`monitor-${run.id}`);
  if (runMonitor?.alive) return { outcome: "alive", reason: "live-run-monitor" };

  const runAgeMs = ageMs(nowMs, runStartedMs(run));
  const latestCompletionMs = latestAgentCompletionMs(agents);
  const pendingAgents: string[] = [];
  let anyActive = false;
  let anyAlive = false;
  let lastAgent = "";
  let lastAgentStatus = "";

  for (const agent of agents) {
    const agentId = stringValue(agent.id);
    const status = stringValue(agent.status);
    const sessionName = stringValue(agent.session);

    // PTY state is authoritative regardless of the persisted agent status.
    if (sessionName && sessions.get(sessionName)?.alive) {
      anyAlive = true;
    }
    if (sessionName && sessions.get(`monitor-${sessionName}`)?.alive) {
      anyAlive = true;
    }
    if (agentId && sessions.get(`monitor-${run.id}-${agentId}`)?.alive) {
      anyAlive = true;
    }
    if (sessionName && hasLiveCompletionHandler(sessions, sessionName)) {
      anyAlive = true;
    }
    if (anyAlive && status !== "pending") {
      lastAgent = agentId;
      lastAgentStatus = status;
    }

    if (ACTIVE_AGENT_STATUSES.has(status)) {
      anyActive = true;
      const agentAgeMs = ageMs(nowMs, timestampMs(agent.started) ?? runStartedMs(run));
      if (sessionName) {
        const knownSession = sessions.get(sessionName);
        if (knownSession && !knownSession.alive && agentAgeMs !== undefined && agentAgeMs < SESSION_EXIT_HANDOFF_GRACE_MS) {
          anyAlive = true;
        } else if (!knownSession && agentAgeMs !== undefined && agentAgeMs < MISSING_SESSION_STARTUP_GRACE_MS) {
          anyAlive = true;
        }
      } else {
        const startedAt = timestampMs(agent.started);
        // A missing/unparseable transition timestamp is not proof of a stall.
        if (startedAt === undefined || nowMs - startedAt < SESSIONLESS_AGENT_GRACE_MS) {
          anyAlive = true;
        }
      }
    } else if (status === "pending") {
      anyActive = true;
      if (agentId) pendingAgents.push(agentId);
      if (runAgeMs !== undefined && runAgeMs < PENDING_RUN_GRACE_MS) {
        anyAlive = true;
      }
      if (latestCompletionMs !== undefined && nowMs - latestCompletionMs < RECENT_COMPLETION_HANDOFF_GRACE_MS) {
        anyAlive = true;
      }
    }

    if (status !== "pending") {
      lastAgent = agentId;
      lastAgentStatus = status;
    }
  }

  if (!anyActive) return { outcome: "skip", reason: "no-active-agents" };
  if (anyAlive) return { outcome: "alive", reason: "live-session-or-grace" };
  return {
    outcome: "stalled",
    runId: run.id,
    lastAgent: lastAgent || "unknown",
    lastAgentStatus: lastAgentStatus || "unknown",
    pendingAgents,
    reason: "no live agent or monitor session after watchdog grace windows",
  };
}

function terminalizeIfStillStalled(
  runJsonPath: string,
  sessions: ReadonlyMap<string, WatchdogSession>,
  now: Date,
  isProcessAlive: (pid: number) => boolean,
): TerminalizeResult {
  let terminalized = false;
  let previousRun: RunRecord | undefined;
  let assessment: Extract<WatchdogRunAssessment, { outcome: "stalled" }> | undefined;
  const completedAt = now.toISOString();
  const run = updateRunJson(runJsonPath, (current) => {
    if (!current) throw new Error(`run.json not found: ${runJsonPath}`);
    const currentAssessment = assessRunForWatchdog(current, sessions, now, isProcessAlive);
    if (currentAssessment.outcome !== "stalled") return current;
    terminalized = true;
    previousRun = current;
    assessment = currentAssessment;
    return {
      ...current,
      status: "stopped",
      completed: current.completed || completedAt,
      status_message: `watchdog: ${currentAssessment.reason}`,
      agents: current.agents.map((agent) => terminalAgentRecord(agent, completedAt)),
      runnerV2: {
        ...objectValue(current.runnerV2),
        watchdog: {
          status: "stalled",
          detectedAt: completedAt,
          runId: currentAssessment.runId,
          lastAgent: currentAssessment.lastAgent,
          lastAgentStatus: currentAssessment.lastAgentStatus,
          pendingAgents: currentAssessment.pendingAgents,
          reason: currentAssessment.reason,
        } satisfies WatchdogRunMarker,
      },
    };
  });
  return { terminalized, run, previousRun, assessment };
}

function rollbackWatchdogTerminalization(
  runJsonPath: string,
  transition: TerminalizeResult,
  acceptConcurrentReactivation = false,
): boolean {
  if (!transition.previousRun) return false;
  let rolledBack = false;
  updateRunJson(runJsonPath, (current) => {
    if (!current) throw new Error(`run.json not found: ${runJsonPath}`);
    const currentMarker = watchdogMarker(current);
    const transitionMarker = watchdogMarker(transition.run);
    if (!currentMarker || JSON.stringify(currentMarker) !== JSON.stringify(transitionMarker)) {
      // addRunSession atomically clears a still-provisional watchdog marker
      // when a live PTY wins this race. The final daemon recheck is already
      // authoritative in this call path, so that durable reactivation is the
      // successful rollback state rather than a transition conflict.
      if (
        acceptConcurrentReactivation
        && current.status === "running"
        && current.completed === undefined
        && current.status_message === undefined
      ) {
        rolledBack = true;
      }
      return current;
    }
    const previous = transition.previousRun!;
    const currentRunnerV2 = objectValue(current.runnerV2);
    const previousRunnerV2 = objectValue(previous.runnerV2);
    const nextRunnerV2 = { ...currentRunnerV2 };
    if ("watchdog" in previousRunnerV2) nextRunnerV2.watchdog = previousRunnerV2.watchdog;
    else delete nextRunnerV2.watchdog;
    rolledBack = true;
    return {
      ...current,
      status: current.status === transition.run.status ? previous.status : current.status,
      completed: current.completed === transition.run.completed ? previous.completed : current.completed,
      status_message: current.status_message === transition.run.status_message
        ? previous.status_message
        : current.status_message,
      agents: current.agents.map((agent) => rollbackWatchdogAgent(agent, transition, previous)),
      runnerV2: Object.keys(nextRunnerV2).length > 0 ? nextRunnerV2 : undefined,
    };
  });
  return rolledBack;
}

function rollbackWatchdogAgent(
  current: RunAgentRecord,
  transition: TerminalizeResult,
  previousRun: RunRecord,
): RunAgentRecord {
  const terminalized = transition.run.agents.find((agent) => agent.id === current.id);
  const previous = previousRun.agents.find((agent) => agent.id === current.id);
  if (!terminalized || !previous) return current;
  const next = { ...current };
  if (current.status === terminalized.status) next.status = previous.status;
  if (current.completed === terminalized.completed) {
    if (previous.completed === undefined) delete next.completed;
    else next.completed = previous.completed;
  }
  return next;
}

async function finalizeWatchdogTerminalization(input: {
  scopedRun: ScopedRun;
  eventsDir: string;
  stateDir: string;
  hooksDir: string;
  namespaceId: string;
  orgId: string;
  now: Date;
  dependencies: WatchdogDependencies;
  result: TypedWatchdogScanResult;
}): Promise<void> {
  let currentRun = input.scopedRun.run;
  let marker = watchdogMarker(currentRun);
  if (!marker) return;
  const assessment = markerAssessment(marker);

  try {
    releaseRunAgentCapacitySlots({
      runJsonPath: input.scopedRun.runJsonPath,
      now: input.now,
    });
    currentRun = readRunJson(input.scopedRun.runJsonPath);
    marker = watchdogMarker(currentRun)!;
  } catch (error) {
    input.result.errors.push(`capacity release failed for ${currentRun.id}: ${errorMessage(error)}`);
  }

  if (!marker.eventEmittedAt) {
    try {
      const eventPath = writeRunStalledEvent(input.eventsDir, assessment, new Date(marker.detectedAt));
      input.result.events.push(eventPath);
      currentRun = markWatchdogStep(input.scopedRun.runJsonPath, "eventEmittedAt", input.now);
      marker = watchdogMarker(currentRun)!;
    } catch (error) {
      input.result.errors.push(`event emission failed for ${currentRun.id}: ${errorMessage(error)}`);
    }
  }

  if (!marker.externalEffectsQueuedAt) {
    try {
      input.result.externalEffectsQueued += queueStallExternalEffects({
        run: currentRun,
        stateDir: input.stateDir,
        namespaceId: input.namespaceId,
        orgId: input.orgId,
        assessment,
        now: input.now,
      });
      currentRun = markWatchdogStep(input.scopedRun.runJsonPath, "externalEffectsQueuedAt", input.now);
      marker = watchdogMarker(currentRun)!;
    } catch (error) {
      input.result.errors.push(`side-effect queue failed for ${currentRun.id}: ${errorMessage(error)}`);
    }
  }

  if (!marker.hooksDispatchedAt) {
    try {
      const idempotencyKey = watchdogHookDispatchKey(currentRun.id);
      await input.dependencies.dispatchHooks({
        event: "run-stalled",
        runId: currentRun.id,
        idempotencyKey,
        details: {
          ...hookDetails(currentRun, assessment),
          dispatch_key: idempotencyKey,
        },
        hooksDir: input.hooksDir,
        stateDir: input.stateDir,
      });
      input.result.hookDispatches += 1;
      markWatchdogStep(input.scopedRun.runJsonPath, "hooksDispatchedAt", input.now);
    } catch (error) {
      input.result.errors.push(`hook dispatch failed for ${currentRun.id}: ${errorMessage(error)}`);
    }
  }
}

function markWatchdogStep(
  runJsonPath: string,
  field: "eventEmittedAt" | "externalEffectsQueuedAt" | "hooksDispatchedAt",
  now: Date,
): RunRecord {
  return updateRunJson(runJsonPath, (current) => {
    if (!current) throw new Error(`run.json not found: ${runJsonPath}`);
    const marker = watchdogMarker(current);
    if (!marker || marker[field]) return current;
    return {
      ...current,
      runnerV2: {
        ...objectValue(current.runnerV2),
        watchdog: { ...marker, [field]: now.toISOString() },
      },
    };
  });
}

function watchdogMarker(run: RunRecord): WatchdogRunMarker | undefined {
  const value = objectValue(objectValue(run.runnerV2).watchdog);
  if (value.status !== "stalled" || typeof value.detectedAt !== "string") return undefined;
  if (!Number.isFinite(new Date(value.detectedAt).getTime())) return undefined;
  if (typeof value.runId !== "string" || typeof value.reason !== "string") return undefined;
  return {
    status: "stalled",
    detectedAt: value.detectedAt,
    runId: value.runId,
    reason: value.reason,
    lastAgent: typeof value.lastAgent === "string" ? value.lastAgent : "unknown",
    lastAgentStatus: typeof value.lastAgentStatus === "string" ? value.lastAgentStatus : "unknown",
    pendingAgents: Array.isArray(value.pendingAgents)
      ? value.pendingAgents.filter((agent): agent is string => typeof agent === "string")
      : [],
    ...(typeof value.eventEmittedAt === "string" ? { eventEmittedAt: value.eventEmittedAt } : {}),
    ...(typeof value.externalEffectsQueuedAt === "string" ? { externalEffectsQueuedAt: value.externalEffectsQueuedAt } : {}),
    ...(typeof value.hooksDispatchedAt === "string" ? { hooksDispatchedAt: value.hooksDispatchedAt } : {}),
  };
}

function markerAssessment(marker: WatchdogRunMarker): Extract<WatchdogRunAssessment, { outcome: "stalled" }> {
  return {
    outcome: "stalled",
    runId: marker.runId,
    reason: marker.reason,
    lastAgent: marker.lastAgent,
    lastAgentStatus: marker.lastAgentStatus,
    pendingAgents: marker.pendingAgents,
  };
}

function terminalAgentRecord(agent: RunAgentRecord, completedAt: string): RunAgentRecord {
  const status = stringValue(agent.status);
  if (ACTIVE_AGENT_STATUSES.has(status)) {
    const nextStatus = stringValue(agent.session) ? "stopped" : "cancelled";
    return { ...agent, status: nextStatus, completed: agent.completed || completedAt };
  }
  if (status === "pending") {
    return { ...agent, status: "cancelled", completed: agent.completed || completedAt };
  }
  return agent;
}

function writeRunStalledEvent(
  eventsDir: string,
  assessment: Extract<WatchdogRunAssessment, { outcome: "stalled" }>,
  now: Date,
): string {
  mkdirSync(eventsDir, { recursive: true });
  const idempotencyKey = watchdogEventId(assessment.runId, now.toISOString());
  const persisted = findWatchdogEventOccurrence(eventsDir, idempotencyKey);
  if (persisted) return persisted;
  return emitRunnerEvent({
    event: "run-stalled",
    source: "watchdog",
    runId: assessment.runId,
    scope: "run",
    filenameMode: "canonical",
    eventsDir,
    timestamp: now.toISOString(),
    idempotencyKey,
    data: JSON.stringify({
      reason: assessment.reason,
      last_agent: assessment.lastAgent,
      last_agent_status: assessment.lastAgentStatus,
      pending_agents: assessment.pendingAgents,
    }),
  }).path;
}

function findWatchdogEventOccurrence(eventsDir: string, idempotencyKey: string): string | undefined {
  for (const root of [eventsDir, join(eventsDir, "archive")]) {
    if (!existsSync(root)) continue;
    const match = scanRunnerEventFiles(root).valid.find(({ event }) => (
      event.event === "run-stalled"
      && event.source === "watchdog"
      && event.fields.idempotency_key === idempotencyKey
    ));
    if (match) return match.path;
  }
  return undefined;
}

function queueStallExternalEffects(input: {
  run: RunRecord;
  stateDir: string;
  namespaceId: string;
  orgId: string;
  assessment: Extract<WatchdogRunAssessment, { outcome: "stalled" }>;
  now: Date;
}): number {
  mkdirSync(input.stateDir, { recursive: true });
  const outboxPath = join(input.stateDir, "external-effects.jsonl");
  const operations: Array<{ idempotencyKey: string; operation: AdapterOperation }> = [];
  if (input.run.taskId && shouldRecordTaskExecutionMetadata(input.run.metadata)) {
    operations.push({
      idempotencyKey: watchdogExternalEffectId(input.run.id, "task-status"),
      operation: {
        type: "task-status",
        status: "stopped",
        taskId: input.run.taskId,
        runId: input.run.id,
      },
    });
  }
  operations.push({
    idempotencyKey: watchdogExternalEffectId(input.run.id, "notification"),
    operation: {
      type: "notification",
      event: "chain-stalled",
      chainName: input.run.chain || "unknown",
      runId: input.run.id,
      agentId: input.assessment.lastAgent === "unknown" ? undefined : input.assessment.lastAgent,
      reason: input.assessment.reason,
    },
  });
  return enqueueExternalEffectsOnce(outboxPath, operations.map(({ idempotencyKey, operation }) => ({
    idempotencyKey,
    operation,
    namespaceId: input.namespaceId,
    orgId: input.orgId,
    reason: "typed watchdog queued durable stall reconciliation",
    timestamp: input.now.toISOString(),
  })));
}

export function watchdogExternalEffectId(
  runId: string,
  effect: "task-status" | "notification",
): string {
  return `watchdog:${runId}:run-stalled:${effect}:v1`;
}

export function watchdogEventId(runId: string, detectedAt: string): string {
  return `watchdog:${runId}:run-stalled:event:${detectedAt}:v1`;
}

export function watchdogHookDispatchKey(runId: string): string {
  return `watchdog:${runId}:run-stalled:hooks:v1`;
}

async function removeRunSessions(
  run: RunRecord,
  sessions: ReadonlyMap<string, WatchdogSession>,
  transport: WatchdogTransport,
): Promise<{ removed: string[]; failed: string[] }> {
  const names = new Set<string>();
  for (const agent of run.agents) {
    const sessionName = stringValue(agent.session);
    const agentId = stringValue(agent.id);
    if (sessionName) {
      names.add(sessionName);
      names.add(`monitor-${sessionName}`);
      for (const session of sessions.values()) {
        if (!session.alive && isCompletionSessionForAgent(session.name, sessionName)) {
          names.add(session.name);
        }
      }
    }
    if (agentId) names.add(`monitor-${run.id}-${agentId}`);
  }
  names.add(`monitor-${run.id}`);
  return removeVerifiedSessions(
    [...names].filter((name) => sessions.has(name)),
    transport,
  );
}

function hasLiveRunSession(run: RunRecord, sessions: WatchdogSession[]): boolean {
  const names = new Set<string>();
  for (const agent of run.agents) {
    const sessionName = stringValue(agent.session);
    const agentId = stringValue(agent.id);
    if (sessionName) {
      names.add(sessionName);
      names.add(`monitor-${sessionName}`);
      for (const session of sessions) {
        if (isCompletionSessionForAgent(session.name, sessionName)) names.add(session.name);
      }
    }
    if (agentId) names.add(`monitor-${run.id}-${agentId}`);
  }
  names.add(`monitor-${run.id}`);
  return sessions.some((session) => session.alive && names.has(session.name));
}

async function reapProvableScopedOrphans(
  runs: ScopedRun[],
  sessions: WatchdogSession[],
  transport: WatchdogTransport,
): Promise<{ removed: string[]; failed: string[] }> {
  const activeReferences = new Set<string>();
  const terminalReferences = new Set<string>();
  const agentSessionReferences = new Set<string>();
  for (const { run } of runs) {
    const target = TERMINAL_RUN_STATUSES.has(String(run.status)) ? terminalReferences : activeReferences;
    for (const agent of run.agents || []) {
      const name = stringValue(agent.session);
      if (!name) continue;
      agentSessionReferences.add(name);
      target.add(name);
      target.add(`monitor-${name}`);
      const agentId = stringValue(agent.id);
      if (agentId) target.add(`monitor-${run.id}-${agentId}`);
    }
    if (target === terminalReferences) target.add(`monitor-${run.id}`);
  }

  const existing = new Set(sessions.map((session) => session.name));
  const terminalCandidates = [...terminalReferences].filter((name) => (
    existing.has(name)
    && !activeReferences.has(name)
    && !isProtectedStandaloneSession(name, terminalReferences)
  ));
  const completionCandidates = sessions
    .filter((session) => !session.alive)
    .map((session) => session.name)
    .filter((name) => (
      !activeReferences.has(name)
      && [...agentSessionReferences].some((agentSession) => (
        isCompletionSessionForAgent(name, agentSession)
      ))
    ));
  return removeVerifiedSessions(
    [...terminalCandidates, ...completionCandidates],
    transport,
  );
}

async function removeVerifiedSessions(
  names: string[],
  transport: WatchdogTransport,
): Promise<{ removed: string[]; failed: string[] }> {
  const removed: string[] = [];
  const failed: string[] = [];
  for (const name of [...new Set(names)]) {
    try {
      // The assessment snapshot is not permission to kill. A monitor, handoff,
      // or agent can become live after that snapshot, so every destructive
      // removal gets a fresh transport read and fails closed on live evidence.
      const beforeRemoval = await transport.list();
      if (beforeRemoval.some((session) => session.name === name && session.alive)) {
        failed.push(name);
        continue;
      }
      await transport.remove(name);
      const current = await transport.list();
      if (current.some((session) => session.name === name)) failed.push(name);
      else removed.push(name);
    } catch {
      failed.push(name);
    }
  }
  return { removed, failed };
}

function readScopedRuns(runsDir: string, errors: string[]): ScopedRun[] {
  if (!existsSync(runsDir)) return [];
  const runs: ScopedRun[] = [];
  for (const entry of readdirSync(runsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("run-")) continue;
    const runJsonPath = join(runsDir, entry.name, "run.json");
    if (!existsSync(runJsonPath)) continue;
    try {
      runs.push({ runJsonPath, run: readRunJson(runJsonPath) });
    } catch (error) {
      errors.push(`invalid run ${entry.name}: ${errorMessage(error)}`);
    }
  }
  return runs;
}

function sessionMap(sessions: WatchdogSession[]): Map<string, WatchdogSession> {
  return new Map(sessions.map((session) => [session.name, session]));
}

function hasLiveCompletionHandler(
  sessions: ReadonlyMap<string, WatchdogSession>,
  agentSession: string,
): boolean {
  for (const session of sessions.values()) {
    if (session.alive && isCompletionSessionForAgent(session.name, agentSession)) return true;
  }
  return false;
}

/**
 * Completion PTYs are minted as `complete-<agent session>-<epoch seconds>`.
 * Requiring the numeric generated suffix prevents a short agent session such as
 * `writer` from claiming an unrelated `complete-writer-review-...` PTY.
 */
function isCompletionSessionForAgent(name: string, agentSession: string): boolean {
  const prefix = `complete-${agentSession}-`;
  if (!name.startsWith(prefix)) return false;
  return /^\d{10,}$/.test(name.slice(prefix.length));
}

function latestAgentCompletionMs(agents: RunAgentRecord[]): number | undefined {
  const values = agents
    .map((agent) => timestampMs(agent.completed))
    .filter((value): value is number => value !== undefined);
  return values.length ? Math.max(...values) : undefined;
}

function runStartedMs(run: RunRecord): number | undefined {
  const match = /^run-(\d{10,})/.exec(run.id);
  if (match) {
    const raw = Number(match[1]);
    if (Number.isFinite(raw)) return raw < 100_000_000_000 ? raw * 1_000 : raw;
  }
  return timestampMs(run.started);
}

function timestampMs(value: unknown): number | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
}

function ageMs(nowMs: number, startedMs: number | undefined): number | undefined {
  return startedMs === undefined ? undefined : Math.max(0, nowMs - startedMs);
}

function stringValue(value: unknown): string {
  return typeof value === "string" && value !== "null" ? value : "";
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function hookDetails(
  run: RunRecord,
  assessment: Extract<WatchdogRunAssessment, { outcome: "stalled" }>,
): Record<string, string> {
  return {
    run_id: run.id,
    last_agent: assessment.lastAgent,
    last_agent_status: assessment.lastAgentStatus,
    pending_agents: assessment.pendingAgents.join(",") || "none",
    task_id: run.taskId || "",
  };
}

export async function dispatchExecutableWatchdogHooks(input: WatchdogHookInput): Promise<void> {
  mkdirSync(input.hooksDir, { recursive: true });
  const ledgerPath = join(input.hooksDir, "dispatch.jsonl");
  if (hookDispatchCompleted(ledgerPath, input.idempotencyKey)) return;
  const claimDir = join(
    input.hooksDir,
    ".dispatch-claims",
    stableFileKey(input.idempotencyKey),
  );

  await withExclusiveFileClaim(claimDir, async () => {
    if (hookDispatchCompleted(ledgerPath, input.idempotencyKey)) return;
    const hooks = readdirSync(input.hooksDir)
      .filter((name) => name.endsWith(".sh"))
      .map((name) => join(input.hooksDir, name))
      .filter((path) => {
        try {
          const stat = statSync(path);
          return stat.isFile() && (stat.mode & 0o111) !== 0;
        } catch {
          return false;
        }
      });
    appendJsonl(ledgerPath, {
      status: "claimed",
      idempotencyKey: input.idempotencyKey,
      event: input.event,
      runId: input.runId,
      hooks,
      details: input.details,
      timestamp: new Date().toISOString(),
    });

    try {
      const results = await Promise.allSettled(
        hooks.map((hook) => runWatchdogHook(hook, input)),
      );
      for (const result of results) {
        if (result.status === "rejected") throw result.reason;
      }
    } catch (error) {
      appendJsonl(ledgerPath, {
        status: "failed",
        idempotencyKey: input.idempotencyKey,
        event: input.event,
        runId: input.runId,
        hooks,
        error: errorMessage(error),
        timestamp: new Date().toISOString(),
      });
      throw error;
    }

    appendJsonl(ledgerPath, {
      status: "completed",
      idempotencyKey: input.idempotencyKey,
      event: input.event,
      runId: input.runId,
      hooks,
      details: input.details,
      timestamp: new Date().toISOString(),
    });
  });
}

function isProtectedStandaloneSession(name: string, terminalReferences: Set<string>): boolean {
  if (name.startsWith("monitor-")) return false;
  return PROTECTED_SESSION_PREFIXES.some((prefix) => name === prefix || name.startsWith(prefix))
    || !terminalReferences.has(name);
}

function hookDispatchCompleted(ledgerPath: string, idempotencyKey: string): boolean {
  return readJsonl(ledgerPath).some((record) => (
    record.status === "completed" && record.idempotencyKey === idempotencyKey
  ));
}

function readJsonl(path: string): Array<Record<string, unknown>> {
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const parsed = JSON.parse(line);
          return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? [parsed] : [];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function appendJsonl(path: string, value: Record<string, unknown>): void {
  appendFileSync(path, `${JSON.stringify(value)}\n`);
}

function runWatchdogHook(hook: string, input: WatchdogHookInput): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutMs = input.timeoutMs ?? HOOK_TIMEOUT_MS;
    const killGraceMs = input.killGraceMs ?? 1_000;
    const child = spawn("/bin/bash", [hook, input.event, input.runId, JSON.stringify(input.details)], {
      stdio: "ignore",
      detached: true,
      env: {
        ...process.env,
        MENTIKO_WATCHDOG_DISPATCH_KEY: input.idempotencyKey,
      },
    });
    let settled = false;
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      signalHookProcess(child.pid, "SIGTERM", () => child.kill("SIGTERM"));
      killTimer = setTimeout(() => {
        signalHookProcess(child.pid, "SIGKILL", () => child.kill("SIGKILL"));
      }, killGraceMs);
    }, timeoutMs);
    child.once("error", (error) => finish(error));
    child.once("exit", (code, signal) => {
      if (timedOut) finish(new Error(`watchdog hook timed out after ${timeoutMs}ms: ${hook}`));
      else if (code === 0) finish();
      else finish(new Error(`watchdog hook failed (${code ?? signal ?? "unknown"}): ${hook}`));
    });
  });
}

function signalHookProcess(
  pid: number | undefined,
  signal: NodeJS.Signals,
  fallback: () => boolean,
): void {
  if (pid) {
    try {
      process.kill(-pid, signal);
      return;
    } catch {
      // The process may not have become a group leader yet; target the child.
    }
  }
  try { fallback(); } catch {}
}

function stableFileKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
