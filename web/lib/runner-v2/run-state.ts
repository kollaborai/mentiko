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
): RunRecord {
  return updateRunJson(runJsonPath, (current) => {
    if (!current) throw new Error(`run.json not found: ${runJsonPath}`);
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
    const agents = [...(current.agents || [])];
    const existing = agents.findIndex((agent) => agent.id === agentId);
    const nextAgent: RunAgentRecord = {
      ...(existing >= 0 ? agents[existing] : {}),
      id: agentId,
      name: agentName,
      session: sessionName,
      status: "running",
      started: (existing >= 0 ? agents[existing].started : undefined) || nowIso(now),
    };
    if (existing >= 0) agents[existing] = nextAgent;
    else agents.push(nextAgent);

    const runnerV2 = clearPendingHandoffAgent(current.runnerV2, agentId);
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

export function updateRunAgent(
  runJsonPath: string,
  agentId: string,
  status: AgentStatus,
  now = new Date(),
  onMutation?: RunMutationObserver,
): RunRecord {
  return updateRunJson(runJsonPath, (current) => {
    if (!current) throw new Error(`run.json not found: ${runJsonPath}`);
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
