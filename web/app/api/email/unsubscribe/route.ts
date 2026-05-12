/**
 * POST /api/email/unsubscribe
 * public endpoint (no auth) - validates token and suppresses email
 * rate limited: 10 requests per minute per IP
 */

import { NextRequest, NextResponse } from "next/server";
import {
  validateUnsubscribeToken,
} from "@/lib/unsubscribe-token";
import { suppressForUnsubscribe } from "@/lib/email-suppression";
import { appendAuditLog } from "@/lib/email-storage";
import { BadRequest, RateLimitExceeded } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// in-memory rate limiter (10 req/min per IP)
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 10;

function checkRateLimit(ip: string): { allowed: boolean; resetAt?: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW) {
    // new window
    rateLimitMap.set(ip, { count: 1, windowStart: now });
    return { allowed: true };
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return { allowed: false, resetAt: entry.windowStart + RATE_LIMIT_WINDOW };
  }

  entry.count++;
  return { allowed: true };
}

function getClientIp(request: NextRequest): string {
  // NOTE: using leftmost IP from x-forwarded-for. this can be spoofed by clients
  // behind their own proxy. for production, use rightmost IP from trusted reverse
  // proxy or integrate with cloudflare's cf-connecting-ip header when available.
  // current implementation provides basic rate limiting but not strong security.
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export const POST = withErrorHandling(async (request: NextRequest) => {
  const ip = getClientIp(request);

  // rate limit check
  const rateLimit = checkRateLimit(ip);
  if (!rateLimit.allowed) {
    throw new RateLimitExceeded(
      "Too many requests. Please try again later.",
      { resetAt: new Date(rateLimit.resetAt!).toISOString() }
    );
  }

  // parse body
  const body = await request.json();

  if (!body.token || typeof body.token !== "string") {
    throw new BadRequest("Token is required", { field: "token" });
  }

  // validate token
  const result = validateUnsubscribeToken(body.token);
  if (!result.valid) {
    const errorMap = {
      invalid: "Invalid unsubscribe link",
      bad_signature: "Invalid unsubscribe link",
      expired: "Unsubscribe link has expired",
    };
    throw new BadRequest(errorMap[result.reason]);
  }

  const { email, namespaceId, orgId, outboundId } = result;

  // add suppression
  try {
    suppressForUnsubscribe(namespaceId, orgId, email);
  } catch (err) {
    // suppression failed but log it
    console.error(`[unsubscribe] failed to suppress ${email}:`, err);
  }

  // audit log
  try {
    await appendAuditLog(namespaceId, orgId, {
      timestamp: new Date().toISOString(),
      event: "email_unsubscribed",
      namespaceId,
      details: {
        email,
        outboundId,
        ip,
      },
    });
  } catch {
    // audit log failure is non-critical
  }

  return apiSuccess({
    ok: true,
    email,
    message: "You have been unsubscribed",
  });
});

// options for cors preflight
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
