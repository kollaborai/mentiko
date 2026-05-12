import { NextResponse } from "next/server";
import { getCurrentPage, setCurrentPage } from "@/lib/mentiko-mcp-inbox";
import { validateRequest } from "@/lib/auth";
import { requireOpsAuth } from "@/lib/mentiko-mcp-ops-auth";

/**
 * /api/mentiko-mcp/current-page
 *
 * GET  session JWT (MCP subprocess) or browser cookie — returns current page
 * POST browser cookie — bar pushes updates whenever the route changes
 */
export async function GET(req: Request) {
  // Accept session JWT (MCP subprocess via Bearer) or browser cookie
  const authHeader = req.headers.get("authorization");
  let sessionId = "global";
  if (authHeader?.startsWith("Bearer ")) {
    const ctx = await requireOpsAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    sessionId = ctx.sessionId;
  } else {
    const cookieOk = await validateRequest(req);
    if (!cookieOk) return new NextResponse("Unauthorized", { status: 401 });
    sessionId = new URL(req.url).searchParams.get("sessionId") || "global";
  }

  const page = getCurrentPage(sessionId);
  return NextResponse.json({ page });
}

export async function POST(req: Request) {
  const inboxKey = req.headers.get("X-Mentiko-Inbox-Key");
  const expectedKey = process.env.MENTIKO_INBOX_KEY;
  const inboxKeyOk = !!expectedKey && inboxKey === expectedKey;
  const authHeader = req.headers.get("authorization");
  let authSessionId: string | null = null;

  if (authHeader?.startsWith("Bearer ")) {
    const ctx = await requireOpsAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    authSessionId = ctx.sessionId;
  } else {
    const cookieOk = inboxKeyOk ? true : await validateRequest(req);
    if (!cookieOk && !inboxKeyOk) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }

  const bodyRecord =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const { pathname, search, label, sessionId: bodySessionId } = bodyRecord;
  if (typeof pathname !== "string") {
    return new NextResponse("pathname required", { status: 400 });
  }

  const sessionId =
    authSessionId ??
    (typeof bodySessionId === "string" && bodySessionId ? bodySessionId : "global");

  setCurrentPage(sessionId, {
    pathname,
    search: typeof search === "string" ? search : "",
    label: typeof label === "string" ? label : undefined,
    updatedAt: Date.now(),
  });
  return NextResponse.json({ ok: true });
}
