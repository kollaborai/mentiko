import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Functional HS256 mirror of jose for Jest suites. jose v6 is ESM-only and
 * Jest (CJS) cannot load it, but a mock whose SignJWT has no signing methods
 * hides mint failures. This helper signs and verifies with real HMAC-SHA256,
 * so a token minted under one secret fails verification under another — the
 * property the CLI/web boundary depends on. End-to-end coverage with real
 * jose runs through the CLI bundle (see the live proof in PR #99).
 */

function b64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export class SignJWT {
  private header: Record<string, unknown> = { alg: "HS256", typ: "JWT" };
  constructor(private payload: Record<string, unknown>) {}

  setProtectedHeader(header: Record<string, unknown>): this {
    this.header = { ...this.header, ...header };
    return this;
  }
  setIssuer(value: string): this { this.payload.iss = value; return this; }
  setAudience(value: string): this { this.payload.aud = value; return this; }
  setSubject(value: string): this { this.payload.sub = value; return this; }
  setJti(value: string): this { this.payload.jti = value; return this; }
  setIssuedAt(): this { this.payload.iat = Math.floor(Date.now() / 1000); return this; }
  setExpirationTime(value: string): this {
    this.payload.exp = value.endsWith("s") ? Math.floor(Date.now() / 1000) + Number(value.slice(0, -1)) : value;
    return this;
  }
  async sign(secret: Uint8Array): Promise<string> {
    const head = b64urlJson(this.header);
    const body = b64urlJson(this.payload);
    const signature = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
    return `${head}.${body}.${signature}`;
  }
}

export async function jwtVerify(
  token: string,
  secret: Uint8Array,
  options?: { issuer?: string; audience?: string; clockTolerance?: number },
): Promise<{ payload: Record<string, unknown>; protectedHeader: Record<string, unknown> }> {
  const [head, body, signature] = token.split(".");
  if (!head || !body || !signature) throw new Error("malformed token");
  const expected = createHmac("sha256", secret).update(`${head}.${body}`).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("signature verification failed: secret mismatch or tampered token");
  }
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
  if (options?.issuer && payload.iss !== options.issuer) throw new Error(`unexpected issuer: ${String(payload.iss)}`);
  if (options?.audience && payload.aud !== options.audience) throw new Error(`unexpected audience: ${String(payload.aud)}`);
  if (typeof payload.exp === "number" && options?.clockTolerance !== Infinity && Date.now() / 1000 > payload.exp) {
    throw new Error("token expired");
  }
  return { payload, protectedHeader: JSON.parse(Buffer.from(head, "base64url").toString("utf8")) };
}
