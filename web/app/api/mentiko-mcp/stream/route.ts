import { NextResponse } from "next/server";
import { markEffectDelivered, popEffects } from "@/lib/mentiko-mcp-inbox";
import { verifySessionToken } from "@/lib/session-token";

export const dynamic = "force-dynamic";

function isClientAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (!error || typeof error !== "object") return false;

  const err = error as { code?: unknown; name?: unknown; message?: unknown };
  const code = typeof err.code === "string" ? err.code : "";
  const name = typeof err.name === "string" ? err.name : "";
  const message = typeof err.message === "string" ? err.message.toLowerCase() : "";

  return (
    code === "ECONNRESET" ||
    name === "AbortError" ||
    message === "aborted" ||
    message.includes("socket hang up") ||
    message.includes("connection reset")
  );
}

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
  const url = new URL(req.url);
  const sessionToken = url.searchParams.get("sessionToken");
  const sessionIdParam = url.searchParams.get("sessionId");
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
    // dev fallback: no token required when DATABASE_URL not set.
    // accept ?sessionId= so the bar can route effects to the engine session
    // it created (matches MENTIKO_SESSION_ID set on the MCP subprocess).
    sessionId = sessionIdParam || "global";
  } else {
    // production: hard fail
    return new NextResponse("Unauthorized: session token required", { status: 401 });
  }

  const responseStream = new TransformStream();
  const writer = responseStream.writable.getWriter();
  const encoder = new TextEncoder();

  let closed = false;
  const intervals: {
    poll?: ReturnType<typeof setInterval>;
    keepalive?: ReturnType<typeof setInterval>;
  } = {};

  const cleanup = () => {
    if (intervals.poll) clearInterval(intervals.poll);
    if (intervals.keepalive) clearInterval(intervals.keepalive);
  };

  const closeWriter = () => {
    writer.close().catch((error) => {
      if (!isClientAbortError(error, req.signal)) {
        console.error("[mentiko-mcp stream] failed to close stream", error);
      }
    });
  };

  const closeStream = () => {
    if (closed) return;
    closed = true;
    cleanup();
    closeWriter();
  };

  const handleStreamError = (error: unknown) => {
    if (!isClientAbortError(error, req.signal)) {
      console.error("[mentiko-mcp stream] stream error", error);
    }
    closeStream();
  };

  const writeSse = async (chunk: string) => {
    if (closed) return;
    try {
      await writer.write(encoder.encode(chunk));
    } catch (error) {
      handleStreamError(error);
    }
  };

  void writeSse(": connected\n\n");

  const tick = async () => {
    if (closed) return;
    const effects = popEffects(sessionId);
    for (const e of effects) {
      await writeSse(`data: ${JSON.stringify(e)}\n\n`);
      if (closed) return;
      markEffectDelivered(sessionId, e.id);
    }
  };

  intervals.poll = setInterval(() => {
    void tick().catch(handleStreamError);
  }, 500);

  intervals.keepalive = setInterval(() => {
    if (closed) return;
    void writeSse(": keep-alive\n\n");
  }, 20000);

  req.signal.addEventListener("abort", () => {
    closeStream();
  }, { once: true });

  return new NextResponse(responseStream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
