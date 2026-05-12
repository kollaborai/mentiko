import { NextResponse } from "next/server";
import { requireOpsAuth } from "@/lib/mentiko-mcp-ops-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/mentiko-mcp/ops/context
 *
 * Dispatched as sub-paths via the router — each sub-path has its own route.ts.
 * This parent is a catch-all that returns 404 to prevent accidental hits.
 */
export async function GET(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  return new NextResponse("Use /ops/context/user, /workspace, /activity, or /workspaces", { status: 404 });
}
