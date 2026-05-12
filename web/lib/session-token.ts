import { SignJWT, jwtVerify } from "jose";
import { isOrgRole, type OrgRole } from "./org-types";

const ISSUER  = "mentiko-web";
const AUDIENCE = "mentiko-mcp-ops";
const TTL_SECONDS = 86400; // 24h — matches practical engine session lifetime; revocation via token blocklist is follow-up work

function getSecret(): Uint8Array {
  const s = process.env.BETTER_AUTH_SECRET;
  if (!s) throw new Error("BETTER_AUTH_SECRET is not set — cannot mint session token");
  return new TextEncoder().encode(s);
}

export interface SessionTokenClaims {
  sub: string;   // userId
  jti: string;   // engineSessionId
  ns:  string;   // namespaceId
  org: string;   // orgId
  role?: OrgRole;
  scopes?: string[];
}

export async function mintSessionToken(claims: SessionTokenClaims): Promise<string> {
  const payload: Record<string, unknown> = { ns: claims.ns, org: claims.org };
  if (claims.role) payload.role = claims.role;
  if (claims.scopes?.length) payload.scopes = claims.scopes;

  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(claims.sub)
    .setJti(claims.jti)
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(getSecret());
}

export async function verifySessionToken(token: string): Promise<SessionTokenClaims> {
  const { payload } = await jwtVerify(token, getSecret(), {
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  return {
    sub: payload.sub as string,
    jti: payload.jti as string,
    ns:  payload["ns"]  as string,
    org: payload["org"] as string,
    role: isOrgRole(payload["role"]) ? payload["role"] : undefined,
    scopes: parseScopes(payload["scopes"]),
  };
}

/**
 * Decode and verify a session token's signature and issuer/audience WITHOUT
 * enforcing expiry. Used ONLY by the internal engine refresh path, where the
 * stored token may already be expired but its claims are still needed to mint
 * a fresh one.
 *
 * Normal verifySessionToken() still enforces expiry everywhere else.
 */
export async function decodeSessionTokenClaims(token: string): Promise<SessionTokenClaims> {
  const { payload } = await jwtVerify(token, getSecret(), {
    issuer: ISSUER,
    audience: AUDIENCE,
    clockTolerance: Infinity,
  });
  return {
    sub: payload.sub as string,
    jti: payload.jti as string,
    ns:  payload["ns"]  as string,
    org: payload["org"] as string,
    role: isOrgRole(payload["role"]) ? payload["role"] : undefined,
    scopes: parseScopes(payload["scopes"]),
  };
}

function parseScopes(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((scope): scope is string => typeof scope === "string");
  }
  if (typeof value === "string") {
    return value.split(/\s+/).filter(Boolean);
  }
  return [];
}
