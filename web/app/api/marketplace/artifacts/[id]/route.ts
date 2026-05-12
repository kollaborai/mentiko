import { NextRequest } from "next/server";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";
import config from "@/lib/config";
import { NotFound } from "@/lib/api-errors";
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

function parseFrontmatter(content: string): { frontmatter: ArtifactFrontmatter; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {} as ArtifactFrontmatter, body: content };
  }
  try {
    const frontmatter = yaml.load(match[1]) as Record<string, unknown>;
    return { frontmatter: frontmatter as unknown as ArtifactFrontmatter, body: match[2] };
  } catch {
    return { frontmatter: {} as ArtifactFrontmatter, body: content };
  }
}

export const GET = withErrorHandling(async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const artifactsDir = join(config.globalRoot, "marketplace", "artifacts");

  if (!existsSync(artifactsDir)) {
    throw new NotFound("Artifact", id);
  }

  const entries = readdirSync(artifactsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const filePath = join(artifactsDir, entry.name);
    const raw = readFileSync(filePath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(raw);
    if (frontmatter.id === id) {
      return apiSuccess({
        artifact: {
          ...frontmatter,
          source: "community",
          path: filePath,
          content: body.trim(),
        },
      });
    }
  }

  throw new NotFound("Artifact", id);
});
