import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import config from "../config";

interface Rating {
  average: number;
  count: number;
  distribution: Record<number, number>;
  use_count: number;
}

interface TemplateRatings {
  [templateId: string]: Rating;
}

export interface Template {
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
  rating: number;
  ratingCount: number;
  ratingDistribution: Record<number, number>;
  useCount: number;
}

const DEFAULT_RATING: Rating = { average: 0, count: 0, distribution: {}, use_count: 0 };

function getRatings(): TemplateRatings {
  const ratingsPath = join(config.namespaceRoot, "ratings.json");
  if (existsSync(ratingsPath)) {
    try {
      const content = readFileSync(ratingsPath, "utf-8");
      const parsed = JSON.parse(content);
      // ensure use_count exists for backwards compatibility
      for (const key in parsed) {
        if (parsed[key].use_count === undefined) {
          parsed[key].use_count = 0;
        }
      }
      return parsed;
    } catch {
      return {};
    }
  }
  return {};
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

function scanTemplatesDir(baseDir: string, prefix: string): Template[] {
  const templates: Template[] = [];
  const ratings = getRatings();

  if (!existsSync(baseDir)) {
    return templates;
  }

  let entries;
  try {
    entries = readdirSync(baseDir, { withFileTypes: true });
  } catch {
    // directory exists but can't be read (permissions, mount issues)
    return templates;
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
      continue; // unreadable file, skip
    }
    if (!content || content.trim().length === 0) continue;

    try {
      const chain = JSON.parse(content);
      const templateId = `${prefix}/${entry.name}`;
      const rating = ratings[templateId] || DEFAULT_RATING;

      const metadata: Template = {
        id: templateId,
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
        rating: rating.average,
        ratingCount: rating.count,
        ratingDistribution: rating.distribution,
        useCount: rating.use_count || 0,
      };

      templates.push(metadata);
    } catch (err) {
      console.error(`Failed to parse ${chainPath}:`, err);
    }
  }

  return templates;
}

function scanPublishedChains(baseDir: string): Template[] {
  if (!existsSync(baseDir)) return [];
  const templates: Template[] = [];

  let entries;
  try {
    entries = readdirSync(baseDir, { withFileTypes: true });
  } catch {
    return templates;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const chainPath = join(baseDir, entry.name, "chain.json");
    const metaPath = join(baseDir, entry.name, "publish.json");
    if (!existsSync(chainPath) || !existsSync(metaPath)) continue;

    try {
      const chain = JSON.parse(readFileSync(chainPath, "utf-8"));
      const pub = JSON.parse(readFileSync(metaPath, "utf-8"));

      // skip non-public entries
      if (pub.visibility && pub.visibility !== "public") continue;

      templates.push({
        id: `published/${entry.name}`,
        slug: entry.name,
        name: pub.name || chain.name || entry.name,
        description: pub.description || chain.description || "",
        version: pub.version || chain.version || "1.0",
        agents: pub.agentCount || chain.agents?.length || 0,
        tags: pub.tags?.length ? pub.tags : extractTags(chain),
        category: pub.category || "general",
        cli: chain.config?.cli || "claude",
        hasWebhooks: chain.config?.webhooks?.enabled || false,
        hasParallel: chain.config?.parallel?.enabled || false,
        maxRounds: chain.config?.max_rounds,
        source: `published/${pub.publisherName || "user"}`,
        path: chainPath,
        readme: null,
        rating: pub.rating || 0,
        ratingCount: pub.ratingCount || 0,
        ratingDistribution: pub.ratingDistribution || {},
        useCount: pub.installCount || 0,
      });
    } catch {
      /* skip malformed entries */
    }
  }

  return templates;
}

export async function getTemplates(): Promise<Template[]> {
  const marketplaceBase = join(config.globalRoot, "marketplace");
  const publishedBase = join(config.namespacesBase, "marketplace", "published");

  const templates = [
    // builtin curated content (ships with platform)
    ...scanTemplatesDir(join(config.root, "templates"), "templates"),
    // community content (cloned from public marketplace repo)
    ...scanTemplatesDir(join(marketplaceBase, "templates"), "community/templates"),
    ...scanTemplatesDir(join(marketplaceBase, "chains"), "community/chains"),
    // user-published chains
    ...scanPublishedChains(publishedBase),
  ];

  templates.sort((a, b) => {
    if (b.rating !== a.rating) return b.rating - a.rating;
    return a.name.localeCompare(b.name);
  });

  return templates;
}
