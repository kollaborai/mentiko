import { NextResponse } from "next/server";
import { pollUiGrant } from "@/lib/auth/mcp-device-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/mentiko-mcp/ui-control/poll?device_code=...
 *
 * Bridge polls this after starting a grant. On approval it returns the scoped
 * signaling token + bound sessionId exactly once (single-use pickup).
 *
 * Returns: { status: "pending"|"approved"|"denied"|"expired", signaling_token?, session_id? }
 */
export async function GET(req: Request) {
  const deviceCode = new URL(req.url).searchParams.get("device_code");
  if (!deviceCode) {
    return NextResponse.json({ error: "device_code required" }, { status: 400 });
  }
  const result = await pollUiGrant(deviceCode);
  return NextResponse.json(result);
}
