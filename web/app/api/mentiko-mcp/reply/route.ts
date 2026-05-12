import { NextResponse } from "next/server";
import { consumeResult, storeResult } from "@/lib/mentiko-mcp-inbox";
import { validateRequest } from "@/lib/auth";
import { verifySessionToken } from "@/lib/session-token";

/**
 * GET /api/mentiko-mcp/reply?toolId=...&sessionId=...
 *
 * Polled by the MCP stdio subprocess while a synchronous ask_* tool
 * waits for the user's answer. Auth: shared inbox-key (subprocess channel).
 * sessionId query param scopes the result lookup.
 */
export async function GET(req: Request) {
  const inboxKey = req.headers.get("X-Mentiko-Inbox-Key");
  const expected = process.env.MENTIKO_INBOX_KEY;
  if (!expected) return new NextResponse("Server misconfigured", { status: 503 });
  if (!inboxKey || inboxKey !== expected) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const toolId = searchParams.get("toolId");
  const sessionId = searchParams.get("sessionId") || "global";
  if (!toolId) return new NextResponse("Missing toolId", { status: 400 });

  const result = consumeResult(sessionId, toolId);
  if (result === undefined) return new NextResponse("Not Found", { status: 404 });
  return NextResponse.json({ result });
}

/**
 * POST /api/mentiko-mcp/reply
 *
 * Called by the browser bar when the user answers an ask_* prompt.
 * Auth: signed-in session cookie (primary).
 * sessionId extracted from JWT bearer token (preferred) or request body.
 */
export async function POST(req: Request) {
  const cookieOk = await validateRequest(req);
  if (!cookieOk) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }

  const { toolId, result, sessionId: bodySessionId } = body ?? {};
  if (typeof toolId !== "string" || !toolId) {
    return new NextResponse("Missing toolId", { status: 400 });
  }

  // Resolve sessionId: JWT bearer token (preferred) or body field
  let sessionId = "global";
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    try {
      const claims = await verifySessionToken(authHeader.slice(7));
      sessionId = claims.jti;
    } catch {
      // token invalid — fall through to body sessionId
    }
  }
  if (sessionId === "global" && typeof bodySessionId === "string" && bodySessionId) {
    sessionId = bodySessionId;
  }

  storeResult(sessionId, toolId, result);
  return NextResponse.json({ ok: true });
}
