import { NextResponse } from "next/server";
import { requireOpsAuth, requireOpsPermission } from "@/lib/mentiko-mcp-ops-auth";
import { getTemplates, type Template } from "@/lib/templates";
import { orgPath } from "@/lib/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

function agentCount(chain: Record<string, unknown>): number {
  return Array.isArray(chain.agents) ? chain.agents.length : 0;
}

/** GET /api/mentiko-mcp/ops/templates — list local templates */
export async function GET(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;

  try {
    const templates = await getTemplates();
    return NextResponse.json({ templates });
  } catch {
    return NextResponse.json({ templates: [] });
  }
}

/**
 * POST /api/mentiko-mcp/ops/templates
 * Install a local template into the org — copies chain.json + agent definitions.
 * Body: { templateId: string }
 */
export async function POST(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  const perm = requireOpsPermission(ctx, "manage_chains", "chains:write");
  if (perm) return perm;

  const { namespaceId, orgId } = ctx;
  const { templateId } = (await req.json()) as { templateId?: string };
  if (!templateId) return new NextResponse("templateId required", { status: 400 });

  const templates = await getTemplates();
  const tpl = templates.find((t: Template) => t.id === templateId || t.slug === templateId);
  if (!tpl) return new NextResponse(`Template not found: ${templateId}`, { status: 404 });

  const tplPath = tpl.path;
  if (!tplPath || !existsSync(tplPath)) {
    return new NextResponse("Template source not found on disk", { status: 404 });
  }

  const chainJsonPath = join(tplPath, "chain.json");
  if (!existsSync(chainJsonPath)) {
    return new NextResponse("Template has no chain.json", { status: 422 });
  }

  const chain = JSON.parse(readFileSync(chainJsonPath, "utf-8")) as Record<string, unknown>;
  const slug = tpl.slug || templateId;
  const destDir = orgPath(namespaceId, orgId, "chains", slug);

  if (existsSync(join(destDir, "chain.json"))) {
    return new NextResponse(`Chain already exists: ${slug}`, { status: 409 });
  }

  mkdirSync(destDir, { recursive: true });
  writeFileSync(join(destDir, "chain.json"), JSON.stringify(chain, null, 2));

  return NextResponse.json({
    id: slug,
    name: typeof chain.name === "string" ? chain.name : slug,
    agentCount: agentCount(chain),
  });
}
