import { NextResponse } from "next/server";
import { markEffectDelivered, popEffects } from "@/lib/mentiko-mcp-inbox";
import { verifySessionToken } from "@/lib/session-token";

export const dynamic = "force-dynamic";

/**
 * GET /api/mentiko-mcp/stream?sessionToken=<jwt>
 *
 * SSE stream delivering UI effects dispatched by the mentiko-mcp subprocess,
 * routed to the specific session that initiated the agent turn.
 *
 * Auth:
 *   - sessionToken query param (JWT): effects routed to that session's bucket.
 *   - dev fallback (DATABASE_URL not set): no token required, routes to "global" bucket.
 *   - production (DATABASE_URL set): hard-fail if no valid token.
 */
export async function GET(req: Request) {
  const sessionToken = new URL(req.url).searchParams.get("sessionToken");
  const isDev = !process.env.DATABASE_URL;
  let sessionId: string;

  if (sessionToken) {
    try {
      const claims = await verifySessionToken(sessionToken);
      sessionId = claims.jti;
    } catch {
      return new NextResponse("Invalid session token", { status: 401 });
    }
  } else if (isDev) {
    // dev fallback: no token required when DATABASE_URL not set
    sessionId = "global";
  } else {
    // production: hard fail
    return new NextResponse("Unauthorized: session token required", { status: 401 });
  }

  const responseStream = new TransformStream();
  const writer = responseStream.writable.getWriter();
  const encoder = new TextEncoder();

  void writer.write(encoder.encode(": connected\n\n"));

  let closed = false;
  const tick = async () => {
    if (closed) return;
    try {
      const effects = popEffects(sessionId);
      for (const e of effects) {
        await writer.write(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        markEffectDelivered(sessionId, e.id);
      }
    } catch {
      closed = true;
      try {
        await writer.close();
      } catch {}
    }
  };

  const pollInterval = setInterval(() => {
    void tick();
  }, 500);

  const keepalive = setInterval(() => {
    if (closed) return;
    void writer.write(encoder.encode(": keep-alive\n\n")).catch(() => {
      closed = true;
    });
  }, 20000);

  req.signal.addEventListener("abort", () => {
    closed = true;
    clearInterval(pollInterval);
    clearInterval(keepalive);
    try {
      void writer.close();
    } catch {}
  });

  return new NextResponse(responseStream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
