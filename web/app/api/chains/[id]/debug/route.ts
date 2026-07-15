import { NextRequest } from "next/server";
import { readFileSync, existsSync, writeFileSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";
import config from "@/lib/config";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { checkAuth } from "@/lib/auth/api-auth";
import { pty } from "@/lib/pty/pty-client";
import { findRunnerAgentStateBySession } from "@/lib/runner-v2/agent-state";

export const dynamic = "force-dynamic";

const DEBUG_DIR = config.debugDir;
const AGENTS_DIR = config.agentsDir;

// Types
interface AgentInfo {
  id: string;
  session?: string;
  prompt?: string;
  role?: string;
  triggers?: string[];
  emits?: string;
  authorities?: string[];
}

interface InspectData {
  agentId: string;
  stateRaw?: string | null;
  statePath?: string;
  state?: unknown;
  messages?: Array<{ role: string; content: string }>;
  prompt?: string;
  context?: {
    triggers: string[];
    emits?: string;
    authorities?: string[];
  };
}

interface SessionStateMatch {
  statePath: string;
  state: unknown;
  isRunnerAgentState: boolean;
}

// Runner-agent state has a typed canonical owner. The remaining scan below is
// deliberately only for generic JSON/YAML debug artifacts, never `.state`.
function getSessionState(sessionName: string): SessionStateMatch | null {
  const runnerState = findRunnerAgentStateBySession(config.stateDir, sessionName);
  if (runnerState) {
    return { statePath: runnerState.path, state: runnerState.state, isRunnerAgentState: true };
  }
  try {
    const stateDir = join(AGENTS_DIR, "state");
    if (!existsSync(stateDir)) return null;

    const stateFiles = readdirSync(stateDir).filter((f: string) =>
      f.endsWith(".json") || f.endsWith(".yaml") || f.endsWith(".yml")
    );
    for (const file of stateFiles) {
      const filePath = join(stateDir, file);
      try {
        const content = readFileSync(filePath, "utf-8");
        if (content.includes(`session: ${sessionName}`) ||
            content.includes(`session: "${sessionName}"`) ||
            content.includes(`'${sessionName}'`) ||
            content.includes(`agent_id: ${sessionName}`)) {
          return { statePath: filePath, state: undefined, isRunnerAgentState: false };
        }
      } catch {
        // skip invalid files
      }
    }
    return null;
  } catch {
    return null;
  }
}

// Helper: read state file raw content
function readStateRaw(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

// Helper: check if session exists via pty-manager
async function getSessionConversation(sessionName: string): Promise<Array<{ role: string; content: string }> | null> {
  try {
    const sessions = await pty.list();
    const exists = sessions.some((s) => s.name === sessionName);
    if (!exists) return null;
    // placeholder - actual conversation reading would need
    // integration with the agent's conversation storage
    return null;
  } catch {
    return null;
  }
}

// GET - read debug state for a run, or inspect specific agent
export const GET = withErrorHandling(async (
  request: NextRequest,
  _context: { params: Promise<{ id: string }> }
) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { id } = await _context.params;
  const runId = decodeURIComponent(id);
  const url = new URL(request.url);
  const agentId = url.searchParams.get("agent");

  // agent inspection mode
  if (agentId) {
    const inspectData: InspectData = { agentId };

    // try to find state file for this agent
    const runDir = join(AGENTS_DIR, "runs", runId);
    if (existsSync(runDir)) {
      // read run.json to find session
      const runJsonPath = join(runDir, "run.json");
      if (existsSync(runJsonPath)) {
        const runData = JSON.parse(readFileSync(runJsonPath, "utf-8"));
        const agentInfo = runData.agents?.find((a: AgentInfo) => a.id === agentId);
        if (agentInfo?.session) {
          const stateMatch = getSessionState(agentInfo.session);
          if (stateMatch && existsSync(stateMatch.statePath)) {
            inspectData.stateRaw = readStateRaw(stateMatch.statePath);
            inspectData.statePath = stateMatch.statePath;

            try {
              inspectData.state = stateMatch.isRunnerAgentState
                ? stateMatch.state
                : JSON.parse(readFileSync(stateMatch.statePath, "utf-8"));
            } catch {
              // Keep the raw diagnostic view when a generic debug artifact is invalid.
            }
          }

          const conversation = await getSessionConversation(agentInfo.session);
          if (conversation) {
            inspectData.messages = conversation;
          }
        }
      }

      // read chain.json for agent prompt
      const chainPath = join(runDir, "chain.json");
      if (existsSync(chainPath)) {
        const chainData = JSON.parse(readFileSync(chainPath, "utf-8"));
        const agent = chainData.agents?.find((a: AgentInfo) => a.id === agentId);
        if (agent) {
          inspectData.prompt = agent.prompt || agent.role;
          inspectData.context = {
            triggers: agent.triggers || [],
            emits: agent.emits,
            authorities: agent.authorities,
          };
        }
      }
    }

    return apiSuccess(inspectData);
  }

  // normal debug state mode
  const debugFile = join(DEBUG_DIR, `${runId}.json`);

  if (!existsSync(debugFile)) {
    return apiSuccess({
      status: "idle",
      current_step: null,
      steps: [],
    });
  }

  const content = readFileSync(debugFile, "utf-8");
  return apiSuccess(JSON.parse(content));
});

// POST - control debug run (continue/skip/retry/abort/pause/step)
export const POST = withErrorHandling(async (
  request: NextRequest,
  _context: { params: Promise<{ id: string }> }
) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { id } = await _context.params;
  const runId = decodeURIComponent(id);
  const { action, stepIndex, breakpoints } = await request.json();

  const debugFile = join(DEBUG_DIR, `${runId}.json`);

  if (!existsSync(debugFile)) {
    const initialState = {
      status: "initialized",
      current_step: null,
      steps: [],
      breakpoints: breakpoints || [],
      last_action: action,
      last_action_at: new Date().toISOString(),
    };
    writeFileSync(debugFile, JSON.stringify(initialState, null, 2));
    return apiSuccess({ success: true, state: initialState });
  }

  const state = JSON.parse(readFileSync(debugFile, "utf-8"));

  switch (action) {
    case "pause":
      state.status = "paused";
      state.last_action = "pause";
      state.last_action_at = new Date().toISOString();
      break;

    case "continue":
    case "resume":
      state.status = "running";
      state.last_action = action;
      state.last_action_at = new Date().toISOString();
      break;

    case "step":
      state.status = "stepping";
      state.current_step = typeof stepIndex === "number" ? stepIndex : (state.current_step ?? -1) + 1;
      state.last_action = "step";
      state.last_action_at = new Date().toISOString();
      break;

    case "skip":
      state.last_action = "skip";
      state.last_action_at = new Date().toISOString();
      if (typeof stepIndex === "number" && state.steps[stepIndex]) {
        state.steps[stepIndex].status = "skipped";
      }
      break;

    case "retry":
      state.last_action = "retry";
      state.last_action_at = new Date().toISOString();
      if (typeof stepIndex === "number" && state.steps[stepIndex]) {
        state.steps[stepIndex].status = "pending";
      }
      break;

    case "abort":
      state.last_action = "abort";
      state.last_action_at = new Date().toISOString();
      state.status = "aborted";
      break;

    case "set_breakpoints":
      state.breakpoints = breakpoints || [];
      state.last_action = "set_breakpoints";
      state.last_action_at = new Date().toISOString();
      break;

    default:
      throw new BadRequest("Invalid action");
  }

  writeFileSync(debugFile, JSON.stringify(state, null, 2));

  return apiSuccess({ success: true, state });
});

// DELETE - clear debug state
export const DELETE = withErrorHandling(async (
  request: NextRequest,
  _context: { params: Promise<{ id: string }> }
) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { id } = await _context.params;
  const runId = decodeURIComponent(id);
  const debugFile = join(DEBUG_DIR, `${runId}.json`);

  if (existsSync(debugFile)) {
    unlinkSync(debugFile);
  }

  return apiSuccess({ success: true, message: "Debug state cleared" });
});
