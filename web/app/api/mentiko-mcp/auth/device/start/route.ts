import { NextRequest, NextResponse } from "next/server";
import { createDeviceCode } from "@/lib/auth/mcp-device-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/mentiko-mcp/auth/device/start
 *
 * Begins a device-authorization flow. No session token required — this is the
 * bootstrap a standalone MCP client calls when it has no valid token. Returns a
 * secret device_code (client polls with it) + a magic verification_url.
 *
 * Body (optional): { client_label?: string, scopes?: string[] }
 */
export async function POST(request: NextRequest) {
  let body: { client_label?: string; scopes?: string[] } = {};
  try {
    body = await request.json();
  } catch {
    // empty body is fine
  }

  // Verification link base: the tenant's public URL in prod (BETTER_AUTH_URL),
  // falling back to the request origin for local/dev.
  const origin = request.nextUrl.origin;
  const verificationBase = process.env.BETTER_AUTH_URL || origin;

  const result = await createDeviceCode({
    verificationBase,
    clientLabel: typeof body.client_label === "string" ? body.client_label : undefined,
    scopes: Array.isArray(body.scopes) ? body.scopes.filter((s) => typeof s === "string") : undefined,
  });

  if (!result) {
    return NextResponse.json({ error: "device flow unavailable" }, { status: 503 });
  }
  return NextResponse.json(result);
}
