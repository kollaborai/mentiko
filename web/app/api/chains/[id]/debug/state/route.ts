import { NextRequest } from "next/server";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import config from "@/lib/config";
import { Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { checkAuth } from "@/lib/auth/api-auth";
import { scanRunnerEventFiles } from "@/lib/runner-v2/event-lifecycle";

export const dynamic = "force-dynamic";

const STATE_DIR = config.stateDir;
const RUNS_DIR = config.runsDir;

interface StateSnapshot {
  timestamp: string;
  run_id: string;
  chain_id: string;
  status: "running" | "paused" | "idle";
  current_agent: CurrentAgentInfo | null;
  variables: VariableScope;
  recent_output: OutputEntry[];
  pending_events: PendingEvent[];
}

interface CurrentAgentInfo {
  id: string;
  name: string;
  role: string;
  session: string;
  started_at: string;
  status: "running" | "waiting" | "error";
}

interface VariableScope {
  global: Record<string, VariableValue>;
  chain: Record<string, VariableValue>;
  agent: Record<string, VariableValue>;
}

interface VariableValue {
  value: unknown;
  type: "string" | "number" | "boolean" | "object" | "array" | "null";
  updated_at: string;
  source: string;
}

interface OutputEntry {
  timestamp: string;
  source: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
}

interface QueueEvent {
  id?: string;
  type: string;
  source?: string;
  target?: string;
  payload?: Record<string, unknown>;
  data?: Record<string, unknown>;
  created_at?: string;
  timestamp?: string;
}

interface PendingEvent {
  id: string;
  type: string;
  source: string | undefined;
  target: string | undefined;
  payload: Record<string, unknown>;
  created_at: string;
}

interface RunData {
  agents?: Array<{id: string; name: string; role: string; session?: string; started_at?: string; status?: string}>;
  status?: string;
}

interface ChainData {
  name?: string;
  version?: string;
  agents?: Array<unknown>;
}

function getType(value: unknown): "string" | "number" | "boolean" | "object" | "array" | "null" {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const type = typeof value;
  if (type === "string" || type === "number" || type === "boolean") return type;
  return "object";
}

function readStateFile(sessionName: string): Record<string, unknown> | null {
  try {
    const stateFiles = readdirSync(STATE_DIR).filter((f) => f.endsWith(".json"));
    for (const file of stateFiles) {
      const filePath = join(STATE_DIR, file);
      try {
        const content = JSON.parse(readFileSync(filePath, "utf-8"));
        if (content.session === sessionName || content.agent_id === sessionName) {
          return content;
        }
      } catch {
        continue;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function readRunState(runId: string): { runData: unknown; chainData: unknown } | null {
  try {
    const runDir = join(RUNS_DIR, runId);
    if (!existsSync(runDir)) return null;

    const runJsonPath = join(runDir, "run.json");
    const chainJsonPath = join(runDir, "chain.json");

    const runData = existsSync(runJsonPath)
      ? JSON.parse(readFileSync(runJsonPath, "utf-8"))
      : null;
    const chainData = existsSync(chainJsonPath)
      ? JSON.parse(readFileSync(chainJsonPath, "utf-8"))
      : null;

    return { runData, chainData };
  } catch {
    return null;
  }
}

function outputLevel(value: string | undefined): OutputEntry["level"] {
  return value === "warn" || value === "error" || value === "debug" ? value : "info";
}

/**
 * Debug output follows the same physical event contract as the runner. Only
 * strict canonical `.event` files from the configured root are visible;
 * malformed files and obsolete JSON event artifacts fail closed.
 */
function getRecentOutput(runId: string, limit = 20): OutputEntry[] {
  const eventsDir = config.eventsDir;
  try {
    return scanRunnerEventFiles(eventsDir).valid
      .filter(({ event }) => event.runId === runId)
      .map(({ event }) => ({
        timestamp: event.timestamp,
        source: event.source,
        level: outputLevel(event.fields.level),
        message: event.fields.message || event.event,
      }))
      .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
      .slice(0, limit);
  } catch {
    return [];
  }
}

function getPendingEvents(runId: string): PendingEvent[] {
  try {
    const runDir = join(RUNS_DIR, runId);
    const queuePath = join(runDir, "queue.json");
    if (!existsSync(queuePath)) return [];

    const queue = JSON.parse(readFileSync(queuePath, "utf-8"));
    const events = queue.pending || queue.events || [];

    return events.map((e: QueueEvent) => ({
      id: e.id || `${e.type}-${Date.now()}`,
      type: e.type,
      source: e.source,
      target: e.target,
      payload: e.payload || e.data || {},
      created_at: e.created_at || e.timestamp || new Date().toISOString(),
    }));
  } catch {
    return [];
  }
}

export const GET = withErrorHandling(async (
  request: NextRequest,
  _context: { params: Promise<{ id: string }> }
) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { id } = await _context.params;
  const chainId = decodeURIComponent(id);

  const runState = readRunState(chainId);
  if (!runState?.runData) {
    return apiSuccess<Partial<StateSnapshot>>({
      timestamp: new Date().toISOString(),
      run_id: chainId,
      chain_id: chainId,
      status: "idle",
      current_agent: null,
      variables: { global: {}, chain: {}, agent: {} },
      recent_output: [],
      pending_events: [],
    });
  }

  const { runData, chainData } = runState;
  const currentAgentStep = (runData as RunData | null)?.agents?.find((a) => a.status === "running");

  const currentAgent: CurrentAgentInfo | null = currentAgentStep
    ? {
        id: currentAgentStep.id,
        name: currentAgentStep.name,
        role: currentAgentStep.role,
        session: currentAgentStep.session || "",
        started_at: currentAgentStep.started_at || new Date().toISOString(),
        status: "running",
      }
    : null;

  const agentState = currentAgent?.session ? readStateFile(currentAgent.session) : {};

  const variables: VariableScope = {
    global: {
      run_id: { value: chainId, type: "string", updated_at: new Date().toISOString(), source: "system" },
      namespace_id: { value: config.namespaceId, type: "string", updated_at: new Date().toISOString(), source: "system" },
      timestamp: { value: new Date().toISOString(), type: "string", updated_at: new Date().toISOString(), source: "system" },
    },
    chain: {
      chain_name: { value: (chainData as ChainData | null)?.name || "", type: "string", updated_at: new Date().toISOString(), source: "chain" },
      version: { value: (chainData as ChainData | null)?.version || "1.0", type: "string", updated_at: new Date().toISOString(), source: "chain" },
      agent_count: { value: (chainData as ChainData | null)?.agents?.length || 0, type: "number", updated_at: new Date().toISOString(), source: "chain" },
    },
    agent: {},
  };

  if (agentState && typeof agentState === "object") {
    for (const [key, value] of Object.entries(agentState)) {
      if (key === "session" || key === "agent_id") continue;
      variables.agent[key] = {
        value,
        type: getType(value),
        updated_at: new Date().toISOString(),
        source: currentAgent?.id || "unknown",
      };
    }
  }

  const recentOutput = getRecentOutput(chainId);
  const pendingEvents = getPendingEvents(chainId);

  const status = (runData as RunData | null)?.status;
  const validStatus: "running" | "paused" | "idle" =
    status === "running" || status === "paused" || status === "idle"
      ? status
      : "running";

  const snapshot: StateSnapshot = {
    timestamp: new Date().toISOString(),
    run_id: chainId,
    chain_id: chainId,
    status: validStatus,
    current_agent: currentAgent,
    variables,
    recent_output: recentOutput.slice(0, 10),
    pending_events: pendingEvents.slice(0, 10),
  };

  return apiSuccess(snapshot);
});
