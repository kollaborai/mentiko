import { NextResponse } from "next/server";
import { requireOpsAuth } from "@/lib/ai-engine/mentiko-mcp-ops-auth";
import { listWorkspaces } from "@/lib/workspaces/workspace-storage";

export const dynamic = "force-dynamic";

/** GET /api/mentiko-mcp/ops/context/workspaces — list all workspaces */
export async function GET(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;

  const { namespaceId, orgId } = ctx;
  const workspaces = listWorkspaces(namespaceId, orgId);
  return NextResponse.json({ workspaces });
}
