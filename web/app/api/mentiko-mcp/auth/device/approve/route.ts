import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/auth";
import { getSessionUser } from "@/lib/auth/auth-bridge";
import { approveDeviceCode, denyDeviceCode } from "@/lib/auth/mcp-device-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/mentiko-mcp/auth/device/approve
 *
 * Approve or deny a device-authorization request. COOKIE-AUTHED ONLY — this is
 * the security anchor: only a logged-in user can issue an MCP refresh token, and
 * it is bound to that user's identity. No bearer tokens accepted.
 *
 * Body: { user_code: string, decision: "approve" | "deny" }
 */
export async function POST(request: NextRequest) {
  // same-origin guard (CSRF): the approve page posts from the app itself
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) {
        return NextResponse.json({ error: "bad origin" }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: "bad origin" }, { status: 403 });
    }
  }

  // cookie session only (not checkAuth — must reject bearer tokens here)
  const session = await getServerSession(request);
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const user = await getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: "could not resolve user" }, { status: 401 });
  }

  let body: { user_code?: string; decision?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const userCode = (body.user_code || "").trim();
  if (!userCode) {
    return NextResponse.json({ error: "user_code required" }, { status: 400 });
  }

  if (body.decision === "deny") {
    await denyDeviceCode(userCode);
    return NextResponse.json({ ok: true, decision: "deny" });
  }

  const result = await approveDeviceCode(userCode, {
    id: user.id,
    namespaceId: user.namespaceId,
    orgId: user.orgId,
    role: user.role,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error || "approval failed" }, { status: 409 });
  }
  return NextResponse.json({ ok: true, decision: "approve" });
}
