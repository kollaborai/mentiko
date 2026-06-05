// shared state file reader for run API routes
// state files are written by agents during execution and provide
// real-time status that's more accurate than run.json

import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";

export interface AgentState {
  agent_id: string;
  status: string;
  session: string;
  emits?: string;
  started?: string;
  completed?: string;
}

function parseStateFile(content: string): Record<string, string> {
  return content.split("\n").reduce((acc, line) => {
    const [key, ...rest] = line.split(":");
    if (key && rest.length > 0) acc[key.trim()] = rest.join(":").trim();
    return acc;
  }, {} as Record<string, string>);
}

// parse all .state files in a run's state directory.
// falls back to searching the global namespace state dir by run ID when
// no run-specific state dir exists (legacy layout).
export function readAgentStates(runDir: string): Record<string, AgentState> {
  const states: Record<string, AgentState> = {};

  function loadStateDir(dir: string, runIdFilter?: string) {
    if (!existsSync(dir)) return;
    const files = readdirSync(dir).filter((f) => f.endsWith(".state"));
    for (const file of files) {
      try {
        const content = readFileSync(join(dir, file), "utf-8");
        const lines = parseStateFile(content);
        // if filtering by run ID, skip state files for other runs
        if (runIdFilter && lines.session && !lines.session.includes(runIdFilter)) continue;
        const agentId = lines.agent_id || file.replace(".state", "");
        states[agentId] = {
          agent_id: agentId,
          status: lines.status || "unknown",
          session: lines.session || "",
          emits: lines.emits,
          started: lines.started,
          completed: lines.completed,
        };
      } catch { /* skip bad state files */ }
    }
  }

  // primary: run-specific state dir
  const runStateDir = join(runDir, "state");
  if (existsSync(runStateDir)) {
    loadStateDir(runStateDir);
    return states;
  }

  // fallback: global namespace state dir, filtered by run ID
  const runId = runDir.split("/").pop() || "";
  const globalStateDir = join(runDir, "..", "..", "state");
  loadStateDir(globalStateDir, runId);

  return states;
}

// phantom agent IDs that are branch termination values, not real agents
const PHANTOM_AGENT_IDS = new Set(["stop"]);

// overlay state file data onto run.json agents.
// state files are only authoritative for agents with status=running in run.json.
// if run.json says stopped/cancelled/complete/error, that's the final word -
// stale state files from crashed runs must not override terminal statuses.
export function mergeAgentStates<T extends { id: string; status: string; session: string }>(
  agents: T[],
  states: Record<string, AgentState>,
  runStatus?: string
): (T & { emits?: string; started?: string; completed?: string })[] {
  const runIsTerminal = runStatus && runStatus !== "running" && runStatus !== "pending";

  return agents
    .filter((agent) => !PHANTOM_AGENT_IDS.has(agent.id))
    .map((agent) => {
      const live = states[agent.id];
      const base = agent as T & { started?: string; completed?: string };

      // if agent has a terminal status in run.json (stopped/cancelled/complete/error),
      // don't let a stale state file override it back to "running"
      const agentIsTerminal = ["complete", "stopped", "cancelled", "error", "blocked"].includes(agent.status);
      const useStateStatus = live?.status && !agentIsTerminal && !(runIsTerminal && live.status === "running");

      return {
        ...agent,
        status: useStateStatus ? live.status : agent.status,
        session: live?.session || agent.session,
        emits: live?.emits,
        started: base.started || live?.started,
        completed: base.completed || live?.completed,
      };
    });
}
