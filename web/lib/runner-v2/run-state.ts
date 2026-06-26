import { existsSync, readFileSync } from "fs";
import { randomBytes } from "crypto";
import { withRunJsonLock, writeRunJsonAtomic } from "@/lib/runs/run-json-lock";

export type RunStatus = "pending" | "running" | "blocked" | "failed" | "stopped" | "completed";
export type AgentStatus = "pending" | "running" | "blocked" | "failed" | "stopped" | "cancelled" | "complete" | "error";

export interface RunAgentRecord {
  id: string;
  name: string;
  session: string;
  status: AgentStatus | string;
  started?: string;
  completed?: string;
  [key: string]: unknown;
}

export interface RunRecord {
  id: string;
  chain: string;
  goal: string;
  started: string;
  status: RunStatus | string;
  sessions: string[];
  agents: RunAgentRecord[];
  parent_run_id?: string;
  workspacePath?: string;
  taskId?: string;
  completed?: string;
  status_message?: string;
  [key: string]: unknown;
}

export interface CreateRunRecordInput {
  chainName: string;
  goal: string;
  parentRunId?: string;
  workspacePath?: string;
  taskId?: string;
  now?: Date;
}

const TERMINAL_RUN_STATUSES = new Set(["blocked", "failed", "stopped", "completed"]);
const TERMINAL_AGENT_STATUSES = new Set(["complete", "failed", "cancelled", "error"]);

function nowIso(now = new Date()): string {
  return now.toISOString();
}

function newRunId(): string {
  return `run-${Date.now()}-${randomBytes(4).toString("hex")}`;
}

export function createRunRecord(input: CreateRunRecordInput): RunRecord {
  return {
    id: newRunId(),
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
  return JSON.parse(readFileSync(runJsonPath, "utf-8")) as RunRecord;
}

export function updateRunJson(
  runJsonPath: string,
  update: (run: RunRecord | undefined) => RunRecord,
  onLockTimeout?: (lockDir: string) => void
): RunRecord {
  return withRunJsonLock(runJsonPath, () => {
    const current = existsSync(runJsonPath) ? readRunJson(runJsonPath) : undefined;
    const next = update(current);
    writeRunJsonAtomic(runJsonPath, next);
    return next;
  }, onLockTimeout);
}

export function updateRunStatus(
  runJsonPath: string,
  status: RunStatus,
  statusMessage?: string,
  now = new Date()
): RunRecord {
  return updateRunJson(runJsonPath, (current) => {
    if (!current) throw new Error(`run.json not found: ${runJsonPath}`);
    return {
      ...current,
      status,
      ...(statusMessage ? { status_message: statusMessage } : {}),
      ...(TERMINAL_RUN_STATUSES.has(status) && !current.completed ? { completed: nowIso(now) } : {}),
    };
  });
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
    const nextAgent = {
      ...(existing >= 0 ? agents[existing] : {}),
      id: agentId,
      name: agentName,
      session: sessionName,
      status: "running",
      started: (existing >= 0 ? agents[existing].started : undefined) || nowIso(now),
    };
    if (existing >= 0) agents[existing] = nextAgent;
    else agents.push(nextAgent);

    return {
      ...current,
      status: "running",
      completed: undefined,
      sessions: Array.from(new Set([...(current.sessions || []), sessionName])),
      agents,
    };
  });
}

export function updateRunAgent(
  runJsonPath: string,
  agentId: string,
  status: AgentStatus,
  now = new Date()
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
  });
}
