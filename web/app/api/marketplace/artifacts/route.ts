import { NextRequest } from "next/server";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";
import config from "@/lib/config";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

interface ArtifactFrontmatter {
  id: string;
  name: string;
  format: string;
  category: string;
  tags: string[];
  description: string;
  author: string;
  version?: string;
  schema?: Record<string, unknown>;
  validation_rules?: string[];
  related_artifacts?: string[];
}

interface MarketplaceArtifact extends ArtifactFrontmatter {
  source: string;
  path: string;
  content?: string;
}

function parseFrontmatter(content: string): { frontmatter: ArtifactFrontmatter; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {} as ArtifactFrontmatter, body: content };
  }

  const frontmatterText = match[1];
  const body = match[2];

  try {
    const frontmatter = yaml.load(frontmatterText) as Record<string, unknown>;
    return { frontmatter: frontmatter as unknown as ArtifactFrontmatter, body };
  } catch {
    return { frontmatter: {} as ArtifactFrontmatter, body };
  }
}

function scanArtifactsDir(baseDir: string, prefix: string): MarketplaceArtifact[] {
  const artifacts: MarketplaceArtifact[] = [];

  if (!existsSync(baseDir)) {
    return artifacts;
  }

  let entries;
  try {
    entries = readdirSync(baseDir, { withFileTypes: true });
  } catch {
    return artifacts;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;

    const artifactPath = join(baseDir, entry.name);

    let content: string;
    try {
      content = readFileSync(artifactPath, "utf-8");
    } catch {
      continue;
    }

    if (!content || content.trim().length === 0) continue;

    try {
      const { frontmatter, body } = parseFrontmatter(content);
      if (!frontmatter.id || !frontmatter.name) continue;

      artifacts.push({
        ...frontmatter,
        source: prefix,
        path: artifactPath,
        content: body.trim(),
      });
    } catch (err) {
      console.error(`Failed to parse artifact ${artifactPath}:`, err);
    }
  }

  return artifacts;
}

export const GET = withErrorHandling(async (request: NextRequest) => {
  const marketplaceBase = join(config.globalRoot, "marketplace");
  const artifactsDir = join(marketplaceBase, "artifacts");

  const artifacts = scanArtifactsDir(artifactsDir, "community");

  const searchParams = request.nextUrl.searchParams;
  const category = searchParams.get("category");
  const source = searchParams.get("source");
  const tag = searchParams.get("tag");

  let filtered = artifacts;

  if (category) {
    filtered = filtered.filter((a) => a.category === category);
  }
  if (source && source !== "all") {
    filtered = filtered.filter((a) => a.source === source);
  }
  if (tag) {
    filtered = filtered.filter((a) => a.tags.includes(tag));
  }

  return apiSuccess({ artifacts: filtered });
});
