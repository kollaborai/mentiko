import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import config, { nsPath, orgPath } from "@/lib/config";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import type { AgentDefinition } from "@/lib/agents/agent-loader";
import { Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { DEFAULT_MARKETPLACE_AGENT_MODEL } from "@/lib/agents/agent-provider-catalog";

export const dynamic = "force-dynamic";

interface AgentRating {
  average: number;
  count: number;
  distribution: Record<number, number>;
  use_count?: number;
}

interface AgentRatings {
  [agentId: string]: AgentRating;
}

export interface MarketplaceAgent {
  id: string;
  name: string;
  description: string;
  role: string;
  version: string;
  category: string;
  tags: string[];
  author: string;
  source: "builtin" | "community";
  triggers: string[];
  emits: string;
  tools: string[];
  model: string;
  prompt: string;
  rating: number;
  ratingCount: number;
  useCount: number;
  installed: boolean;
}

const MARKETPLACE_DIR = join(config.root, "marketplace");

function getRatings(dir: string): AgentRatings {
  const ratingsFile = join(dir, "ratings.json");
  try {
    if (existsSync(ratingsFile)) {
      return JSON.parse(readFileSync(ratingsFile, "utf-8"));
    }
  } catch {
    // malformed or unreadable
  }
  return {};
}

/**
 * load namespace-scoped ratings (written by install/rate on VPS
 * where builtin agents dir doesn't exist).
 */
function getNamespaceRatings(namespaceId: string): AgentRatings {
  const ratingsFile = nsPath(namespaceId, "ratings.json");
  try {
    if (existsSync(ratingsFile)) {
      return JSON.parse(readFileSync(ratingsFile, "utf-8"));
    }
  } catch {
    // malformed or unreadable
  }
  return {};
}

function scanAgentsDir(
  dir: string,
  source: "builtin" | "community",
  ratings: AgentRatings,
  namespaceAgentsDir: string,
  seen: Set<string>,
): MarketplaceAgent[] {
  if (!existsSync(dir)) return [];

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    // directory exists but can't be read (permissions, mount issues)
    return [];
  }

  const agents: MarketplaceAgent[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const agentPath = join(dir, entry.name, "agent.json");
    if (!existsSync(agentPath)) continue;

    try {
      const content = readFileSync(agentPath, "utf-8");
      const agent = JSON.parse(content) as AgentDefinition;

      if (!agent.id || !agent.name) continue;
      // builtin takes precedence - skip community duplicate
      if (seen.has(agent.id)) continue;
      seen.add(agent.id);

      const agentRating = ratings[agent.id] || { average: 0, count: 0, use_count: 0 };

      // check install status - tolerate missing/unreadable namespace dir
      let installed = false;
      try {
        installed = existsSync(join(namespaceAgentsDir, agent.id, "agent.json"));
      } catch {
        // namespace dir on S3 mount may be unavailable
      }

      agents.push({
        id: agent.id,
        name: agent.name,
        description: agent.description || "",
        role: agent.role || "",
        version: agent.version || "1.0",
        category: agent.category || "general",
        tags: agent.tags || [],
        author: agent.author || "community",
        source,
        triggers: agent.triggers || [],
        emits: agent.emits || "",
        tools: agent.tools || [],
        model: agent.model || DEFAULT_MARKETPLACE_AGENT_MODEL,
        prompt: agent.prompt || "",
        rating: agentRating.average,
        ratingCount: agentRating.count,
        useCount: agentRating.use_count || 0,
        installed,
      });
    } catch {
      // skip malformed agent definition
    }
  }

  return agents;
}

export const GET = withErrorHandling(async (request: Request) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const namespaceAgentsDir = orgPath(namespaceId, orgId, "agents");

  const builtinDir = join(config.root, "agents");
  const communityDir = join(MARKETPLACE_DIR, "agents");

  const builtinRatings = getRatings(builtinDir);
  const communityRatings = getRatings(communityDir);
  const nsRatings = getNamespaceRatings(namespaceId);
  const allRatings = { ...communityRatings, ...builtinRatings, ...nsRatings };

  const seen = new Set<string>();
  const agents: MarketplaceAgent[] = [
    ...scanAgentsDir(builtinDir, "builtin", allRatings, namespaceAgentsDir, seen),
    ...scanAgentsDir(communityDir, "community", allRatings, namespaceAgentsDir, seen),
  ];

  agents.sort((a, b) => a.name.localeCompare(b.name));
  const installedCount = agents.filter((a) => a.installed).length;

  return apiSuccess({
    agents,
    total: agents.length,
    installed: installedCount,
  });
});
