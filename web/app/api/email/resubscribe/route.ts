/**
 * POST /api/email/resubscribe
 * public endpoint (no auth) - validates token and removes suppression
 * only works if reason is NOT hard_bounce
 * rate limited: 10 requests per minute per IP
 */

import { NextRequest, NextResponse } from "next/server";
import {
  validateUnsubscribeToken,
} from "@/lib/auth/unsubscribe-token";
import { unsuppress } from "@/lib/email/email-suppression";
import { appendAuditLog } from "@/lib/email/email-storage";
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
      invalid: "Invalid resubscribe link",
      bad_signature: "Invalid resubscribe link",
      expired: "Resubscribe link has expired",
    };
    throw new BadRequest(errorMap[result.reason]);
  }

  const { email, namespaceId, orgId } = result;

  // remove suppression (only for non-hard-bounce reasons)
  // unsuppress returns true only if a matching suppression was removed
  const removed = unsuppress(namespaceId, orgId, email, [
    "soft_bounce",
    "unsubscribe",
    "manual",
  ]);

  // audit log
  try {
    await appendAuditLog(namespaceId, orgId, {
      timestamp: new Date().toISOString(),
      event: removed ? "email_resubscribed" : "email_resubscribe_failed",
      namespaceId,
      details: {
        email,
        ip,
        reason: removed ? undefined : "not_suppressed",
      },
    });
  } catch {
    // audit log failure is non-critical
  }

  if (!removed) {
    throw new BadRequest("Email is not currently suppressed.");
  }

  return apiSuccess({
    ok: true,
    email,
    message: "You have been resubscribed",
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
