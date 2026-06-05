import { existsSync, readFileSync } from "fs";
import { join } from "path";

export interface RunAgentStatus {
  id?: string;
  status?: string;
  completed?: string;
}

export interface RunCompletionLike {
  agents?: RunAgentStatus[];
}

interface ChainAgentRef {
  id?: string;
  $ref?: string;
}

function readDeclaredAgentIds(runDir: string): string[] {
  const chainFile = join(runDir, "chain.json");
  if (!existsSync(chainFile)) return [];

  try {
    const chain = JSON.parse(readFileSync(chainFile, "utf-8")) as { agents?: ChainAgentRef[] };
    if (!Array.isArray(chain.agents)) return [];
    return chain.agents
      .map((agent) => agent.id || agent.$ref)
      .filter((id): id is string => Boolean(id));
  } catch {
    return [];
  }
}

export function allDeclaredAgentsComplete(run: RunCompletionLike, runDir: string): boolean {
  const declaredAgentIds = readDeclaredAgentIds(runDir);
  if (declaredAgentIds.length === 0) return false;

  const statusByAgentId = new Map(
    (run.agents || []).map((agent) => [agent.id, agent.status])
  );

  return declaredAgentIds.every(
    (agentId) => statusByAgentId.get(agentId) === "complete"
  );
}

export function latestAgentCompletion(run: RunCompletionLike): string | undefined {
  const latest = (run.agents || [])
    .filter((agent) => agent.status === "complete" && agent.completed)
    .map((agent) => new Date(agent.completed!).getTime())
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => b - a)[0];

  return latest ? new Date(latest).toISOString() : undefined;
}
