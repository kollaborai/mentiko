import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/auth";
import { getDeviceByUserCode } from "@/lib/auth/mcp-device-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/mentiko-mcp/auth/device/info?code=USER_CODE
 *
 * Cookie-authed. Returns what a device code is requesting (client label, scopes,
 * status) so the /mcp-auth approve page can show the user what they're granting.
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(request);
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.json({ error: "code required" }, { status: 400 });
  }

  const info = await getDeviceByUserCode(code);
  if (!info) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(info);
}
