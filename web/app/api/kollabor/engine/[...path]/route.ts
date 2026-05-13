import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { NextRequest, NextResponse } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { getSessionUser } from "@/lib/auth-bridge";
import { mintSessionToken } from "@/lib/session-token";
import { randomBytes } from "crypto";

export const dynamic = "force-dynamic";

const ENGINE_BASE_URL =
  process.env.KOLLABOR_ENGINE_URL || "http://127.0.0.1:7433";

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

async function readEngineToken(): Promise<string> {
  const path = join(homedir(), ".kollab", "engine.token");
  const token = (await readFile(path, "utf8")).trim();
  if (!token) throw new Error("engine.token is empty");
  return token;
}

function upstreamHeaders(request: NextRequest, token?: string): Headers {
  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  const accept = request.headers.get("accept");
  if (contentType) headers.set("content-type", contentType);
  if (accept) headers.set("accept", accept);
  if (token) headers.set("authorization", `Bearer ${token}`);
  return headers;
}

function responseHeaders(upstream: Response): Headers {
  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  if (contentType?.includes("text/event-stream")) {
    headers.set("cache-control", "no-cache, no-transform");
    headers.set("x-accel-buffering", "no");
  }
  return headers;
}

async function proxyEngine(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  if (!(await checkAuth(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { path: pathParts = [] } = await context.params;
  const path = pathParts.map((part) => encodeURIComponent(part)).join("/");

  // B4: block PATCH and DELETE — no legitimate browser use; prevents direct
  // mutation of engine session state (e.g. session.user_token) via the proxy.
  // Exception: DELETE /profiles/{name} is allowed for profile management UI.
  const isProfileDelete =
    request.method === "DELETE" &&
    pathParts.length === 2 &&
    pathParts[0] === "profiles";
  if (request.method === "PATCH" || (request.method === "DELETE" && !isProfileDelete)) {
    return NextResponse.json({ error: "method not allowed" }, { status: 405 });
  }
  const upstreamUrl = `${ENGINE_BASE_URL}/${path}${request.nextUrl.search}`;
  const isHealth = request.method === "GET" && path === "health";

  let token: string | undefined;
  try {
    if (!isHealth) token = await readEngineToken();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `engine token unavailable: ${msg}` },
      { status: 503 },
    );
  }

  // Special case: POST /sessions — pre-generate session_id, mint token, inject into request
  // so the engine can pass MENTIKO_SESSION_TOKEN to MCP subprocess at spawn time.
  if (request.method === "POST" && pathParts.join("/") === "sessions") {
    try {
      const rawBody = await request.arrayBuffer();
      let requestBody: Record<string, unknown> = {};
      try { requestBody = JSON.parse(new TextDecoder().decode(rawBody)); } catch { /* empty body */ }

      let session_token: string | null = null;
      const engineSessionId: string = `sess_${randomBytes(6).toString("hex")}`;

      try {
        const user = await getSessionUser(request);
        if (!user) {
          return NextResponse.json(
            { error: "session token unavailable: user session required" },
            { status: 401 },
          );
        } else {
          try {
            session_token = await mintSessionToken({
              sub: user.id,
              jti: engineSessionId,
              ns:  user.namespaceId ?? "default",
              org: user.orgId ?? "default",
              role: user.role,
            });
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            return NextResponse.json(
              { error: `session token unavailable: ${msg}` },
              { status: 503 },
            );
          }
        }
      } catch {
        return NextResponse.json(
          { error: "session token unavailable: could not resolve user session" },
          { status: 401 },
        );
      }

      // Inject session_id and user_token into the body so the engine uses them at init time
      const enrichedBody = {
        ...requestBody,
        session_id: engineSessionId,
        ...(session_token ? { user_token: session_token } : {}),
      };

      const upstream = await fetch(upstreamUrl, {
        method: "POST",
        headers: upstreamHeaders(request, token),
        body: JSON.stringify(enrichedBody),
        cache: "no-store",
      });

      const upstreamJson = await upstream.json() as Record<string, unknown>;

      const responseBody = session_token
        ? { ...upstreamJson, session_token }
        : upstreamJson;

      return NextResponse.json(responseBody, {
        status: upstream.status,
        headers: responseHeaders(upstream),
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        { error: `engine unavailable: ${msg}` },
        { status: 503 },
      );
    }
  }

  // All other paths: streaming passthrough unchanged
  try {
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const body = hasBody ? await request.arrayBuffer() : undefined;
    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers: upstreamHeaders(request, token),
      body,
      cache: "no-store",
    });

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders(upstream),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `engine unavailable: ${msg}` },
      { status: 503 },
    );
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  return proxyEngine(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return proxyEngine(request, context);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  return proxyEngine(request, context);
}

// PATCH and DELETE are exported so Next.js routes them, but proxyEngine
// returns 405 before reaching the engine.
export async function PATCH(request: NextRequest, context: RouteContext) {
  return proxyEngine(request, context);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return proxyEngine(request, context);
}
