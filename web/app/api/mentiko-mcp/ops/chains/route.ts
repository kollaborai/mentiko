import { NextResponse } from "next/server";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { orgPath } from "@/lib/config";
import { getAllChains } from "@/lib/chains/chain-utils";
import { requireOpsAuth, requireOpsPermission } from "@/lib/ai-engine/mentiko-mcp-ops-auth";

/**
 * /api/mentiko-mcp/ops/chains
 *
 * Internal chain CRUD for the mentiko-mcp stdio subprocess. JWT session auth.
 * Scoped to the namespace/org from the token — no bypass path.
 *
 * GET              list chain summaries (no agents[]); ?id= returns one full chain
 * POST   {name}    create a new empty chain draft
 * PATCH  {id,name} rename a chain (rename its directory)
 * DELETE ?id=      delete a chain
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

function agentCount(chain: Record<string, unknown>): number {
  return Array.isArray(chain.agents) ? chain.agents.length : 0;
}

function isAgentRef(value: unknown, agentId: string): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { $ref?: unknown }).$ref === agentId
  );
}

export async function GET(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;

  const { namespaceId, orgId } = ctx;
  const chainsDir = orgPath(namespaceId, orgId, "chains");
  const chains = getAllChains(chainsDir, "claude", undefined, namespaceId, orgId);

  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const slug = sanitizeSlug(id);
    const chain = chains.find((entry) => entry.id === slug || entry.name === id);
    if (!chain) return new NextResponse(`Chain not found: ${slug}`, { status: 404 });
    return NextResponse.json({ chain });
  }

  // Summaries only. Every chain inlines its full agent definitions (prompts
  // included), so the unfiltered list ran ~134KB across 28 chains and blew the
  // MCP response budget — the tool could never return at all. agentCount
  // already carries the shape; ?id= fetches the full definition on demand.
  const summaries = chains.map(({ agents: _agents, ...summary }) => summary);
  return NextResponse.json({ chains: summaries });
}

export async function POST(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  const perm = requireOpsPermission(ctx, "manage_chains", "chains:write");
  if (perm) return perm;

  const { namespaceId, orgId } = ctx;
  const body = (await req.json()) as {
    name?: string;
    template?: string;
    chain?: Record<string, unknown>;
    overwrite?: boolean;
  };
  const { name, chain: chainInput, overwrite } = body;

  if (!name) return new NextResponse("Missing 'name'", { status: 400 });

  const slug = sanitizeSlug(name);
  if (!slug) return new NextResponse("Invalid name", { status: 400 });

  const chainDir = orgPath(namespaceId, orgId, "chains", slug);
  const chainPath = join(chainDir, "chain.json");
  if (existsSync(chainPath) && !overwrite) {
    return new NextResponse(`Chain already exists: ${slug}`, { status: 409 });
  }

  mkdirSync(chainDir, { recursive: true });

  // Merge with defaults — caller can provide a full chain.json for
  // "save this generated chain" or omit it for "create a blank draft".
  const defaults = {
    name: slug,
    version: "1.0.0",
    description: "",
    config: {
      session_prefix: slug.slice(0, 16),
      max_rounds: 3,
      monitor: false,
      monitor_interval: 30,
      event_triggers: [] as unknown[],
    },
    agents: [] as unknown[],
  };

  const chain: Record<string, unknown> = chainInput
    ? {
        ...defaults,
        ...chainInput,
        name: slug,
        config: {
          ...defaults.config,
          ...((chainInput.config as Record<string, unknown>) || {}),
        },
      }
    : defaults;

  writeFileSync(chainPath, JSON.stringify(chain, null, 2));
  return NextResponse.json({
    id: slug,
    name: slug,
    path: chainPath,
    agentCount: agentCount(chain),
  });
}

export async function PATCH(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  const perm = requireOpsPermission(ctx, "manage_chains", "chains:write");
  if (perm) return perm;

  const { namespaceId, orgId } = ctx;
  const body = (await req.json()) as {
    action?: string;
    id?: string;
    name?: string;
    chainId?: string;
    agentId?: string;
    position?: number;
  };

  // agent attachment / detachment
  if (body.action === "attach_agent" || body.action === "detach_agent") {
    const { action, chainId, agentId, position } = body;
    if (!chainId || !agentId) {
      return new NextResponse("chainId and agentId required", { status: 400 });
    }
    const slug = sanitizeSlug(chainId);
    const chainFilePath = join(orgPath(namespaceId, orgId, "chains", slug), "chain.json");
    if (!existsSync(chainFilePath)) {
      return new NextResponse(`Chain not found: ${slug}`, { status: 404 });
    }
    const chain = JSON.parse(readFileSync(chainFilePath, "utf-8")) as Record<string, unknown>;
    const agents: unknown[] = Array.isArray(chain.agents) ? chain.agents : [];
    const ref = { $ref: agentId };

    if (action === "attach_agent") {
      // don't duplicate
      const alreadyAttached = agents.some((agent) => isAgentRef(agent, agentId));
      if (!alreadyAttached) {
        if (typeof position === "number" && position >= 0 && position <= agents.length) {
          agents.splice(position, 0, ref);
        } else {
          agents.push(ref);
        }
      }
    } else {
      // detach: remove all refs matching agentId
      const before = agents.length;
      const remainingAgents = agents.filter((agent) => !isAgentRef(agent, agentId));
      chain.agents = remainingAgents;
      if (remainingAgents.length === before) {
        return new NextResponse(`Agent ${agentId} not found in chain`, { status: 404 });
      }
    }

    if (action === "attach_agent") chain.agents = agents;
    writeFileSync(chainFilePath, JSON.stringify(chain, null, 2));
    return NextResponse.json({
      chainId: slug,
      agentId,
      agentCount: agentCount(chain),
    });
  }

  // rename (original behavior)
  const { id, name } = body;
  if (!id || !name) {
    return new NextResponse("id and name required", { status: 400 });
  }

  const slug = sanitizeSlug(id);
  const newSlug = sanitizeSlug(name);
  const srcPath = join(orgPath(namespaceId, orgId, "chains", slug), "chain.json");
  if (!existsSync(srcPath)) {
    return new NextResponse("Chain not found", { status: 404 });
  }

  const chain = JSON.parse(readFileSync(srcPath, "utf-8")) as Record<string, unknown>;
  chain.name = name;
  chain.id = newSlug;

  if (slug === newSlug) {
    writeFileSync(srcPath, JSON.stringify(chain, null, 2));
    return NextResponse.json({ id: newSlug, name });
  }

  const newDir = orgPath(namespaceId, orgId, "chains", newSlug);
  if (existsSync(newDir)) {
    return new NextResponse("Target slug already exists", { status: 409 });
  }
  const { renameSync } = await import("fs");
  renameSync(orgPath(namespaceId, orgId, "chains", slug), newDir);
  writeFileSync(join(newDir, "chain.json"), JSON.stringify(chain, null, 2));
  return NextResponse.json({ id: newSlug, name });
}

export async function DELETE(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  const perm = requireOpsPermission(ctx, "manage_chains", "chains:write");
  if (perm) return perm;

  const { namespaceId, orgId } = ctx;
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return new NextResponse("Missing id", { status: 400 });

  const dir = orgPath(namespaceId, orgId, "chains", sanitizeSlug(id));
  if (!existsSync(dir)) return new NextResponse("Not found", { status: 404 });
  rmSync(dir, { recursive: true, force: true });
  return NextResponse.json({ ok: true });
}
