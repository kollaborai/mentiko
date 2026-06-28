/**
 * mcp-signal-token: scoped, short-lived tokens that authorize an external MCP
 * bridge to push UI effects to ONE specific browser session (the window the user
 * approved from). This is deliberately SEPARATE from the ops session token:
 *
 *   - different audience ("mentiko-mcp-signal" vs "mentiko-mcp-ops")
 *   - different derived signing key (resolveAppSecret("mcp-signal-token"))
 *   - carries the bound target sessionId; the /dispatch route routes by THAT,
 *     not by attacker-supplied body.sessionId.
 *
 * So a leaked signaling token can drive that one window's UI for its short TTL
 * and nothing else — it cannot read or mutate data (ops routes reject it), and
 * it cannot target other sessions. This is the "guest pass", not the house key
 * (the static MENTIKO_INBOX_KEY).
 */

import { SignJWT, jwtVerify } from "jose";
import { resolveAppSecret } from "../secrets/dev-secret";

const ISSUER = "mentiko-web";
const AUDIENCE = "mentiko-mcp-signal";
// UI-control grants are long-running working sessions; keep generous but bounded.
const TTL_SECONDS = 12 * 60 * 60; // 12h

function getSecret(): Uint8Array {
  return new TextEncoder().encode(resolveAppSecret("mcp-signal-token"));
}

export interface SignalTokenClaims {
  sub: string; // userId who approved
  sid: string; // bound target browser sessionId (effects route here only)
}

export async function mintSignalToken(claims: SignalTokenClaims): Promise<string> {
  return new SignJWT({ sid: claims.sid })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(getSecret());
}

export async function verifySignalToken(token: string): Promise<SignalTokenClaims> {
  const { payload } = await jwtVerify(token, getSecret(), {
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  return { sub: payload.sub as string, sid: payload["sid"] as string };
}
