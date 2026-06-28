import { NextResponse } from "next/server";
import { createUiGrant } from "@/lib/auth/mcp-device-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/mentiko-mcp/ui-control/start
 *
 * Begin a UI-control grant. Unauthenticated by design (mirrors device/start) —
 * the security anchor is the cookie-authed approve page, where a logged-in user
 * in a specific window approves and binds THAT window's sessionId.
 *
 * Body: { client_label?: string }
 * Returns: { device_code, user_code, verification_url, interval, expires_in }
 */
export async function POST(req: Request) {
  let body: { client_label?: string } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine
  }
  const base = process.env.BETTER_AUTH_URL || new URL(req.url).origin;
  const grant = await createUiGrant({
    verificationBase: base,
    clientLabel: body.client_label,
  });
  if (!grant) {
    return NextResponse.json(
      { error: "ui-control unavailable (no database)" },
      { status: 503 },
    );
  }
  return NextResponse.json(grant);
}
