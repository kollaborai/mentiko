import { NextRequest } from "next/server";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import config from "@/lib/config";
import type { PluginManifest } from "@/lib/plugin-types";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

interface MarketplacePlugin extends PluginManifest {
  source: string;
  path: string;
  readme: string | null;
}

function scanPluginsDir(baseDir: string, prefix: string): MarketplacePlugin[] {
  const plugins: MarketplacePlugin[] = [];

  if (!existsSync(baseDir)) {
    return plugins;
  }

  let entries;
  try {
    entries = readdirSync(baseDir, { withFileTypes: true });
  } catch {
    return plugins;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const pluginJsonPath = join(baseDir, entry.name, "plugin.json");
    const readmePath = join(baseDir, entry.name, "README.md");

    if (!existsSync(pluginJsonPath)) continue;

    let content: string;
    try {
      content = readFileSync(pluginJsonPath, "utf-8");
    } catch {
      continue;
    }
    if (!content || content.trim().length === 0) continue;

    try {
      const manifest = JSON.parse(content) as PluginManifest;

      plugins.push({
        ...manifest,
        source: prefix,
        path: join(baseDir, entry.name),
        readme: existsSync(readmePath) ? readmePath : null,
      });
    } catch (err) {
      console.error(`Failed to parse plugin ${pluginJsonPath}:`, err);
    }
  }

  return plugins;
}

export const GET = withErrorHandling(async (request: NextRequest) => {
  const marketplaceBase = join(config.globalRoot, "marketplace");
  const pluginsDir = join(marketplaceBase, "plugins");

  const plugins = scanPluginsDir(pluginsDir, "community/plugins");

  const searchParams = request.nextUrl.searchParams;
  const category = searchParams.get("category");
  const source = searchParams.get("source");

  let filtered = plugins;

  if (category) {
    filtered = filtered.filter((p) => p.category === category);
  }
  if (source && source !== "all") {
    filtered = filtered.filter((p) => p.source === source);
  }

  filtered.sort((a, b) => a.name.localeCompare(b.name));

  return apiSuccess({ plugins: filtered });
});
