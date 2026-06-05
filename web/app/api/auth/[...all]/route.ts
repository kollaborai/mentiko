import { getAuth } from "@/lib/auth/auth-server";
import { NextRequest, NextResponse } from "next/server";
import { rateLimiters } from "@/lib/auth/security";

export const dynamic = "force-dynamic";

const notConfigured = () =>
  NextResponse.json(
    { error: "Auth not configured. Set DATABASE_URL to enable." },
    { status: 503 }
  );

/**
 * wrap better-auth handler with error recovery.
 * better-call's router returns `new Response(null, { status: 500 })`
 * for unhandled non-APIError exceptions, giving zero visibility.
 * this wrapper catches those and returns a proper JSON error.
 */
async function handleAuth(
  request: NextRequest,
  method: "GET" | "POST",
): Promise<Response> {
  const auth = await getAuth();
  if (!auth) return notConfigured();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { toNextJsHandler } = require("better-auth/next-js");
  const handler = toNextJsHandler(auth);

  try {
    const response = await handler[method](request);

    // better-call returns empty 500 for unhandled errors.
    // intercept and add a generic message so the client gets JSON.
    if (response.status === 500) {
      const body = await response.clone().text();
      if (!body) {
        const url = new URL(request.url);
        console.error(
          `[auth] empty 500 from better-auth: ${method} ${url.pathname}`,
        );
        return NextResponse.json(
          { error: "Internal auth error. Check server logs." },
          { status: 500 },
        );
      }
    }

    return response;
  } catch (err) {
    const url = new URL(request.url);
    console.error(
      `[auth] unhandled error: ${method} ${url.pathname}`,
      err,
    );
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Unknown auth error",
      },
      { status: 500 },
    );
  }
}

// rate limiting applies to POST only (sign-in, sign-up, reset-password, etc.)
// GET requests are safe (session check, etc.)
function checkAuthRateLimit(request: NextRequest): NextResponse | null {
  const result = rateLimiters.auth.check(request);
  if (!result.allowed) {
    const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000);
    return NextResponse.json(
      { error: "Too many requests. Please wait before trying again." },
      {
        status: 429,
        headers: {
          "Retry-After": retryAfter.toString(),
          "X-RateLimit-Reset": new Date(result.resetTime).toISOString(),
        },
      }
    );
  }
  return null;
}

export async function GET(request: NextRequest) {
  return handleAuth(request, "GET");
}

export async function POST(request: NextRequest) {
  const limited = checkAuthRateLimit(request);
  if (limited) return limited;
  return handleAuth(request, "POST");
}
