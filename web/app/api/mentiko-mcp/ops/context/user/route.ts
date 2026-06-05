import { NextResponse } from "next/server";
import { requireOpsAuth } from "@/lib/ai-engine/mentiko-mcp-ops-auth";

export const dynamic = "force-dynamic";

/** GET /api/mentiko-mcp/ops/context/user — current logged-in user info */
export async function GET(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;

  const { namespaceId, orgId } = ctx;

  // In the tenant model there's exactly one user per container.
  // We read what we can without hitting the auth DB (avoids coupling).
  // If auth DB is accessible, richer data can be added later.
  return NextResponse.json({
    namespaceId,
    orgId,
    // environment-level user hints (set by process-manager or entrypoint)
    email: process.env.MENTIKO_USER_EMAIL || null,
    name: process.env.MENTIKO_USER_NAME || null,
    role: process.env.MENTIKO_USER_ROLE || "owner",
    isAdmin: process.env.MENTIKO_IS_ADMIN === "true",
  });
}
