import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { getNamespaceConfig } from "@/lib/namespace-config";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { getAllStandaloneAgents, type AgentArtifacts } from "@/lib/agents/agent-loader";
import type { RetryConfig, AgentAuthority, AgentContext } from "@/lib/types";
import { apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

interface RunJson {
  started?: string;
  agents?: Array<{ id?: string; name?: string }>;
}

export interface RegistryAgent {
  id: string;
  name: string;
  role: string;
  prompt: string;
  description?: string;
  triggers: string[];
  emits: string;
  timeout?: number;
  retry?: RetryConfig;
  context?: AgentContext;
  authorities?: AgentAuthority;
  model?: string;
  tools?: string[];
  chains: { id: string; name: string }[];
  source: "standalone" | "chain";
  runCount: number;
  lastUsedAt: string | null;
  artifacts?: AgentArtifacts;
}

interface RawAgent {
  id?: string;
  name?: string;
  role?: string;
  prompt?: string;
  triggers?: string[];
  emits?: string;
  timeout?: number;
  retry?: RetryConfig;
  context?: AgentContext;
  authorities?: AgentAuthority;
  model?: string;
  tools?: string[];
  $ref?: string;
}

function scanChains(dir: string): { chainId: string; chainName: string; agents: RawAgent[] }[] {
  const results: { chainId: string; chainName: string; agents: RawAgent[] }[] = [];

  function walk(current: string, baseName: string) {
    try {
      const entries = readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(current, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath, entry.name);
        } else if (entry.name === "chain.json") {
          try {
            const content = readFileSync(fullPath, "utf-8");
            const json = JSON.parse(content);
            results.push({
              chainId: baseName || entry.name,
              chainName: json.name || baseName || "Unnamed",
              agents: json.agents || [],
            });
          } catch {
            // skip malformed chain files
          }
        }
      }
    } catch {
      // dir might not exist
    }
  }

  walk(dir, "");
  return results;
}

interface AgentUsageStats {
  runCount: number;
  lastUsedAt: string | null;
}

function scanAgentUsage(runsDir: string): Map<string, AgentUsageStats> {
  const stats = new Map<string, AgentUsageStats>();

  try {
    const runDirs = readdirSync(runsDir, { withFileTypes: true });
    for (const entry of runDirs) {
      if (!entry.isDirectory()) continue;

      const runJsonPath = join(runsDir, entry.name, "run.json");
      if (!existsSync(runJsonPath)) continue;

      try {
        const content = readFileSync(runJsonPath, "utf-8");
        const run: RunJson = JSON.parse(content);
        const startedAt = run.started ? new Date(run.started).toISOString() : null;

        for (const agent of run.agents || []) {
          const agentId = agent.id || agent.name;
          if (!agentId) continue;

          const existing = stats.get(agentId);
          if (existing) {
            existing.runCount++;
            if (startedAt && (!existing.lastUsedAt || startedAt > existing.lastUsedAt)) {
              existing.lastUsedAt = startedAt;
            }
          } else {
            stats.set(agentId, {
              runCount: 1,
              lastUsedAt: startedAt,
            });
          }
        }
      } catch {
        // skip malformed run.json files
      }
    }
  } catch {
    // runs dir might not exist
  }

  return stats;
}

export async function GET(req: Request) {
  const perm = await requirePermission(req, "view_chains");
  if (perm) return perm;

  const namespaceConfig = await getNamespaceConfig(req);

  const agentMap = new Map<string, RegistryAgent>();

  const usageStats = scanAgentUsage(namespaceConfig.runsDir);

  const standaloneAgents = getAllStandaloneAgents(namespaceConfig.namespaceId);
  for (const sa of standaloneAgents) {
    const stats = usageStats.get(sa.id);
    agentMap.set(sa.id, {
      id: sa.id,
      name: sa.name,
      role: sa.role || "",
      prompt: sa.prompt || "",
      description: sa.description,
      triggers: sa.triggers || [],
      emits: sa.emits || "",
      timeout: sa.timeout,
      retry: sa.retry,
      context: sa.context,
      authorities: sa.authorities,
      model: sa.model,
      tools: sa.tools,
      chains: [],
      source: "standalone",
      runCount: stats?.runCount ?? 0,
      lastUsedAt: stats?.lastUsedAt ?? null,
      artifacts: sa.artifacts,
    });
  }

  const chainData = scanChains(namespaceConfig.chainsDir);
  for (const chain of chainData) {
    for (const raw of chain.agents) {
      const agentId = raw.$ref || raw.id || raw.name || "";
      if (!agentId) continue;

      const existing = agentMap.get(agentId);
      if (existing) {
        existing.chains.push({ id: chain.chainId, name: chain.chainName });
      } else {
        const stats = usageStats.get(agentId);
        agentMap.set(agentId, {
          id: agentId,
          name: raw.name || agentId,
          role: raw.role || "",
          prompt: raw.prompt || "",
          triggers: raw.triggers || [],
          emits: raw.emits || "",
          timeout: raw.timeout,
          retry: raw.retry,
          context: raw.context,
          authorities: raw.authorities,
          model: raw.model,
          tools: raw.tools,
          chains: [{ id: chain.chainId, name: chain.chainName }],
          source: "chain",
          runCount: stats?.runCount ?? 0,
          lastUsedAt: stats?.lastUsedAt ?? null,
        });
      }
    }
  }

  const agents = Array.from(agentMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  return apiSuccess({ agents });
}
