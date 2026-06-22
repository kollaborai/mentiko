// /api/preview/<port>/<path> — same-origin reverse proxy to an in-container
// dev server, so a scaffolded app (e.g. `next dev` on localhost:3001) can be
// previewed inside the mentiko UI without exposing a port or touching Caddy.
//
// SECURITY: the upstream host is hard-pinned to 127.0.0.1 and the port is
// checked against an allowlist (see lib/system/preview-proxy.ts). Never let the
// host be caller-controlled — that would be SSRF into internal services.

import { NextRequest, NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import {
  isAllowedPreviewPort,
  previewPrefix,
  rewriteHtmlForPreview,
  rewriteCssForPreview,
} from "@/lib/system/preview-proxy";

export const dynamic = "force-dynamic";

// upstream response headers we never pass through (framing + transport)
const STRIP_RESPONSE_HEADERS = new Set([
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "cross-origin-opener-policy",
  "cross-origin-embedder-policy",
  "cross-origin-resource-policy",
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
]);

// request headers we don't forward upstream (hop-by-hop / rewritten)
const SKIP_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "content-length",
  "accept-encoding",
  "upgrade",
  "proxy-connection",
]);

const UPSTREAM_TIMEOUT_MS = 30_000; // first-hit dev compiles can be slow

function frameable(headers: Headers): Headers {
  headers.set("x-frame-options", "SAMEORIGIN");
  return headers;
}

function messagePage(status: number, port: number, title: string, body: string): NextResponse {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  html,body{margin:0;height:100%;background:#0a0a0a;color:#e5e5e5;
    font:14px/1.6 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
  .wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;
    height:100%;text-align:center;padding:24px;box-sizing:border-box}
  h1{font-size:15px;font-weight:700;margin:0 0 8px;color:#fafafa}
  p{margin:4px 0;color:#a3a3a3;max-width:34rem}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;
    background:#171717;border:1px solid #262626;border-radius:6px;padding:2px 6px;color:#e5e5e5}
  .port{color:#f59e0b}
</style></head><body><div class="wrap">
<h1>${title}</h1>${body}
<p style="margin-top:14px">Port <span class="port">${port}</span></p>
</div></body></html>`;
  return new NextResponse(html, {
    status,
    headers: frameable(new Headers({ "content-type": "text/html; charset=utf-8" })),
  });
}

async function handle(
  request: NextRequest,
  ctx: { params: Promise<{ port: string; path?: string[] }> },
): Promise<NextResponse> {
  if (!(await checkAuth(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { port: portStr } = await ctx.params;
  const port = Number(portStr);
  if (!Number.isInteger(port) || !isAllowedPreviewPort(port)) {
    return messagePage(
      400,
      Number.isInteger(port) ? port : 0,
      "Preview port not allowed",
      `<p>This port isn't on the preview allowlist. Allowed ports default to
       <code>3001–3010</code> and can be set with <code>MENTIKO_PREVIEW_PORTS</code>.</p>`,
    );
  }

  // Reconstruct the upstream path from the raw pathname (avoids re-encoding the
  // catch-all segments) and keep the original query string verbatim.
  const prefix = previewPrefix(port);
  let upstreamPath = request.nextUrl.pathname.startsWith(prefix)
    ? request.nextUrl.pathname.slice(prefix.length)
    : "/";
  if (!upstreamPath.startsWith("/")) upstreamPath = `/${upstreamPath}`;
  const target = `http://127.0.0.1:${port}${upstreamPath}${request.nextUrl.search}`;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!SKIP_REQUEST_HEADERS.has(key.toLowerCase())) headers.set(key, value);
  });
  headers.set("host", `127.0.0.1:${port}`);
  headers.set("accept-encoding", "identity"); // avoid gzip/identity mismatch on passthrough

  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  const body = hasBody ? await request.arrayBuffer() : undefined;

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method,
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    const reason = err instanceof Error && err.name === "TimeoutError" ? "timed out" : "is not responding";
    return messagePage(
      502,
      port,
      "No dev server on this port",
      `<p>Nothing on <code>127.0.0.1:${port}</code> ${reason}.</p>
       <p>Start one in the workspace, e.g. <code>npm run dev -- -p ${port}</code>,
       then refresh. (Don't use 3000 — that's the platform.)</p>`,
    );
  }

  // Keep redirects inside the preview iframe.
  if (upstream.status >= 300 && upstream.status < 400) {
    const location = upstream.headers.get("location");
    const out = frameable(new Headers());
    if (location) {
      if (location.startsWith("/") && !location.startsWith("//")) {
        out.set("location", location.startsWith(`${prefix}/`) || location === prefix ? location : prefix + location);
      } else {
        const self = new RegExp(`^https?://(?:localhost|127\\.0\\.0\\.1):${port}`, "i");
        out.set("location", self.test(location) ? location.replace(self, prefix) : location);
      }
    }
    return new NextResponse(null, { status: upstream.status, headers: out });
  }

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) responseHeaders.set(key, value);
  });
  frameable(responseHeaders);

  if (method === "HEAD") {
    return new NextResponse(null, { status: upstream.status, headers: responseHeaders });
  }

  const contentType = upstream.headers.get("content-type") || "";

  if (contentType.includes("text/html")) {
    const rewritten = rewriteHtmlForPreview(await upstream.text(), port);
    responseHeaders.set("content-type", "text/html; charset=utf-8");
    return new NextResponse(rewritten, { status: upstream.status, headers: responseHeaders });
  }

  if (contentType.includes("text/css")) {
    const rewritten = rewriteCssForPreview(await upstream.text(), port);
    responseHeaders.set("content-type", contentType);
    return new NextResponse(rewritten, { status: upstream.status, headers: responseHeaders });
  }

  // everything else (JS, JSON, images, fonts, RSC streams) — pass through
  return new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const HEAD = handle;
export const OPTIONS = handle;
