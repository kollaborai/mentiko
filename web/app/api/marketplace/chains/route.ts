import { NextRequest } from "next/server";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import config from "@/lib/config";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

interface MarketplaceChain {
  id: string;
  slug: string;
  name: string;
  description: string;
  version: string;
  agents: number;
  tags: string[];
  category: string;
  cli: string;
  hasWebhooks: boolean;
  hasParallel: boolean;
  maxRounds?: number;
  source: string;
  path: string;
  readme: string | null;
}

function extractTags(chain: unknown): string[] {
  const tags: string[] = [];
  const c = chain as {
    agents?: Array<{ role?: string }>;
    config?: { webhooks?: { enabled?: boolean }; parallel?: { enabled?: boolean } };
    branches?: Record<string, unknown>;
  };

  if (c.agents?.length && c.agents.length >= 3) tags.push("multi-agent");
  if (c.config?.webhooks?.enabled) tags.push("webhooks");
  if (c.config?.parallel?.enabled) tags.push("parallel");
  if (c.branches && Object.keys(c.branches).length > 0) tags.push("branching");

  const roles = c.agents?.map((a) => a.role?.toLowerCase() || "").join(" ") || "";
  if (roles.includes("review")) tags.push("review");
  if (roles.includes("code") || roles.includes("developer")) tags.push("code");
  if (roles.includes("research")) tags.push("research");
  if (roles.includes("write") || roles.includes("content")) tags.push("writing");
  if (roles.includes("support") || roles.includes("triage")) tags.push("support");
  if (roles.includes("test") || roles.includes("qa")) tags.push("testing");
  if (roles.includes("client") || roles.includes("proposal")) tags.push("business");
  if (roles.includes("data") || roles.includes("extract") || roles.includes("transform") || roles.includes("load")) tags.push("data");

  return [...new Set(tags)].sort();
}

function scanChainsDir(baseDir: string, prefix: string): MarketplaceChain[] {
  const chains: MarketplaceChain[] = [];

  if (!existsSync(baseDir)) {
    return chains;
  }

  let entries;
  try {
    entries = readdirSync(baseDir, { withFileTypes: true });
  } catch {
    return chains;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const chainPath = join(baseDir, entry.name, "chain.json");
    const readmePath = join(baseDir, entry.name, "README.md");

    if (!existsSync(chainPath)) continue;

    let content: string;
    try {
      content = readFileSync(chainPath, "utf-8");
    } catch {
      continue;
    }
    if (!content || content.trim().length === 0) continue;

    try {
      const chain = JSON.parse(content);

      chains.push({
        id: `${prefix}/${entry.name}`,
        slug: entry.name,
        name: chain.name || entry.name,
        description: chain.description || "",
        version: chain.version || "1.0",
        agents: chain.agents?.length || 0,
        tags: extractTags(chain),
        category: chain.metadata?.category || "general",
        cli: chain.config?.cli || "claude",
        hasWebhooks: chain.config?.webhooks?.enabled || false,
        hasParallel: chain.config?.parallel?.enabled || false,
        maxRounds: chain.config?.max_rounds,
        source: prefix,
        path: chainPath,
        readme: existsSync(readmePath) ? readmePath : null,
      });
    } catch (err) {
      console.error(`Failed to parse ${chainPath}:`, err);
    }
  }

  return chains;
}

export const GET = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "view_chains");
  if (perm) return perm;
  const marketplaceBase = join(config.globalRoot, "marketplace");
  const chainsDir = join(marketplaceBase, "chains");

  const chains = scanChainsDir(chainsDir, "community/chains");

  const searchParams = request.nextUrl.searchParams;
  const category = searchParams.get("category");
  const source = searchParams.get("source");
  const tag = searchParams.get("tag");

  let filtered = chains;

  if (category) {
    filtered = filtered.filter((c) => c.category === category);
  }
  if (source && source !== "all") {
    filtered = filtered.filter((c) => c.source === source);
  }
  if (tag) {
    filtered = filtered.filter((c) => c.tags.includes(tag));
  }

  filtered.sort((a, b) => a.name.localeCompare(b.name));

  return apiSuccess({ chains: filtered });
});
