import { NextResponse } from "next/server";
import { requireOpsAuth, requireOpsPermission } from "@/lib/ai-engine/mentiko-mcp-ops-auth";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { orgPath } from "@/lib/config";

export const dynamic = "force-dynamic";
const SAFE_CHAIN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * POST /api/mentiko-mcp/ops/context/runs
 * Start a chain run. Delegates to the existing /api/chains/run route
 * using the trusted internal service bearer auth accepted by auth-bridge.
 */
export async function POST(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  const perm = requireOpsPermission(ctx, "manage_chains", "runs:start");
  if (perm) return perm;

  const { namespaceId, orgId } = ctx;
  const { chainId, task, workspaceId, workspacePath, debug, taskId, startAgent } = (await req.json()) as {
    chainId?: string;
    task?: string;
    workspaceId?: string;
    workspacePath?: string;
    debug?: boolean;
    taskId?: string;
    startAgent?: string;
  };

  if (!chainId) return new NextResponse("chainId required", { status: 400 });
  if (!SAFE_CHAIN_ID_RE.test(chainId)) {
    return new NextResponse("invalid chainId", { status: 400 });
  }

  const chainPath = join(orgPath(namespaceId, orgId, "chains", chainId), "chain.json");
  if (!existsSync(chainPath)) {
    return new NextResponse(`Chain not found: ${chainId}`, { status: 404 });
  }

  const chain = JSON.parse(readFileSync(chainPath, "utf-8"));

  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    return new NextResponse("BETTER_AUTH_SECRET required for MCP start_run", { status: 500 });
  }

  const res = await fetch(`${new URL(req.url).origin}/api/chains/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
      "x-namespace-id": namespaceId,
      "x-org-id": orgId,
    },
    body: JSON.stringify({
      chain,
      chainId,
      userPrompt: task || "",
      workspaceId,
      workspacePath,
      debug,
      taskId,
      startAgent,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    return new NextResponse(`Failed to start run: ${text}`, { status: res.status });
  }

  const data = await res.json();
  const runId = data?.data?.runId || data?.runId;
  return NextResponse.json({ runId });
}
