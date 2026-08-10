import { existsSync, readFileSync } from "fs";
import { randomBytes } from "crypto";
import {
  withRunJsonLock,
  writeRunJsonAtomic,
  writeRunJsonExclusive,
} from "@/lib/runs/run-json-lock";
import {
  assertRunRecord,
  parseRunRecord,
  requireRunId,
  type AgentStatus,
  type RunAgentRecord,
  type RunRecord,
  type RunStatus,
} from "@/lib/runs/run-record";
import { clearPendingHandoffAgent } from "@/lib/runner-v2/handoff-liveness";

export type { AgentStatus, RunAgentRecord, RunRecord, RunStatus } from "@/lib/runs/run-record";

export interface RunJsonMutation {
  before: RunRecord | undefined;
  after: RunRecord;
}

export type RunMutationObserver = (mutation: RunJsonMutation) => void;

export interface RunAgentAttemptGuard {
  runId: string;
  agentId: string;
  attemptId: string;
}

export class StaleRunAgentAttemptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaleRunAgentAttemptError";
  }
}

export interface CreateRunRecordInput {
  runId?: string;
  chainName: string;
  goal: string;
  parentRunId?: string;
  workspacePath?: string;
  taskId?: string;
  now?: Date;
}

const TERMINAL_RUN_STATUSES = new Set(["blocked", "failed", "stopped", "completed", "cancelled"]);
const TERMINAL_AGENT_STATUSES = new Set(["complete", "failed", "cancelled", "error"]);

/** A routed child may not revive a run already terminalized by completion. */
export class TerminalRunRevivalError extends Error {}

function nowIso(now = new Date()): string {
  return now.toISOString();
}

function newRunId(): string {
  return `run-${Date.now()}-${randomBytes(4).toString("hex")}`;
}

export function createRunRecord(input: CreateRunRecordInput): RunRecord {
  return {
    id: input.runId === undefined ? newRunId() : requireRunId(input.runId),
    chain: input.chainName,
    ...(input.parentRunId ? { parent_run_id: input.parentRunId } : {}),
    ...(input.workspacePath ? { workspacePath: input.workspacePath } : {}),
    ...(input.taskId ? { taskId: input.taskId } : {}),
    goal: input.goal,
    started: nowIso(input.now),
    status: "pending",
    sessions: [],
    agents: [],
  };
}

export function readRunJson(runJsonPath: string): RunRecord {
  return parseRunRecord(readFileSync(runJsonPath, "utf-8"));
}

export function updateRunJson(
  runJsonPath: string,
  update: (run: RunRecord | undefined) => RunRecord,
  onLockTimeout?: (lockDir: string) => void,
  onMutation?: RunMutationObserver,
): RunRecord {
  return withRunJsonLock(runJsonPath, () => {
    const current = existsSync(runJsonPath) ? readRunJson(runJsonPath) : undefined;
    const next = update(current);
    assertRunRecord(next);
    if (current && next.id !== current.id) {
      throw new Error(`run.json mutation cannot change id from ${current.id} to ${next.id}`);
    }
    if (current) writeRunJsonAtomic(runJsonPath, next);
    else writeRunJsonExclusive(runJsonPath, next);
    // Journal the persisted representation, not the in-memory object. JSON
    // serialization drops explicit `undefined` properties; rollback compares
    // against what another reader can actually observe on disk.
    onMutation?.({ before: current, after: readRunJson(runJsonPath) });
    return next;
  }, onLockTimeout);
}

export function updateRunStatus(
  runJsonPath: string,
  status: RunStatus,
  statusMessage?: string,
  now = new Date(),
  onMutation?: RunMutationObserver,
  attemptGuard?: RunAgentAttemptGuard,
): RunRecord {
  return updateRunJson(runJsonPath, (current) => {
    if (!current) throw new Error(`run.json not found: ${runJsonPath}`);
    if (attemptGuard) assertRunAgentAttemptCurrent(current, attemptGuard);
    const successfulTerminal = status === "completed";
    const active = status === "running";
    return {
      ...current,
      status,
      ...(statusMessage
        ? { status_message: statusMessage }
        : successfulTerminal || active ? { status_message: undefined } : {}),
      ...(TERMINAL_RUN_STATUSES.has(status) && (!current.completed || (successfulTerminal && current.status !== "completed"))
        ? { completed: nowIso(now) }
        : active ? { completed: undefined } : {}),
    };
  }, undefined, onMutation);
}

export function addRunSession(
  runJsonPath: string,
  sessionName: string,
  agentId: string,
  agentName = agentId,
  now = new Date()
): RunRecord {
  return updateRunJson(runJsonPath, (current) => {
    if (!current) throw new Error(`run.json not found: ${runJsonPath}`);
    // A watchdog stop is deliberately provisional until the watchdog has
    // emitted an event, queued an effect, or dispatched a hook. A PTY can
    // finish registering between its pre-mutation daemon read and final
    // recheck; that real registration must win without reviving any
    // externally-observed terminal run.
    const revivableWatchdogStop = isRevivableWatchdogStop(current);
    if (TERMINAL_RUN_STATUSES.has(current.status) && !revivableWatchdogStop) {
      throw new TerminalRunRevivalError(
        `cannot add session ${sessionName}: run ${current.id} is terminal (${current.status})`,
      );
    }
    const agents = [...(current.agents || [])];
    const existing = agents.findIndex((agent) => agent.id === agentId);
    const nextAgent: RunAgentRecord = {
      ...(existing >= 0 ? agents[existing] : {}),
      id: agentId,
      name: agentName,
      session: sessionName,
      status: "running",
      completed: undefined,
      started: (existing >= 0 ? agents[existing].started : undefined) || nowIso(now),
    };
    if (existing >= 0) agents[existing] = nextAgent;
    else agents.push(nextAgent);

    const runnerV2 = clearPendingHandoffAgent(current.runnerV2, agentId);
    if (revivableWatchdogStop && runnerV2) {
      delete runnerV2.watchdog;
    }
    return {
      ...current,
      status: "running",
      completed: undefined,
      status_message: undefined,
      ...(runnerV2 ? { runnerV2 } : {}),
      sessions: Array.from(new Set([...(current.sessions || []), sessionName])),
      agents,
    };
  });
}

function isRevivableWatchdogStop(run: RunRecord): boolean {
  if (run.status !== "stopped" || !run.runnerV2 || typeof run.runnerV2 !== "object") return false;
  const watchdog = (run.runnerV2 as Record<string, unknown>).watchdog;
  if (!watchdog || typeof watchdog !== "object" || Array.isArray(watchdog)) return false;
  const marker = watchdog as Record<string, unknown>;
  return marker.status === "stalled"
    && !marker.eventEmittedAt
    && !marker.externalEffectsQueuedAt
    && !marker.hooksDispatchedAt;
}

export function updateRunAgent(
  runJsonPath: string,
  agentId: string,
  status: AgentStatus,
  now = new Date(),
  onMutation?: RunMutationObserver,
  attemptGuard?: RunAgentAttemptGuard,
): RunRecord {
  return updateRunJson(runJsonPath, (current) => {
    if (!current) throw new Error(`run.json not found: ${runJsonPath}`);
    if (attemptGuard) assertRunAgentAttemptCurrent(current, attemptGuard);
    return {
      ...current,
      agents: (current.agents || []).map((agent) => {
        if (agent.id !== agentId) return agent;
        return {
          ...agent,
          status,
          ...(TERMINAL_AGENT_STATUSES.has(status) && !agent.completed ? { completed: nowIso(now) } : {}),
        };
      }),
    };
  }, undefined, onMutation);
}

export function assertRunAgentAttemptCurrent(
  run: RunRecord,
  guard: RunAgentAttemptGuard,
): void {
  if (run.id !== guard.runId) {
    throw new Error(`completion run identity mismatch: ${run.id} !== ${guard.runId}`);
  }
  const runnerV2 = run.runnerV2;
  const attempts = runnerV2 && typeof runnerV2 === "object" && !Array.isArray(runnerV2)
    ? (runnerV2 as { attempts?: unknown }).attempts
    : undefined;
  const records = Array.isArray(attempts)
    ? attempts.filter((attempt): attempt is { id: string; runId: string; agentId: string } => (
      Boolean(attempt)
      && typeof attempt === "object"
      && !Array.isArray(attempt)
      && typeof (attempt as Record<string, unknown>).id === "string"
      && typeof (attempt as Record<string, unknown>).runId === "string"
      && typeof (attempt as Record<string, unknown>).agentId === "string"
    ))
    : [];
  const owned = records.filter((attempt) => (
    attempt.runId === guard.runId && attempt.agentId === guard.agentId
  ));
  const exact = owned.find((attempt) => attempt.id === guard.attemptId);
  if (!exact) {
    throw new Error(`completion AgentAttempt not found: ${guard.attemptId}`);
  }
  const current = owned.at(-1);
  if (current?.id !== guard.attemptId) {
    throw new StaleRunAgentAttemptError(
      `stale completion AgentAttempt ${guard.attemptId}; current attempt is ${current?.id || "unknown"}`,
    );
  }
}
