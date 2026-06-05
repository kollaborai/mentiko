/**
 * unsubscribe token utilities
 * signed tokens for public unsubscribe links
 * format: base64url(payload).hmac where hmac = HMAC-SHA256(secret, payload)
 */

import { createHmac, timingSafeEqual } from "crypto";
import { Buffer } from "buffer";
import { resolveAppSecret } from "../secrets/dev-secret";

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface UnsubscribePayload {
  email: string;
  namespaceId: string;
  orgId: string;
  outboundId?: string;
  expiresAt: string; // UTC ISO
}

export interface ValidatedToken {
  email: string;
  namespaceId: string;
  orgId: string;
  outboundId?: string;
  valid: true;
}

export interface InvalidToken {
  valid: false;
  reason: "invalid" | "expired" | "bad_signature";
}

export type TokenResult = ValidatedToken | InvalidToken;

// ---------------------------------------------------------------------------
// encoding/decoding
// ---------------------------------------------------------------------------

function getSecret(): string {
  return resolveAppSecret("unsubscribe-token");
}

function base64UrlEncode(data: string): string {
  return Buffer.from(data, "utf-8")
    .toString("base64url")
    .replace(/=/g, "");
}

function base64UrlDecode(data: string): string {
  // add padding back
  const padded = data + "=".repeat((4 - (data.length % 4)) % 4);
  return Buffer.from(padded, "base64url").toString("utf-8");
}

// ---------------------------------------------------------------------------
// token operations
// ---------------------------------------------------------------------------

/**
 * generate an unsubscribe token for an email.
 * includes outboundId if unsubscribing from a specific message.
 */
export function generateUnsubscribeToken(
  email: string,
  namespaceId: string,
  orgId: string,
  outboundId?: string
): string {
  const payload: UnsubscribePayload = {
    email: email.toLowerCase().trim(),
    namespaceId,
    orgId,
    outboundId,
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
  };

  const payloadJson = JSON.stringify(payload);
  const payloadEncoded = base64UrlEncode(payloadJson);

  const hmac = createHmac("sha256", getSecret())
    .update(payloadEncoded)
    .digest("base64url");

  return `${payloadEncoded}.${hmac}`;
}

/**
 * validate an unsubscribe token.
 * checks signature and expiry.
 */
export function validateUnsubscribeToken(token: string): TokenResult {
  try {
    const parts = token.split(".");
    if (parts.length !== 2) {
      return { valid: false, reason: "invalid" };
    }

    const [payloadEncoded, providedHmac] = parts;

    // verify signature
    const expectedHmac = createHmac("sha256", getSecret())
      .update(payloadEncoded)
      .digest("base64url");

    // constant-time compare to prevent timing attacks
    const providedBuf = Buffer.from(providedHmac, "utf-8");
    const expectedBuf = Buffer.from(expectedHmac, "utf-8");

    if (
      providedBuf.length !== expectedBuf.length ||
      !timingSafeEqual(providedBuf, expectedBuf)
    ) {
      return { valid: false, reason: "bad_signature" };
    }

    // decode payload
    const payloadJson = base64UrlDecode(payloadEncoded);
    const payload = JSON.parse(payloadJson) as UnsubscribePayload;

    // validate structure
    if (
      !payload.email ||
      !payload.namespaceId ||
      !payload.orgId ||
      !payload.expiresAt
    ) {
      return { valid: false, reason: "invalid" };
    }

    // check expiry
    if (new Date(payload.expiresAt) < new Date()) {
      return { valid: false, reason: "expired" };
    }

    return {
      valid: true,
      email: payload.email,
      namespaceId: payload.namespaceId,
      orgId: payload.orgId,
      outboundId: payload.outboundId,
    };
  } catch {
    return { valid: false, reason: "invalid" };
  }
}

/**
 * extract email from token for display purposes only.
 * does NOT validate - use validateUnsubscribeToken for validation.
 */
export function peekEmail(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const payloadJson = base64UrlDecode(parts[0]);
    const payload = JSON.parse(payloadJson) as UnsubscribePayload;
    return payload.email || null;
  } catch {
    return null;
  }
}
