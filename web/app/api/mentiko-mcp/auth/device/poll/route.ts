import { NextRequest, NextResponse } from "next/server";
import { pollDeviceCode } from "@/lib/auth/mcp-device-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/mentiko-mcp/auth/device/poll?device_code=…
 *
 * Polls a device-authorization request. Possession of the secret device_code is
 * the authorization. On approval, returns the issued tokens exactly once.
 *
 *   { status: "pending" }                              → keep polling (200)
 *   { status: "approved", refresh_token, session_token } → success, once (200)
 *   { status: "denied" }                               → user denied (200)
 *   { status: "expired" }                              → code gone/expired (410)
 */
export async function GET(request: NextRequest) {
  const deviceCode = request.nextUrl.searchParams.get("device_code");
  if (!deviceCode) {
    return NextResponse.json({ error: "device_code required" }, { status: 400 });
  }

  const result = await pollDeviceCode(deviceCode);
  const httpStatus = result.status === "expired" ? 410 : 200;
  return NextResponse.json(result, { status: httpStatus });
}
