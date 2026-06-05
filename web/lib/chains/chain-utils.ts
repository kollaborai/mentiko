import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join } from "path";
import { resolveChainAgents } from "../agents/agent-loader";

export interface ChainAgent {
  id: string;
  name: string;
  role: string;
  triggers: string[];
  emits: string;
  prompt?: string;
  description?: string;
  agent_profile?: string;
  on_error?: string;
  on_timeout?: string;
  timeout?: number;
  retry?: { max_retries?: number };
  artifacts?: { produces?: Array<{ id: string; type?: string; description?: string }> };
}

export interface ChainData {
  id: string;
  name: string;
  description: string;
  version: string;
  agentCount: number;
  cli: string;
  monitor: boolean;
  agents: ChainAgent[];
  default_agent_profile?: string;
  maxRounds?: number;
  onComplete?: string;
  createdAt?: string;
  lastRun?: string;
  runCount?: number;
  metadata?: Record<string, unknown>;
}

export function loadChain(
  chainPath: string,
  id: string,
  cliBin: string,
  namespaceId?: string,
  orgId?: string
): ChainData | null {
  try {
    const content = readFileSync(chainPath, "utf-8");
    const json = JSON.parse(content);
    const stat = statSync(chainPath);

    // Resolve $ref agents to full definitions
    let agents: ChainAgent[] = [];
    const rawAgents = json.agents || [];
    try {
      const resolved = resolveChainAgents(rawAgents, namespaceId, orgId);
      agents = resolved.map((a) => ({
        id: a.id || "",
        name: a.name || "",
        role: a.role || "",
        triggers: a.triggers || [],
        emits: a.emits || "",
        description: a.description,
        agent_profile: (a as unknown as Record<string, unknown>).agent_profile as string | undefined,
        on_error: a.on_error,
        on_timeout: a.on_timeout,
        timeout: a.timeout,
        retry: a.retry,
        artifacts: a.artifacts,
      }));
    } catch {
      // fallback: map raw fields (won't have $ref data)
      agents = rawAgents.map((a: Record<string, unknown>) => ({
        id: (a.id as string) || (a.$ref as string) || "",
        name: (a.name as string) || (a.$ref as string) || "",
        role: (a.role as string) || "",
        triggers: (a.triggers as string[]) || [],
        emits: (a.emits as string) || "",
        description: a.description as string | undefined,
        agent_profile: a.agent_profile as string | undefined,
        on_error: a.on_error as string | undefined,
        on_timeout: a.on_timeout as string | undefined,
        timeout: a.timeout as number | undefined,
        retry: a.retry as { max_retries?: number } | undefined,
      }));
    }

    return {
      id,
      name: json.name || "Unnamed",
      description: json.description || "",
      version: json.version || "1.0",
      agentCount: json.agents?.length || 0,
      cli: json.config?.cli || cliBin,
      monitor: json.config?.monitor ?? true,
      default_agent_profile: typeof json.default_agent_profile === "string" ? json.default_agent_profile : undefined,
      maxRounds: json.config?.max_rounds,
      onComplete: json.config?.on_complete,
      createdAt: stat.birthtime.toISOString(),
      metadata: json.metadata && typeof json.metadata === "object" && !Array.isArray(json.metadata)
        ? json.metadata
        : undefined,
      agents,
    };
  } catch {
    return null;
  }
}

interface ChainRunStats {
  lastRun: string;
  runCount: number;
}

function buildChainRunStats(runsDir: string): Record<string, ChainRunStats> {
  const stats: Record<string, ChainRunStats> = {};
  if (!existsSync(runsDir)) return stats;
  try {
    const entries = readdirSync(runsDir, { withFileTypes: true }).filter(
      (d) => d.isDirectory() && d.name.startsWith("run-")
    );
    for (const entry of entries) {
      const runFile = join(runsDir, entry.name, "run.json");
      if (!existsSync(runFile)) continue;
      try {
        const run = JSON.parse(readFileSync(runFile, "utf-8"));
        const chainId = run.chainId || run.chain?.toLowerCase().replace(/\s+/g, "-");
        const started = run.started;
        if (chainId && started) {
          if (!stats[chainId]) {
            stats[chainId] = { lastRun: started, runCount: 0 };
          }
          stats[chainId].runCount++;
          if (started > stats[chainId].lastRun) {
            stats[chainId].lastRun = started;
          }
        }
      } catch {
        // skip invalid
      }
    }
  } catch {
    // ignore
  }
  return stats;
}

export function getAllChains(chainsDir: string, cliBin: string, runsDir?: string, namespaceId?: string, orgId?: string): ChainData[] {
  const chains: ChainData[] = [];

  function scanDir(dir: string, baseName = "") {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath, entry.name);
        } else if (entry.name === "chain.json") {
          const chain = loadChain(fullPath, baseName || entry.name, cliBin, namespaceId, orgId);
          if (chain) {
            chains.push(chain);
          }
        }
      }
    } catch {
      // dir might not exist
    }
  }

  scanDir(chainsDir);

  if (runsDir) {
    const runStats = buildChainRunStats(runsDir);
    for (const chain of chains) {
      const stats = runStats[chain.id];
      if (stats) {
        chain.lastRun = stats.lastRun;
        chain.runCount = stats.runCount;
      }
    }
  }

  return chains;
}

export function buildChainSummary(chains: ChainData[]): string {
  if (chains.length === 0) return "No chains available.";

  return chains
    .map((c) => {
      const agentList = c.agents
        .map((a) => `${a.name}${a.role ? ` (${a.role})` : ""}`)
        .join(" -> ");
      return [
        `chain: ${c.name} [id: ${c.id}]`,
        c.description ? `  description: ${c.description}` : null,
        `  agents (${c.agentCount}): ${agentList}`,
        c.maxRounds ? `  max_rounds: ${c.maxRounds}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}
