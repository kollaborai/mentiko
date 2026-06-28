import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/auth";
import { getSessionUser } from "@/lib/auth/auth-bridge";
import { revokeRefreshToken } from "@/lib/auth/mcp-device-auth";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/account/mcp-tokens/[id]
 * Revoke one of the current user's MCP refresh tokens. Once revoked, the bridge
 * can no longer exchange it for access tokens (must re-run the device flow).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(request);
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const user = await getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const result = await revokeRefreshToken(id, user.id);
  if (!result.ok) {
    return NextResponse.json({ error: "not found or already revoked" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
