import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/auth-bridge";
import { getServerSession } from "@/lib/auth/auth";
import { mintSessionToken } from "@/lib/auth/session-token";
import { decodeSessionTokenClaims } from "@/lib/auth/session-token";
import { checkAndIncrementRateLimit } from "@/lib/api/refresh-rate-limiter";
import { timingSafeEqual } from "@/lib/auth/security";
import type { OrgRole } from "@/lib/orgs/org-types";

export const dynamic = "force-dynamic";

const ENGINE_BASE_URL =
  process.env.KOLLABOR_ENGINE_URL || "http://127.0.0.1:7433";

type RouteContext = {
  params: Promise<{ id: string }>;
};

async function readEngineToken(): Promise<string> {
  const path = join(homedir(), ".kollab", "engine.token");
  const token = (await readFile(path, "utf8")).trim();
  if (!token) throw new Error("engine.token is empty");
  return token;
}

/**
 * POST /api/kollabor/engine/sessions/:id/refresh-token
 *
 * Re-mints a session JWT for an existing engine session.
 *
 * Two auth paths:
 *   1. Browser session cookie — bar refreshes after SSE 401
 *   2. INTERNAL_SERVICE_SECRET bearer — engine calls this on behalf of MCP
 *      subprocess when the subprocess gets a 401 from an ops route. The engine
 *      sends the original session token as x-session-token; claims are extracted
 *      with signature verification but without expiry enforcement (the token may
 *      already be expired — that is why it is being refreshed).
 *
 * Response: { session_token: "<jwt>" }
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { id: engineSessionId } = await context.params;
  if (!engineSessionId) {
    return NextResponse.json({ error: "session id required" }, { status: 400 });
  }

  // Determine auth path: internal engine call vs. browser session cookie.
  const authHeader = request.headers.get("authorization") ?? "";
  const INTERNAL_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET;
  const isInternalEngineCall =
    !!INTERNAL_SERVICE_SECRET &&
    authHeader.startsWith("Bearer ") &&
    timingSafeEqual(authHeader.slice(7), INTERNAL_SERVICE_SECRET);

  let sub: string;
  let ns: string;
  let org: string;
  let role: OrgRole | undefined;
  let scopes: string[] | undefined;

  if (isInternalEngineCall) {
    // ---- internal engine path ------------------------------------------------

    // 5C: origin restriction — request must originate from loopback.
    // Next.js dev server injects x-forwarded-for = socket.remoteAddress so we
    // can't use xff absence as proof of loopback; instead check xff IS a loopback
    // address. Defence-in-depth: if INTERNAL_SERVICE_SECRET leaks, external callers
    // (proxied through a non-loopback address) still can't reach the internal path.
    const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
    const xff = request.headers.get("x-forwarded-for")?.split(",")[0].trim();
    const host = request.headers.get("host") ?? "";
    const xffOk = !xff || LOOPBACK.has(xff);
    const hostOk = !host || host.startsWith("127.0.0.1") || host.startsWith("localhost");
    if (!xffOk || !hostOk) {
      return NextResponse.json({ error: "origin not allowed" }, { status: 403 });
    }

    // 5A: rate limiting — max 10 refreshes per session per 60s.
    const allowed = await checkAndIncrementRateLimit(engineSessionId);
    if (!allowed) {
      return NextResponse.json({ error: "rate limit exceeded" }, { status: 429 });
    }

    // 5B: verify the session exists on the engine before minting.
    try {
      const engineToken = await readEngineToken();
      const sessionCheck = await fetch(
        `${ENGINE_BASE_URL}/sessions/${engineSessionId}`,
        { headers: { authorization: `Bearer ${engineToken}` } }
      );
      if (!sessionCheck.ok) {
        return NextResponse.json({ error: "session not found" }, { status: 401 });
      }
    } catch {
      return NextResponse.json({ error: "session not found" }, { status: 401 });
    }

    // Issue 4: read x-session-token, verify signature (skip expiry), extract claims.
    const xSessionToken = request.headers.get("x-session-token");
    if (!xSessionToken) {
      return NextResponse.json({ error: "x-session-token required" }, { status: 401 });
    }

    let claims;
    try {
      claims = await decodeSessionTokenClaims(xSessionToken);
    } catch {
      return NextResponse.json({ error: "invalid session token" }, { status: 401 });
    }

    sub = claims.sub;
    ns  = claims.ns;
    org = claims.org;
    role = claims.role;
    scopes = claims.scopes;

  } else {
    // ---- browser call path — cookie only, no bearer tokens accepted ----------
    // Using getServerSession directly (not checkAuth) to ensure only the session
    // cookie is accepted. Bearer tokens (including BETTER_AUTH_SECRET) must use
    // the internal engine path above.
    const session = await getServerSession(request);
    if (!session?.user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const user = await getSessionUser(request);
    if (!user) {
      return NextResponse.json({ error: "could not resolve user" }, { status: 401 });
    }
    sub = user.id;
    ns  = user.namespaceId ?? "default";
    org = user.orgId ?? "default";
    role = user.role;
  }

  let session_token: string;
  try {
    session_token = await mintSessionToken({ sub, jti: engineSessionId, ns, org, role, scopes });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `token mint failed: ${msg}` }, { status: 503 });
  }

  return NextResponse.json({ session_token });
}
