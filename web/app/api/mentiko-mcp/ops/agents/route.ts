import { NextResponse } from "next/server";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { orgPath } from "@/lib/config";
import { getAllStandaloneAgents } from "@/lib/agents/agent-loader";
import { requireOpsAuth, requireOpsPermission } from "@/lib/ai-engine/mentiko-mcp-ops-auth";

/**
 * /api/mentiko-mcp/ops/agents
 *
 * GET   list agent summaries (prompt truncated); ?id= returns one full agent
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

// Summary projection is a WHITELIST, not "everything minus prompt". Agent
// records carry several unbounded prose fields (prompt, deliverable,
// verification, success_assertion); blacklisting only the largest one still
// left ~62KB across 47 agents. A whitelist keeps the list bounded no matter
// what prose fields get added to the schema later.
const AGENT_SUMMARY_FIELDS = [
  "id",
  "name",
  "role",
  "version",
  "description",
  "triggers",
  "emits",
  "tags",
  "category",
  "model",
  "authorities",
  "final_verifier",
] as const;

export async function GET(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;

  const { namespaceId, orgId } = ctx;
  const agents = getAllStandaloneAgents(namespaceId, orgId);

  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const slug = sanitizeSlug(id);
    const agent = agents.find((entry) => entry.id === slug || entry.name === id);
    if (!agent) return new NextResponse(`Agent not found: ${slug}`, { status: 404 });
    return NextResponse.json({ agent });
  }

  // The unfiltered list ran ~138KB across 47 agents and blew the MCP response
  // budget — the tool could never return at all. ?id= fetches the full record.
  const summaries = agents.map((agent) => {
    const record = agent as unknown as Record<string, unknown>;
    const summary: Record<string, unknown> = {};
    for (const field of AGENT_SUMMARY_FIELDS) {
      if (record[field] !== undefined) summary[field] = record[field];
    }
    summary.promptChars = typeof record.prompt === "string" ? record.prompt.length : 0;
    return summary;
  });
  return NextResponse.json({ agents: summaries });
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
