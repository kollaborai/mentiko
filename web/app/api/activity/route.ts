import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { getNamespaceConfig } from "@/lib/namespace-config";
import { checkAuth } from "@/lib/auth/api-auth";
import { Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

interface Run {
  id: string;
  chain: string;
  chainId?: string;
  goal: string;
  started: string;
  completed?: string;
  status: string;
  agents?: Array<{ id: string; name?: string; status: string }>;
}

interface AgentState {
  status: string;
  session: string;
  agent_id: string;
  started?: string;
  completed?: string;
}

interface ActivityEvent {
  id: string;
  type: "chain_started" | "chain_completed" | "chain_failed" | "agent_started" | "agent_completed" | "schedule_triggered" | "error" | "system";
  title: string;
  message: string;
  timestamp: string;
  metadata: {
    runId?: string;
    agentId?: string;
    chainId?: string;
    chainName?: string;
    agentName?: string;
    status?: string;
  };
}

function parseStateFile(content: string): Partial<AgentState> {
  const result: Partial<AgentState> = {};
  const lines = content.split("\n");
  for (const line of lines) {
    const [key, ...rest] = line.split(":");
    if (key && rest.length > 0) {
      const k = key.trim();
      const v = rest.join(":").trim();
      if (k === "status") result.status = v;
      if (k === "session") result.session = v;
      if (k === "agent_id") result.agent_id = v;
      if (k === "started") result.started = v;
      if (k === "completed") result.completed = v;
    }
  }
  return result;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const GET = withErrorHandling(async (request: Request) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const namespaceConfig = await getNamespaceConfig(request);
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get("limit") || "100", 10);
  const filter = searchParams.get("filter") || "all";

  const events: ActivityEvent[] = [];

  // 1. Read runs for chain events
  if (existsSync(namespaceConfig.runsDir)) {
    try {
      const runEntries = readdirSync(namespaceConfig.runsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name.startsWith("run-"))
        .sort((a, b) => b.name.localeCompare(a.name))
        .slice(0, limit);

      for (const entry of runEntries) {
        const runFile = join(namespaceConfig.runsDir, entry.name, "run.json");
        if (!existsSync(runFile)) continue;

        try {
          const content = readFileSync(runFile, "utf-8");
          const run: Run = JSON.parse(content);
          if (!run.id) run.id = entry.name;

          const chainName = run.chain || "Unknown Chain";
          const baseMeta = {
            runId: run.id,
            chainId: run.chainId,
            chainName,
          };

          // Chain started event
          events.push({
            id: generateId(),
            type: "chain_started",
            title: `Chain started: ${chainName}`,
            message: run.goal?.split("\n")[0]?.slice(0, 100) || "No goal specified",
            timestamp: run.started,
            metadata: { ...baseMeta, status: "running" },
          });

          // Chain completed/failed event
          if (run.completed) {
            if (run.status === "completed") {
              events.push({
                id: generateId(),
                type: "chain_completed",
                title: `Chain completed: ${chainName}`,
                message: `Successfully finished execution`,
                timestamp: run.completed,
                metadata: { ...baseMeta, status: "completed" },
              });
            } else if (run.status === "failed") {
              events.push({
                id: generateId(),
                type: "chain_failed",
                title: `Chain failed: ${chainName}`,
                message: `Execution failed`,
                timestamp: run.completed,
                metadata: { ...baseMeta, status: "failed" },
              });
            }
          }

          // Agent events from run
          if (run.agents && Array.isArray(run.agents)) {
            for (const agent of run.agents) {
              const agentName = agent.name || agent.id;
              if (agent.status === "running") {
                events.push({
                  id: generateId(),
                  type: "agent_started",
                  title: `Agent started: ${agentName}`,
                  message: `Running in chain: ${chainName}`,
                  timestamp: run.started,
                  metadata: { ...baseMeta, agentId: agent.id, agentName, status: "running" },
                });
              } else if (agent.status === "completed") {
                events.push({
                  id: generateId(),
                  type: "agent_completed",
                  title: `Agent completed: ${agentName}`,
                  message: `Finished in chain: ${chainName}`,
                  timestamp: run.started,
                  metadata: { ...baseMeta, agentId: agent.id, agentName, status: "completed" },
                });
              }
            }
          }
        } catch {
          // skip invalid run files
        }
      }
    } catch {
      // ignore directory read errors
    }
  }

  // 2. Read state files for agent status changes
  if (existsSync(namespaceConfig.stateDir)) {
    try {
      const stateEntries = readdirSync(namespaceConfig.stateDir, { withFileTypes: true })
        .filter((f) => f.isFile() && f.name.endsWith(".state"))
        .slice(0, limit);

      for (const entry of stateEntries) {
        const stateFile = join(namespaceConfig.stateDir, entry.name);
        try {
          const content = readFileSync(stateFile, "utf-8");
          const state = parseStateFile(content);
          const agentId = state.agent_id || entry.name.replace(".state", "");
          const timestamp = state.completed || state.started || new Date().toISOString();

          if (state.completed === "true" && state.status === "completed") {
            events.push({
              id: generateId(),
              type: "agent_completed",
              title: `Agent completed: ${agentId}`,
              message: `Agent finished successfully`,
              timestamp,
              metadata: { agentId, agentName: agentId, status: "completed" },
            });
          }
        } catch {
          // skip invalid state files
        }
      }
    } catch {
      // ignore directory read errors
    }
  }

  // 3. Read event files
  if (existsSync(namespaceConfig.eventsDir)) {
    try {
      const eventEntries = readdirSync(namespaceConfig.eventsDir, { withFileTypes: true })
        .filter((f) => f.isFile() && (f.name.endsWith(".event") || f.name.endsWith(".md")))
        .slice(0, limit);

      for (const entry of eventEntries) {
        const eventFile = join(namespaceConfig.eventsDir, entry.name);
        try {
          const content = readFileSync(eventFile, "utf-8");
          const lines = content.split("\n");
          let eventType = "system";
          let eventTimestamp = new Date().toISOString();
          let eventData = "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("event:")) {
              eventType = trimmed.slice(6).trim();
            } else if (trimmed.startsWith("timestamp:")) {
              eventTimestamp = trimmed.slice(10).trim();
            } else if (trimmed.startsWith("data:")) {
              eventData = trimmed.slice(5).trim();
            }
          }

          let mappedType: ActivityEvent["type"] = "system";
          if (eventType.includes("schedule") || eventType.includes("cron")) {
            mappedType = "schedule_triggered";
          } else if (eventType.includes("error")) {
            mappedType = "error";
          } else if (eventType.includes("chain_complete")) {
            mappedType = "chain_completed";
          } else if (eventType.includes("agent_complete")) {
            mappedType = "agent_completed";
          }

          events.push({
            id: generateId(),
            type: mappedType,
            title: eventType.charAt(0).toUpperCase() + eventType.slice(1).replace(/_/g, " "),
            message: eventData || "Event occurred",
            timestamp: eventTimestamp,
            metadata: { runId: eventData.slice(0, 50) },
          });
        } catch {
          // skip invalid event files
        }
      }
    } catch {
      // ignore directory read errors
    }
  }

  // Sort by timestamp desc
  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // Filter by type if requested
  const filtered = filter === "all"
    ? events
    : events.filter((e) => {
        if (filter === "chains") return e.type.startsWith("chain_");
        if (filter === "agents") return e.type.startsWith("agent_");
        if (filter === "system") return e.type === "system" || e.type === "schedule_triggered" || e.type === "error";
        return true;
      });

  return apiSuccess({ events: filtered.slice(0, limit) });
});
