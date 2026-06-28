import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/auth";
import { getSessionUser } from "@/lib/auth/auth-bridge";
import { listRefreshTokens } from "@/lib/auth/mcp-device-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/account/mcp-tokens
 * List the current user's MCP refresh tokens (device-flow connections).
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(request);
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const user = await getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const tokens = await listRefreshTokens(user.id);
  return NextResponse.json({ tokens });
}
