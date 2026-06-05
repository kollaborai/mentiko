import { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";
import type { BouncePayload } from "@/lib/email/email-types";
import {
  processBounce,
  emitBounceEvent,
  deriveBounceSecret,
} from "@/lib/email/email-bounce";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { Unauthorized, BadRequest, ValidationError } from "@/lib/api-errors";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// HMAC auth (bearer token with bounce scope)
// ---------------------------------------------------------------------------

function extractNamespaceFromToken(token: string): string | null {
  // format: bounce:v{version}:{namespaceId}:{signature}
  const parts = token.split(":");
  if (parts.length < 4 || parts[0] !== "bounce") return null;

  const version = parts[1].replace("v", "");
  const namespaceId = parts[2];
  const signature = parts.slice(3).join(":");

  // derive expected signature
  const expected = deriveBounceSecret(namespaceId, parseInt(version, 10));

  // timing-safe compare (length check first)
  if (signature.length !== expected.length) return null;

  const bufSig = Buffer.from(signature);
  const bufExp = Buffer.from(expected);

  try {
    if (!timingSafeEqual(bufSig, bufExp)) return null;
  } catch {
    return null;
  }

  return namespaceId;
}

function authenticate(request: NextRequest): string | null {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;

  const token = auth.slice(7);
  return extractNamespaceFromToken(token);
}

// ---------------------------------------------------------------------------
// POST handler - process bounce webhook from haraka
// ---------------------------------------------------------------------------

export const POST = withErrorHandling(async (request: NextRequest) => {
  // 1. auth
  const namespaceId = authenticate(request);
  if (!namespaceId) {
    throw new Unauthorized("Invalid or missing bounce token");
  }

  // 2. parse body
  const payload = await request.json() as BouncePayload;

  // 3. validate required fields
  if (!payload.outboundId || !payload.recipient) {
    throw new BadRequest("Missing required fields: outboundId, recipient", {
      fields: ["outboundId", "recipient"],
    });
  }

  // 4. validate bounceType
  const validBounceTypes = ["hard", "soft", "auto_reply", "vacation"];
  if (!payload.bounceType || !validBounceTypes.includes(payload.bounceType)) {
    throw new ValidationError(`bounceType must be one of: ${validBounceTypes.join(", ")}`, {
      field: "bounceType",
      allowed: validBounceTypes,
    });
  }

  // 5. validate action
  const validActions = ["failed", "delayed", "relayed", "delivered"];
  if (!payload.action || !validActions.includes(payload.action)) {
    throw new ValidationError(`action must be one of: ${validActions.join(", ")}`, {
      field: "action",
      allowed: validActions,
    });
  }

  // 6. process bounce
  const result = await processBounce(namespaceId, payload);

  // 7. emit event (best-effort, don't fail if event bus unavailable)
  await emitBounceEvent(namespaceId, payload, result).catch(() => {});

  // 8. return result
  const statusCode = result.unmatched ? 404 : result.duplicate ? 200 : 201;
  return apiSuccess(
    {
      ok: result.processed,
      result: {
        duplicate: result.duplicate,
        unmatched: result.unmatched,
        autoReplyDiscarded: result.autoReplyDiscarded,
        suppressionWritten: result.suppressionWritten,
        recordId: result.recordId,
      },
    },
    undefined,
    statusCode
  );
});

// ---------------------------------------------------------------------------
// GET handler - list unmatched bounces (debugging)
// ---------------------------------------------------------------------------

export const GET = withErrorHandling(async (request: NextRequest) => {
  const namespaceId = authenticate(request);
  if (!namespaceId) {
    throw new Unauthorized("Invalid or missing bounce token");
  }

  // parse query params
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");

  const { listUnmatchedBounces, listSuppressions } = await import("@/lib/email/email-bounce");

  if (type === "unmatched") {
    const limit = parseInt(searchParams.get("limit") || "100", 10);
    const bounces = await listUnmatchedBounces(namespaceId, limit);
    return apiSuccess({ bounces, count: bounces.length });
  }

  if (type === "suppressions") {
    const suppressions = await listSuppressions(namespaceId);
    return apiSuccess({ suppressions, count: suppressions.length });
  }

  throw new ValidationError('Query param "type" must be "unmatched" or "suppressions"', {
    field: "type",
    allowed: ["unmatched", "suppressions"],
  });
});
