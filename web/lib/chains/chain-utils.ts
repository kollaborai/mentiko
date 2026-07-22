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
  authorities?: { can?: string[]; needs_approval?: string[] } | string[];
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
        prompt: a.prompt,
        description: a.description,
        agent_profile: (a as unknown as Record<string, unknown>).agent_profile as string | undefined,
        on_error: a.on_error,
        on_timeout: a.on_timeout,
        timeout: a.timeout,
        retry: a.retry,
        artifacts: a.artifacts,
        authorities: a.authorities,
      }));
    } catch {
      // fallback: map raw fields (won't have $ref data)
      agents = rawAgents.map((a: Record<string, unknown>) => ({
        id: (a.id as string) || (a.$ref as string) || "",
        name: (a.name as string) || (a.$ref as string) || "",
        role: (a.role as string) || "",
        triggers: (a.triggers as string[]) || [],
        emits: (a.emits as string) || "",
        prompt: a.prompt as string | undefined,
        description: a.description as string | undefined,
        agent_profile: a.agent_profile as string | undefined,
        on_error: a.on_error as string | undefined,
        on_timeout: a.on_timeout as string | undefined,
        timeout: a.timeout as number | undefined,
        retry: a.retry as { max_retries?: number } | undefined,
        artifacts: a.artifacts as { produces?: Array<{ id: string; type?: string; description?: string }> } | undefined,
        authorities: a.authorities as ChainAgent["authorities"],
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

  const summarizeArtifacts = (agent: ChainAgent) => {
    const produces = agent.artifacts?.produces;
    if (!produces?.length) return "";
    return produces
      .map((artifact) => [
        artifact.id,
        artifact.type ? `type=${artifact.type}` : null,
        artifact.description ? `desc=${artifact.description}` : null,
      ].filter(Boolean).join(" "))
      .join("; ");
  };

  return chains
    .map((c) => {
      const agentList = c.agents
        .map((a) => {
          const artifactHint = summarizeArtifacts(a);
          return [
            `    - ${a.name}${a.role ? ` (${a.role})` : ""}`,
            a.triggers?.length ? `      triggers: ${a.triggers.join(", ")}` : null,
            a.emits ? `      emits: ${a.emits}` : null,
            artifactHint ? `      artifacts: ${artifactHint}` : null,
          ].filter(Boolean).join("\n");
        })
        .join("\n");
      return [
        `chain: ${c.name} [id: ${c.id}]`,
        c.description ? `  description: ${c.description}` : null,
        `  agents (${c.agentCount}):`,
        agentList,
        c.maxRounds ? `  max_rounds: ${c.maxRounds}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

const CORE_GENERATION_CHAIN_IDS = new Set([
  "agent-edit",
  "agent-generation",
  "artifact-generation",
  "chain-generation",
  "chain-recommendation",
  "decision-guided-options",
  "decision-guided-plan",
  "decision-guided-questions",
  "decision-preference-synthesis",
  "decision-research",
  "decision-retrospective",
  "run-summary-generation",
  "task-generation",
  "template-test",
  "webhook-generation",
]);

const CATALOG_STOP_WORDS = new Set([
  "about", "after", "against", "criteria", "deliverable", "description",
  "from", "into", "task", "that", "this", "using", "verification", "with",
]);

function catalogTerms(value: string): string[] {
  return [...new Set(
    value.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g)
      ?.filter((term) => !CATALOG_STOP_WORDS.has(term)) ?? [],
  )];
}

function chainCatalogScore(chain: ChainData, terms: string[]): number {
  if (terms.length === 0) return 0;
  const identity = `${chain.id} ${chain.name}`.toLowerCase();
  const detail = [
    chain.description,
    ...chain.agents.flatMap((agent) => [agent.id, agent.name, agent.role]),
  ].join(" ").toLowerCase();
  return terms.reduce((score, term) =>
    score + (identity.includes(term) ? 5 : 0) + (detail.includes(term) ? 1 : 0), 0);
}

function agentAuthorities(agent: ChainAgent): string[] {
  if (Array.isArray(agent.authorities)) return agent.authorities;
  return Array.isArray(agent.authorities?.can) ? agent.authorities.can : [];
}

/**
 * Bounded catalog for LLM chain recommendation. The general UI summary is
 * intentionally rich; injecting all of it plus every agent into a generation
 * prompt made the output contract the least salient part of a 50KB request.
 * Rank against the current task and keep only the fields needed to decide fit.
 */
export function buildChainRecommendationCatalog(
  chains: ChainData[],
  taskContext = "",
  limit = 24,
): string {
  const terms = catalogTerms(taskContext);
  const candidates = chains
    .filter((chain) => !CORE_GENERATION_CHAIN_IDS.has(chain.id))
    .map((chain) => ({ chain, score: chainCatalogScore(chain, terms) }))
    .sort((a, b) => b.score - a.score || a.chain.name.localeCompare(b.chain.name))
    .slice(0, Math.max(1, limit));

  if (candidates.length === 0) return "No user chains available.";

  return candidates.map(({ chain, score }) => {
    const contract = chain.metadata?.generated_chain_contract;
    const mode = contract && typeof contract === "object" && !Array.isArray(contract)
      ? (contract as Record<string, unknown>).mode
      : undefined;
    const agents = chain.agents.slice(0, 6).map((agent) => {
      const can = agentAuthorities(agent);
      return `${agent.name}${can.length ? ` [${can.join(",")}]` : ""}`;
    });
    return [
      `- id=${chain.id} | name=${chain.name} | score=${score}${typeof mode === "string" ? ` | mode=${mode}` : ""}`,
      chain.description ? `  purpose=${chain.description.replace(/\s+/g, " ").trim().slice(0, 220)}` : null,
      agents.length ? `  agents=${agents.join(" -> ")}` : null,
    ].filter(Boolean).join("\n");
  }).join("\n");
}
