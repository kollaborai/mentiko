import { NextRequest } from "next/server";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import config, { nsPath, orgPath } from "@/lib/config";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { NotFound, InternalServerError } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

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

const MARKETPLACE_DIR = join(config.root, "marketplace");

/**
 * find the ratings.json file. checks builtin agents dir first,
 * then marketplace agents dir. returns path to first found,
 * or the builtin path as default (for creation).
 */
function getRatingsFile(): string {
  const builtinPath = join(config.root, "agents", "ratings.json");
  if (existsSync(builtinPath)) return builtinPath;

  const marketplacePath = join(MARKETPLACE_DIR, "agents", "ratings.json");
  if (existsSync(marketplacePath)) return marketplacePath;

  // default to namespace-scoped ratings (always writable on VPS)
  return nsPath(config.namespaceId, "ratings.json");
}

function getRatings(): AgentRatings {
  const ratingsFile = getRatingsFile();
  if (existsSync(ratingsFile)) {
    try {
      return JSON.parse(readFileSync(ratingsFile, "utf-8"));
    } catch {
      return {};
    }
  }
  return {};
}

function saveRatings(ratings: AgentRatings) {
  const ratingsFile = getRatingsFile();
  const dir = join(ratingsFile, "..");
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(ratingsFile, JSON.stringify(ratings, null, 2));
  } catch {
    // ratings write failed (read-only filesystem, permissions) - non-fatal
    console.warn("[marketplace] failed to save ratings to", ratingsFile);
  }
}

/**
 * find an agent definition by ID across all known agent directories.
 * checks: builtin agents dir, marketplace community dir.
 */
function findAgentSource(id: string): { path: string; agent: Record<string, unknown> } | null {
  const searchDirs = [
    join(config.root, "agents", id, "agent.json"),
    join(MARKETPLACE_DIR, "agents", id, "agent.json"),
  ];

  for (const agentPath of searchDirs) {
    if (existsSync(agentPath)) {
      try {
        const content = readFileSync(agentPath, "utf-8");
        return { path: agentPath, agent: JSON.parse(content) };
      } catch {
        // malformed json, try next
      }
    }
  }

  return null;
}

interface Context {
  params: Promise<{ id: string }>;
}

export const POST = withErrorHandling(async (request: NextRequest, context: Context) => {
  if (!(await checkAuth(request))) {
    throw new InternalServerError("Authentication check failed");
  }

  const { id } = await context.params;
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  // find agent in builtin or marketplace dirs
  const source = findAgentSource(id);
  if (!source) {
    throw new NotFound("Agent", id);
  }

  // copy to namespace agents dir (uses orgPath for org-level agents)
  const targetDir = orgPath(namespaceId, orgId, "agents", id);
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(join(targetDir, "agent.json"), JSON.stringify(source.agent, null, 2));

  // increment use count (non-fatal if write fails)
  const ratings = getRatings();
  if (!ratings[id]) {
    ratings[id] = { average: 0, count: 0, distribution: {}, use_count: 0 };
  }
  ratings[id].use_count = (ratings[id].use_count || 0) + 1;
  saveRatings(ratings);

  return apiSuccess({ agent: source.agent, installed: true });
});
