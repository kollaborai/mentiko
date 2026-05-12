import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { getNamespaceConfig } from "@/lib/namespace-config";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { Unauthorized, BadRequest, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const body = await request.json();
  const { chainId, name, description, category, tags } = body;

  if (!chainId) {
    throw new BadRequest("chainId is required");
  }

  const { chainsDir, templatesDir } = await getNamespaceConfig(request);

  // Read the chain file
  const chainPath = join(chainsDir, chainId, "chain.json");
  if (!existsSync(chainPath)) {
    throw new NotFound("Chain", chainId);
  }

  const chainContent = readFileSync(chainPath, "utf-8");
  const chainData = JSON.parse(chainContent);

  // Generate slug from name or use chain id
  const slug = name
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || chainId;

  // Create template directory
  const templateDir = join(templatesDir, slug);
  if (!existsSync(templateDir)) {
    mkdirSync(templateDir, { recursive: true });
  }

  // Create template metadata
  const template = {
    id: `template/${slug}`,
    slug,
    name: name || chainData.name || chainId,
    description: description || chainData.description || "",
    category: category || "general",
    tags: tags?.split(",").map((t: string) => t.trim()).filter(Boolean) || [],
    chain: chainData,
    createdAt: new Date().toISOString(),
    author: "user",
  };

  // Write template file
  writeFileSync(join(templateDir, "template.json"), JSON.stringify(template, null, 2));

  // Copy chain.json for compatibility
  writeFileSync(join(templateDir, "chain.json"), JSON.stringify(chainData, null, 2));

  return apiSuccess({ template });
});

// GET is handled by /api/templates/list/route.ts
export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { templatesDir } = await getNamespaceConfig(request);

  if (!existsSync(templatesDir)) {
    return apiSuccess({ templates: [] });
  }

  const { readdirSync, readFileSync } = await import("fs");
  const templates = [];

  const entries = readdirSync(templatesDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const templatePath = join(templatesDir, entry.name, "template.json");
    if (!existsSync(templatePath)) continue;

    try {
      const content = readFileSync(templatePath, "utf-8");
      const template = JSON.parse(content);
      templates.push(template);
    } catch {
      // skip malformed entries
    }
  }

  return apiSuccess({ templates });
});
