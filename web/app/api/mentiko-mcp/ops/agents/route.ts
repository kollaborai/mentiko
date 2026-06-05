import { NextResponse } from "next/server";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { orgPath } from "@/lib/config";
import { getAllStandaloneAgents } from "@/lib/agents/agent-loader";
import { requireOpsAuth, requireOpsPermission } from "@/lib/ai-engine/mentiko-mcp-ops-auth";

/**
 * /api/mentiko-mcp/ops/agents
 *
 * GET   list agent definitions
 * POST  {name, prompt, profile?, triggers?, emits?} create standalone agent
 */

export const dynamic = "force-dynamic";

function sanitizeSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export async function GET(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;

  const { namespaceId, orgId } = ctx;
  const agents = getAllStandaloneAgents(namespaceId, orgId);
  return NextResponse.json({ agents });
}

export async function POST(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  const perm = requireOpsPermission(ctx, "manage_chains", "agents:write");
  if (perm) return perm;

  const { namespaceId, orgId } = ctx;
  const { name, prompt, profile, triggers, emits } = (await req.json()) as {
    name?: string;
    prompt?: string;
    profile?: string;
    triggers?: string[];
    emits?: string;
  };

  if (!name || !prompt) {
    return new NextResponse("name and prompt required", { status: 400 });
  }

  const slug = sanitizeSlug(name);
  if (!slug) return new NextResponse("Invalid name", { status: 400 });

  const agentDir = orgPath(namespaceId, orgId, "agents", slug);
  const agentPath = join(agentDir, "agent.json");
  if (existsSync(agentPath)) {
    return new NextResponse(`Agent already exists: ${slug}`, { status: 409 });
  }

  const now = new Date().toISOString();
  const agent = {
    id: slug,
    name,
    role: "agent",
    prompt,
    profile: profile || null,
    triggers: triggers || ["start"],
    emits: emits || "done",
    created_at: now,
    updated_at: now,
  };

  mkdirSync(agentDir, { recursive: true });
  writeFileSync(agentPath, JSON.stringify(agent, null, 2));
  return NextResponse.json({ id: slug, name, path: agentPath });
}
