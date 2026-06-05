import { NextRequest } from "next/server";
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "fs";
import { join } from "path";
import config, { nsPath } from "@/lib/config";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceConfig, getNamespaceIdFromRequest } from "@/lib/namespace-config";
import { Unauthorized, BadRequest, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

interface Rating {
  average: number;
  count: number;
  distribution: Record<number, number>;
  use_count?: number;
}

interface TemplateRatings {
  [templateId: string]: Rating;
}

function getRatings(namespaceId: string): TemplateRatings {
  const file = nsPath(namespaceId, "ratings.json");
  if (existsSync(file)) {
    try {
      const content = readFileSync(file, "utf-8");
      return JSON.parse(content);
    } catch {
      return {};
    }
  }
  return {};
}

function saveRatings(ratings: TemplateRatings, namespaceId: string) {
  writeFileSync(nsPath(namespaceId, "ratings.json"), JSON.stringify(ratings, null, 2));
}

interface Context {
  params: Promise<{ id: string }>;
}

export const POST = withErrorHandling(async (request: NextRequest, context: Context) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const namespaceConfig = await getNamespaceConfig(request);

  const { id } = await context.params;
  const parts = decodeURIComponent(id).split("/");

  if (parts.length < 2) {
    throw new BadRequest("Invalid template id");
  }

  let templateDir: string;
  if (parts[0] === "community" && parts.length >= 3) {
    // community/chains/{slug} -> ~/.mentiko/marketplace/chains/{slug}
    const subPath = parts.slice(1).join("/");
    templateDir = join(config.globalRoot, "marketplace", subPath);
  } else {
    const [source, dirName] = parts;
    let sourceDir: string;
    if (source === "examples") {
      sourceDir = join(config.root, "examples");
    } else {
      sourceDir = join(config.root, "templates");
    }
    templateDir = join(sourceDir, dirName);
  }

  const slug = parts[parts.length - 1];
  const chainPath = join(templateDir, "chain.json");

  if (!existsSync(chainPath)) {
    throw new NotFound("Template", id);
  }

  const chain = JSON.parse(readFileSync(chainPath, "utf-8"));

  // generate unique id for namespace chain
  const baseId = slug.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  let uniqueId = baseId;
  let counter = 1;

  while (existsSync(join(namespaceConfig.chainsDir, uniqueId))) {
    uniqueId = `${baseId}-${counter++}`;
  }

  const targetDir = join(namespaceConfig.chainsDir, uniqueId);
  mkdirSync(targetDir, { recursive: true });

  // copy chain.json to namespace chains
  writeFileSync(join(targetDir, "chain.json"), JSON.stringify(chain, null, 2));

  // copy README if exists
  const readmePath = join(templateDir, "README.md");
  if (existsSync(readmePath)) {
    copyFileSync(readmePath, join(targetDir, "README.md"));
  }

  // increment use count
  const namespaceId = await getNamespaceIdFromRequest(request);
  const ratings = getRatings(namespaceId);
  if (!ratings[id]) {
    ratings[id] = { average: 0, count: 0, distribution: {}, use_count: 0 };
  }
  ratings[id].use_count = (ratings[id].use_count || 0) + 1;
  saveRatings(ratings, namespaceId);

  // return UI-format chain
  const uiChain = {
    id: uniqueId,
    name: chain.name || uniqueId,
    description: chain.description || "",
    version: chain.version || "1.0",
    agentCount: chain.agents?.length || 0,
    cli: chain.config?.cli || config.cliBin,
    monitor: chain.config?.monitor ?? true,
    maxRounds: chain.config?.max_rounds,
    onComplete: chain.config?.on_complete,
    agents: (chain.agents || []).map((a: unknown) => ({
      id: (a as { id?: string }).id || "",
      name: (a as { name?: string }).name || "",
      role: (a as { role?: string }).role || "",
      triggers: (a as { triggers?: string[] }).triggers || [],
      emits: (a as { emits?: string }).emits || "",
    })),
  };

  return apiSuccess({ chain: uiChain });
});
