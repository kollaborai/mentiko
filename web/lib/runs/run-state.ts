// -------------------------------------------------------------------
// run-state.ts — Shared state file reader for run API routes.
// -------------------------------------------------------------------
// State files are written by agents during execution and provide
// real-time status that's more accurate than run.json. The engine
// updates .state files immediately on agent lifecycle events, while
// run.json is written less frequently for durability.
//
// WHY state files exist: run.json is updated only at agent start/completion
// to minimize disk writes during active execution. .state files provide
// live status between those checkpoints.
//
// PHANTOM AGENTS: Branch termination values like "stop" create fake agent
// entries in run.json. These are NOT real agents and must be filtered from
// UI displays and state calculations.
//
// TERMINAL STATUS OVERRIDE: When run.json shows a terminal status
// (stopped/cancelled/complete/error), that's the FINAL word. Stale state
// files from crashed runs must NOT override terminal statuses back to
// "running". This prevents displaying incorrect live status for runs
// that already ended.
// -------------------------------------------------------------------

import {
  readRunnerAgentStateDirectory,
  type RunnerAgentState,
} from "@/lib/runner-v2/agent-state";

export type AgentState = RunnerAgentState;

// Select only records for a run from the explicit namespace-scoped canonical
// state root. There is no alternate-location lookup.
export function readAgentStates(stateDir: string, runId: string): Record<string, AgentState> {
  return readRunnerAgentStateDirectory(stateDir, runId);
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
