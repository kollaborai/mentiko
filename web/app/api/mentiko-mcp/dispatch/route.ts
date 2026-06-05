import { NextResponse } from "next/server";
import { isEffectDelivered, pushEffect } from "@/lib/ai-engine/mentiko-mcp-inbox";

/**
 * POST /api/mentiko-mcp/dispatch
 *
 * Called by the mentiko-mcp stdio subprocess to push a UI effect to the bar.
 * Auth: shared-secret header (MENTIKO_INBOX_KEY). This is the signaling
 * channel — inbox key is retained here, not on data ops routes.
 *
 * Body: { kind, payload?, sessionId? }
 * sessionId routes the effect to the specific browser session that initiated
 * the agent turn. Falls back to "global" if not provided.
 */
function requireInboxKey(req: Request): NextResponse | null {
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
  return null;
}

export async function GET(req: Request) {
  const authError = requireInboxKey(req);
  if (authError) return authError;

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const sessionId = url.searchParams.get("sessionId") || "global";
  if (!id) {
    return new NextResponse("Missing 'id'", { status: 400 });
  }

  return NextResponse.json({ delivered: isEffectDelivered(sessionId, id) });
}

export async function POST(req: Request) {
  const authError = requireInboxKey(req);
  if (authError) return authError;

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

  const effect = pushEffect(
    kind,
    payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {},
    typeof sessionId === "string" && sessionId ? sessionId : "global",
  );
  return NextResponse.json({ ok: true, id: effect.id });
}
