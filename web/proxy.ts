import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSecurityHeaders } from "@/lib/security";
import { getStore, LIMITS, OPT_OUT_PATHS } from "@/lib/rate-limit";
// note: CSRF validation via double-submit cookie is deferred.
// SameSite=Strict on session cookies already mitigates CSRF risk.
// Full CSRF token validation would require auth-client.ts to send x-csrf-token header.

function getUserId(request: NextRequest): string {
  const sessionToken =
    request.cookies.get("__Secure-better-auth.session_token")?.value ||
    request.cookies.get("better-auth.session_token")?.value;

  if (sessionToken) return `user:${sessionToken.slice(0, 16)}`;

  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return `bearer:${authHeader.slice(7, 23)}`;
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    "anonymous";
  return `ip:${ip}`;
}

function getTenantId(request: NextRequest): string {
  const nsHeader = request.headers.get("x-namespace-id");
  if (nsHeader) return `tenant:${nsHeader}`;
  return getUserId(request);
}

function isOptOut(pathname: string): boolean {
  return OPT_OUT_PATHS.some((p) => pathname.startsWith(p));
}

function rateLimitedResponse(retryAfterSec: number) {
  return NextResponse.json(
    { error: "rate_limited", retry_after_seconds: retryAfterSec },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSec) },
    },
  );
}

async function applyRateLimit(
  request: NextRequest,
  _response: NextResponse
): Promise<NextResponse | null> {
  if (process.env.DISABLE_RATE_LIMITING === "true") return null;

  const { pathname } = request.nextUrl;

  if (!pathname.startsWith("/api/")) return null;

  if (isOptOut(pathname)) return null;

  // internal service calls (chain-runner, watchdog, scheduler) use bearer
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) return null;

  const store = getStore();
  const userId = getUserId(request);
  const tenantId = getTenantId(request);

  const burst = store.check(userId, LIMITS.burst.limit, LIMITS.burst.windowMs);
  if (!burst.ok) return rateLimitedResponse(burst.retryAfterSec);

  const userResult = store.check(userId, LIMITS.user.limit, LIMITS.user.windowMs);
  if (!userResult.ok) return rateLimitedResponse(userResult.retryAfterSec);

  const tenantResult = store.check(tenantId, LIMITS.tenant.limit, LIMITS.tenant.windowMs);
  if (!tenantResult.ok) return rateLimitedResponse(tenantResult.retryAfterSec);

  return null;
}

const publicPaths = [
  "/login",
  "/signup",
  "/verify-email",
  "/email-verified",
  "/forgot-password",
  "/reset-password",
  "/terms",
  "/privacy",
  "/invite",
  "/unsubscribe",
  "/api/auth",
  "/api/invite",
  "/api/unsubscribe",
  "/api/email",
  // PWA + browser-fetched assets. Without these the browser hits the
  // unauthenticated /login redirect, which can deadlock document loads
  // (manifest.json is fetched during <link rel="manifest"> processing).
  "/manifest.json",
  "/favicon.ico",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
  "/robots.txt",
  "/sitemap.xml",
  "/sw.js",
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // create base response with security headers
  const response = NextResponse.next();

  const securityHeaders = getSecurityHeaders({
    enableCSP: process.env.NODE_ENV === "production",
    enableHSTS: process.env.NODE_ENV === "production",
  });

  for (const [key, value] of Object.entries(securityHeaders)) {
    response.headers.set(key, value);
  }

  // web-proxy responses must be frameable -- the route handler sets its own
  // X-Frame-Options: SAMEORIGIN. remove the middleware's DENY so the iframe works.
  if (pathname.startsWith("/api/system/web-proxy")) {
    response.headers.delete("x-frame-options");
    response.headers.delete("content-security-policy");
    return response;
  }

  // login/signup page must be frameable when returning to web-proxy (OAuth iframe flow)
  if ((pathname === "/login" || pathname === "/signup") && request.nextUrl.searchParams.get("returnTo")?.includes("/api/system/web-proxy")) {
    response.headers.delete("x-frame-options");
    response.headers.set("x-frame-options", "SAMEORIGIN");
    response.headers.delete("content-security-policy");
    return response;
  }

  // landing page is public
  if (pathname === "/") {
    return response;
  }

  // rate limiting — apply to all API routes
  if (pathname.startsWith("/api")) {
    const limited = await applyRateLimit(request, response);
    if (limited) return limited;
  }

  // allow public paths (after rate limiting)
  if (publicPaths.some((path) => pathname.startsWith(path))) {
    return response;
  }

  // skip remaining auth for api routes (they handle their own auth via checkAuth)
  if (pathname.startsWith("/api")) {
    return response;
  }

  // for page routes: ensure CSRF cookie is set
  const hasCsrfCookie = request.cookies.get("csrf-token")?.value;
  let pageResponse = response;
  if (!hasCsrfCookie) {
    // set CSRF cookie for upcoming form submissions
    // we can't call setCsrfCookie() (server-only) in edge middleware,
    // so we set it via a response Set-Cookie header instead
    const token = generateEdgeCsrfToken();
    pageResponse = NextResponse.next({ request });
    for (const [key, value] of Object.entries(securityHeaders)) {
      pageResponse.headers.set(key, value);
    }
    pageResponse.cookies.set("csrf-token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 60 * 24, // 24 hours
    });
  }

  // auth requires DATABASE_URL (sqlite) to be configured
  if (!process.env.DATABASE_URL) {
    return pageResponse;
  }

  // check for better-auth session cookie
  // better-auth prefixes with __Secure- when served over HTTPS
  const sessionToken =
    request.cookies.get("__Secure-better-auth.session_token")?.value ||
    request.cookies.get("better-auth.session_token")?.value;

  if (!sessionToken) {
    const url = request.nextUrl.clone();
    const redirectPath = pathname;
    url.pathname = "/login";
    if (redirectPath !== "/") {
      url.searchParams.set("redirect", redirectPath);
    }
    return NextResponse.redirect(url);
  }

  return pageResponse;
}

/** generate a CSRF token in edge-compatible way (no Node.js crypto) */
function generateEdgeCsrfToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
