import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { exchangeRefreshToken } from "@/lib/auth/mcp-device-auth";
import { checkAndIncrementRateLimit } from "@/lib/api/refresh-rate-limiter";

export const dynamic = "force-dynamic";

/**
 * POST /api/mentiko-mcp/auth/token
 *
 * Exchange a long-lived refresh token for a fresh 24h access token. Possession
 * of the refresh token is the authorization; the bridge calls this silently on
 * 401. Rate-limited per refresh token (reuses the refresh-rate-limiter).
 *
 * Body: { refresh_token: string }
 *   → 200 { session_token, expires_in }
 *   → 401 { error: "invalid_grant" }   (revoked/expired/unknown → re-run device flow)
 */
export async function POST(request: NextRequest) {
  let body: { refresh_token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const refreshToken = (body.refresh_token || "").trim();
  if (!refreshToken) {
    return NextResponse.json({ error: "refresh_token required" }, { status: 400 });
  }

  // rate-limit by a stable, non-reversible key derived from the token
  const rlKey = "mcp_refresh:" + createHash("sha256").update(refreshToken).digest("hex").slice(0, 32);
  const allowed = await checkAndIncrementRateLimit(rlKey);
  if (!allowed) {
    return NextResponse.json({ error: "slow_down" }, { status: 429 });
  }

  const result = await exchangeRefreshToken(refreshToken);
  if (!result) {
    return NextResponse.json({ error: "invalid_grant" }, { status: 401 });
  }
  return NextResponse.json(result);
}
