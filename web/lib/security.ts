// security utilities: csrf, rate limiting, sanitization, timing-safe comparisons

import { NextRequest, NextResponse } from "next/server";

// ============================================================================
// timing-safe string comparison (prevent timing attacks)
// ============================================================================

import { timingSafeEqual as cryptoTimingSafeEqual } from "crypto";

export function timingSafeEqual(a: string, b: string): boolean {
  // native crypto.timingSafeEqual works on Buffers
  const aBuffer = Buffer.from(a, "utf-8");
  const bBuffer = Buffer.from(b, "utf-8");

  // length check is built into crypto.timingSafeEqual, but we need to handle it
  // for consistent error behavior
  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  try {
    return cryptoTimingSafeEqual(aBuffer, bBuffer);
  } catch {
    // crypto.timingSafeEqual throws if lengths differ (defensive fallback)
    return false;
  }
}

// ============================================================================
// csrf protection
// ============================================================================

const CSRF_COOKIE_NAME = "csrf-token";
const CSRF_HEADER_NAME = "x-csrf-token";
const CSRF_TOKEN_LENGTH = 32;

// generate cryptographically random token
export function generateCsrfToken(): string {
  const array = new Uint8Array(CSRF_TOKEN_LENGTH);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

// set csrf cookie — server-only, import from security-server.ts
// get csrf token — server-only, import from security-server.ts
// validate csrf — server-only, import from security-server.ts

// validate csrf token from header against cookie value (request-scoped, no next/headers)
export function validateCsrfFromCookieHeader(request: NextRequest): boolean {
  const headerToken = request.headers.get(CSRF_HEADER_NAME);
  const cookieToken = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  if (!headerToken || !cookieToken) return false;
  return timingSafeEqual(headerToken, cookieToken);
}

// csrf middleware for state-changing routes
export function withCsrfProtection(
  handler: (request: NextRequest) => Promise<NextResponse>
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    // skip for get/head/options (safe methods)
    if (
      request.method === "GET" ||
      request.method === "HEAD" ||
      request.method === "OPTIONS"
    ) {
      return handler(request);
    }

    // validate csrf for state-changing methods
    const isValid = validateCsrfFromCookieHeader(request);
    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid CSRF token" },
        { status: 403 }
      );
    }

    return handler(request);
  };
}

// ============================================================================
// rate limiting
// ============================================================================

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

class RateLimiter {
  private store: Map<string, RateLimitEntry> = new Map();
  private windowMs: number;
  private maxRequests: number;

  constructor(windowMs: number, maxRequests: number) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;

    // cleanup expired entries every minute without pinning short-lived node processes
    const cleanupTimer = setInterval(() => this.cleanup(), 60000);
    cleanupTimer.unref?.();
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.resetTime < now) {
        this.store.delete(key);
      }
    }
  }

  private getIdentifier(request: NextRequest): string {
    // use ip address, fall back to user agent
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";
    return ip;
  }

  check(request: NextRequest): { allowed: boolean; remaining: number; resetTime: number } {
    const key = this.getIdentifier(request);
    const now = Date.now();

    let entry = this.store.get(key);

    // reset if window expired
    if (!entry || entry.resetTime < now) {
      entry = { count: 0, resetTime: now + this.windowMs };
      this.store.set(key, entry);
    }

    entry.count++;

    return {
      allowed: entry.count <= this.maxRequests,
      remaining: Math.max(0, this.maxRequests - entry.count),
      resetTime: entry.resetTime,
    };
  }

  reset(request: NextRequest): void {
    const key = this.getIdentifier(request);
    this.store.delete(key);
  }
}

// pre-configured limiters
export const rateLimiters = {
  // auth endpoints (100 req per 15 min) - increased for polling/realtime features
  auth: new RateLimiter(15 * 60 * 1000, 100),

  // api: general api routes (600 req per minute)
  api: new RateLimiter(60 * 1000, 600),

  // strict: webhooks (20 req per minute)
  webhook: new RateLimiter(60 * 1000, 20),

  // loose: public endpoints (1000 req per minute)
  public: new RateLimiter(60 * 1000, 1000),
};

function shouldBypassRateLimit(): boolean {
  return false;
}

// rate limiting middleware factory
export function withRateLimit(limiter: RateLimiter) {
  return function (
    handler: (request: NextRequest) => Promise<NextResponse>
  ) {
    return async (request: NextRequest): Promise<NextResponse> => {
      if (shouldBypassRateLimit()) {
        return handler(request);
      }

      const result = limiter.check(request);

      if (!result.allowed) {
        const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000);
        return NextResponse.json(
          { error: "Too many requests. Please try again later." },
          {
            status: 429,
            headers: {
              "Retry-After": retryAfter.toString(),
              "X-RateLimit-Limit": limiter["maxRequests"].toString(),
              "X-RateLimit-Remaining": "0",
              "X-RateLimit-Reset": new Date(result.resetTime).toISOString(),
            },
          }
        );
      }

      const response = await handler(request);

      // add rate limit headers to successful responses
      response.headers.set("X-RateLimit-Limit", limiter["maxRequests"].toString());
      response.headers.set("X-RateLimit-Remaining", result.remaining.toString());
      response.headers.set("X-RateLimit-Reset", new Date(result.resetTime).toISOString());

      return response;
    };
  };
}

// ============================================================================
// input sanitization
// ============================================================================

// sanitize string input for shell commands (prevent command injection)
export function sanitizeShellInput(input: string): string {
  // allow only alphanumeric, spaces, hyphens, underscores, slashes, dots, and colons
  // this is restrictive by design - extend carefully for specific use cases
  const sanitized = input.replace(/[^a-zA-Z0-9\s\-_/.:]/g, "");
  return sanitized.trim();
}

// sanitize session name (used in pty-manager session commands)
export function sanitizeSessionName(input: string): string {
  // session names: alphanumeric, hyphens, underscores only
  const sanitized = input.replace(/[^a-zA-Z0-9\-_]/g, "");
  return sanitized.trim();
}

// sanitize chain id
export function sanitizeChainId(input: string): string {
  // chain ids: alphanumeric, hyphens, underscores
  const sanitized = input.replace(/[^a-zA-Z0-9\-_]/g, "");
  return sanitized;
}

// sanitize file path (prevent path traversal)
export function sanitizePath(input: string): string {
  // remove null bytes and resolve path traversal attempts
  const sanitized = input.replace(/\0/g, "");

  // prevent directory traversal
  const parts = sanitized.split("/");
  const cleanParts = parts
    .map((p) => p.replace(/^\.+/, "")) // remove leading dots
    .filter(Boolean); // remove empty parts

  return cleanParts.join("/");
}

// validate url is safe (no javascript: or data: protocols)
export function isValidUrl(input: string): boolean {
  try {
    const url = new URL(input);
    const safeProtocols = ["http:", "https:", "ftp:"];
    return safeProtocols.includes(url.protocol);
  } catch {
    return false;
  }
}

// truncate string to max length (prevent dos via large inputs)
export function truncate(input: string, maxLength: number): string {
  if (input.length <= maxLength) return input;
  return input.slice(0, maxLength);
}

// ============================================================================
// password hashing (future-proofing for when we move away from simple comparison)
// ============================================================================

// note: using web crypto api for pbkdf2
// current auth system uses plain text comparison (timing-safe now)
// this is here for future migration to hashed passwords

export async function hashPassword(
  password: string,
  salt?: string
): Promise<{ hash: string; salt: string }> {
  const actualSalt = salt || generateSalt();
  const encoder = new TextEncoder();

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );

  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: encoder.encode(actualSalt),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );

  const hash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return { hash, salt: actualSalt };
}

export async function verifyPassword(
  password: string,
  hash: string,
  salt: string
): Promise<boolean> {
  const { hash: computedHash } = await hashPassword(password, salt);
  return timingSafeEqual(hash, computedHash);
}

function generateSalt(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ============================================================================
// security headers helpers
// ============================================================================

export interface SecurityHeaderConfig {
  enableCSP: boolean;
  enableHSTS: boolean;
  reportUri?: string;
}

export function getSecurityHeaders(config: Partial<SecurityHeaderConfig> = {}): Record<
  string,
  string
> {
  const {
    enableCSP = process.env.NODE_ENV === "production",
    enableHSTS = process.env.NODE_ENV === "production",
    reportUri,
  } = config;

  const headers: Record<string, string> = {
    // prevent clickjacking
    "X-Frame-Options": "DENY",

    // prevent mime sniffing
    "X-Content-Type-Options": "nosniff",

    // enable cross-site filtering
    "X-XSS-Protection": "1; mode=block",

    // referrer policy
    "Referrer-Policy": "strict-origin-when-cross-origin",

    // permissions policy (formerly feature policy)
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), interest-cohort=()",

    // cross-origin isolation headers
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
  };

  // content security policy
  if (enableCSP) {
    const reportDirectives = reportUri
      ? `report-uri ${reportUri}; report-to csp-endpoint`
      : "";

    headers["Content-Security-Policy"] = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net blob:", // next.js dev + monaco editor CDN + workers
      "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net", // styled-jsx / tailwind + monaco styles
      "img-src 'self' data: https:",
      "font-src 'self' data: https://cdn.jsdelivr.net",
      "connect-src 'self' ws: wss:", // websockets
      "worker-src 'self' blob:", // monaco editor web workers
      "frame-ancestors 'none'",
      reportDirectives,
    ]
      .filter(Boolean)
      .join("; ");
  }

  // hsts (https only)
  if (enableHSTS) {
    headers["Strict-Transport-Security"] =
      "max-age=31536000; includeSubDomains; preload";
  }

  return headers;
}

// ============================================================================
// SVG sanitization (strip script tags and dangerous attributes)
// ============================================================================

/**
 * Strip dangerous content from SVG strings for safe use in dangerouslySetInnerHTML.
 * Removes: <script>, on* event handlers, javascript: hrefs, and data: hrefs.
 * This is a lightweight server-safe sanitizer (no DOM access).
 */
export function sanitizeSvg(svg: string): string {
  if (!svg || typeof svg !== "string") return "";
  return svg
    // remove script tags and content
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    // remove on* event handler attributes (onclick, onload, onerror, etc.)
    .replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, "")
    .replace(/\s+on\w+\s*=\s*[^\s>]*/gi, "")
    // remove javascript: and data: hrefs
    .replace(/href\s*=\s*["']?\s*(javascript|data):[^"'\s>]*/gi, "href=\"\"")
    // remove xlink:href with javascript/data content
    .replace(/xlink:href\s*=\s*["']?\s*(javascript|data):[^"'\s>]*/gi, "");
}
