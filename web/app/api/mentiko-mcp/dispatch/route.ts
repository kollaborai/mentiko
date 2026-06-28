import { NextResponse } from "next/server";
import { isEffectDelivered, pushEffect } from "@/lib/ai-engine/mentiko-mcp-inbox";
import { verifySignalToken } from "@/lib/auth/mcp-signal-token";

/**
 * POST /api/mentiko-mcp/dispatch
 *
 * Called by an MCP bridge to push a UI effect to a browser session's bar.
 * Two accepted credentials:
 *   - X-Mentiko-Inbox-Key: the static shared secret the app injects when it
 *     launches the bar's own bridge (drives the session in body.sessionId).
 *   - Authorization: Bearer <signaling token>: a scoped, user-approved grant
 *     (UI-control). It is BOUND to one sessionId, so effects route there only —
 *     body.sessionId is ignored for these callers. The token can't touch data
 *     (ops routes reject its audience).
 *
 * Body: { kind, payload?, sessionId? }
 */
async function authDispatch(
  req: Request,
): Promise<{ forcedSessionId?: string } | NextResponse> {
  const authz = req.headers.get("authorization");
  if (authz?.startsWith("Bearer ")) {
    try {
      const claims = await verifySignalToken(authz.slice(7));
      return { forcedSessionId: claims.sid };
    } catch {
      return new NextResponse("Unauthorized", { status: 401 });
    }
  }

  const inboxKey = req.headers.get("X-Mentiko-Inbox-Key");
  const expected = process.env.MENTIKO_INBOX_KEY;
  if (!expected) {
    return new NextResponse("Server misconfigured: MENTIKO_INBOX_KEY unset", {
      status: 503,
    });
  }
  if (!inboxKey || inboxKey !== expected) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  return {};
}

export async function GET(req: Request) {
  const auth = await authDispatch(req);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const sessionId =
    auth.forcedSessionId || url.searchParams.get("sessionId") || "global";
  if (!id) {
    return new NextResponse("Missing 'id'", { status: 400 });
  }

  return NextResponse.json({ delivered: isEffectDelivered(sessionId, id) });
}

export async function POST(req: Request) {
  const auth = await authDispatch(req);
  if (auth instanceof NextResponse) return auth;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }

  const bodyRecord =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const { kind, payload, sessionId = "global" } = bodyRecord;
  if (typeof kind !== "string" || !kind) {
    return new NextResponse("Missing 'kind'", { status: 400 });
  }

  // A scoped signaling token routes ONLY to its bound session — ignore body.sessionId.
  const routedSessionId =
    auth.forcedSessionId ||
    (typeof sessionId === "string" && sessionId ? sessionId : "global");

  const effect = pushEffect(
    kind,
    payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {},
    routedSessionId,
  );
  return NextResponse.json({ ok: true, id: effect.id });
}
