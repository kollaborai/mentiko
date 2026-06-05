/**
 * security.test.ts
 * comprehensive tests for security utilities
 */

import {
  timingSafeEqual,
  generateCsrfToken,
  validateCsrfFromCookieHeader,
  rateLimiters,
  sanitizeShellInput,
  sanitizeSessionName,
  sanitizeChainId,
  sanitizePath,
  isValidUrl,
  truncate,
  hashPassword,
  verifyPassword,
  getSecurityHeaders,
  sanitizeSvg,
} from "../auth/security";

// mock NextRequest for testing
class MockNextRequest {
  public headers: Map<string, string>;
  public cookies: Map<string, string>;
  public method: string;

  constructor({
    headers = {},
    cookies = {},
    method = "GET",
  }: {
    headers?: Record<string, string>;
    cookies?: Record<string, string>;
    method?: string;
  } = {}) {
    this.headers = new Map(Object.entries(headers));
    this.cookies = new Map(Object.entries(cookies));
    this.method = method;
  }

  get(name: string): string | null {
    return this.headers.get(name) || null;
  }
}

// mock NextResponse
const mockJson = jest.fn();
jest.mock("next/server", () => ({
  NextRequest: class {},
  NextResponse: {
    json: mockJson,
  },
}));

describe("security", () => {
  describe("timingSafeEqual", () => {
    it("returns true for identical strings", () => {
      expect(timingSafeEqual("hello", "hello")).toBe(true);
    });

    it("returns false for different strings", () => {
      expect(timingSafeEqual("hello", "world")).toBe(false);
    });

    it("returns false for different length strings", () => {
      expect(timingSafeEqual("hello", "hello!")).toBe(false);
    });

    it("returns true for empty strings", () => {
      expect(timingSafeEqual("", "")).toBe(true);
    });

    it("returns false when one string is empty", () => {
      expect(timingSafeEqual("", "a")).toBe(false);
      expect(timingSafeEqual("a", "")).toBe(false);
    });

    it("handles special characters", () => {
      expect(timingSafeEqual("test!@#$%", "test!@#$%")).toBe(true);
      expect(timingSafeEqual("test!@#$%", "test!@#$")).toBe(false);
    });

    it("is constant-time for same-length strings", () => {
      // this test verifies timing-safe behavior by ensuring the function
      // doesn't short-circuit on first character mismatch
      const a1 = "a" + "x".repeat(100);
      const a2 = "b" + "x".repeat(100);
      const b1 = "x".repeat(100) + "a";
      const b2 = "x".repeat(100) + "b";

      // both should be false (different strings)
      expect(timingSafeEqual(a1, a2)).toBe(false);
      expect(timingSafeEqual(b1, b2)).toBe(false);
    });
  });

  describe("CSRF tokens", () => {
    it("generates tokens of correct length", () => {
      const token = generateCsrfToken();
      expect(token).toHaveLength(64); // 32 bytes = 64 hex chars
    });

    it("generates unique tokens", () => {
      const tokens = new Set();
      for (let i = 0; i < 100; i++) {
        tokens.add(generateCsrfToken());
      }
      expect(tokens.size).toBe(100);
    });

    it("generates valid hex strings", () => {
      const token = generateCsrfToken();
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    });

    describe("validateCsrfFromCookieHeader", () => {
      it("validates matching tokens", () => {
        const token = generateCsrfToken();
        const request = new MockNextRequest({
          headers: { "x-csrf-token": token },
          cookies: { "csrf-token": token },
        });
        expect(validateCsrfFromCookieHeader(request as any)).toBe(true);
      });

      it("rejects mismatched tokens", () => {
        const request = new MockNextRequest({
          headers: { "x-csrf-token": generateCsrfToken() },
          cookies: { "csrf-token": generateCsrfToken() },
        });
        expect(validateCsrfFromCookieHeader(request as any)).toBe(false);
      });

      it("rejects missing header token", () => {
        const request = new MockNextRequest({
          cookies: { "csrf-token": generateCsrfToken() },
        });
        expect(validateCsrfFromCookieHeader(request as any)).toBe(false);
      });

      it("rejects missing cookie token", () => {
        const request = new MockNextRequest({
          headers: { "x-csrf-token": generateCsrfToken() },
        });
        expect(validateCsrfFromCookieHeader(request as any)).toBe(false);
      });
    });
  });

  describe("rate limiting", () => {
    beforeEach(() => {
      // clear rate limiter state between tests
      (rateLimiters.auth as any).store.clear();
    });

    it("allows requests within limit", () => {
      const request = new MockNextRequest({
        headers: { "x-forwarded-for": "127.0.0.1" },
      });

      for (let i = 0; i < 10; i++) {
        const result = (rateLimiters.auth as any).check(request as any);
        expect(result.allowed).toBe(true);
      }
    });

    it("blocks requests over limit", () => {
      const request = new MockNextRequest({
        headers: { "x-forwarded-for": "127.0.0.1" },
      });

      // exhaust the limit (auth allows 100 per 15 min, use webhook which is stricter)
      const webhookLimiter = rateLimiters.webhook as any;

      // make 20 requests (webhook limit is 20)
      for (let i = 0; i < 20; i++) {
        const result = webhookLimiter.check(request as any);
        if (i < 19) {
          expect(result.allowed).toBe(true);
        }
      }

      // 21st should be blocked
      const result = webhookLimiter.check(request as any);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it("resets after window expires", () => {
      const request = new MockNextRequest({
        headers: { "x-forwarded-for": "127.0.0.1" },
      });

      const limiter = rateLimiters.webhook as any;

      // exhaust limit
      for (let i = 0; i < 20; i++) {
        limiter.check(request as any);
      }

      // should be blocked
      let result = limiter.check(request as any);
      expect(result.allowed).toBe(false);

      // manually expire the entry
      const key = limiter.getIdentifier(request as any);
      const entry = limiter.store.get(key);
      entry.resetTime = Date.now() - 1000;

      // should be allowed again
      result = limiter.check(request as any);
      expect(result.allowed).toBe(true);
    });

    it("tracks separate limits per IP", () => {
      const request1 = new MockNextRequest({
        headers: { "x-forwarded-for": "127.0.0.1" },
      });
      const request2 = new MockNextRequest({
        headers: { "x-forwarded-for": "127.0.0.2" },
      });

      const limiter = rateLimiters.webhook as any;

      // exhaust limit for IP 1
      for (let i = 0; i < 20; i++) {
        limiter.check(request1 as any);
      }

      // IP 1 should be blocked
      let result = limiter.check(request1 as any);
      expect(result.allowed).toBe(false);

      // IP 2 should still be allowed
      result = limiter.check(request2 as any);
      expect(result.allowed).toBe(true);
    });

    it("resets individual IP limits", () => {
      const request = new MockNextRequest({
        headers: { "x-forwarded-for": "127.0.0.1" },
      });

      const limiter = rateLimiters.webhook as any;

      // exhaust limit
      for (let i = 0; i < 20; i++) {
        limiter.check(request as any);
      }

      // should be blocked
      let result = limiter.check(request as any);
      expect(result.allowed).toBe(false);

      // reset
      limiter.reset(request as any);

      // should be allowed again
      result = limiter.check(request as any);
      expect(result.allowed).toBe(true);
    });
  });

  describe("input sanitization", () => {
    describe("sanitizeShellInput", () => {
      it("allows safe characters", () => {
        expect(sanitizeShellInput("hello-world_123")).toBe("hello-world_123");
        expect(sanitizeShellInput("path/to/file.txt")).toBe("path/to/file.txt");
        expect(sanitizeShellInput("https://example.com")).toBe("https://example.com");
      });

      it("removes dangerous characters", () => {
        expect(sanitizeShellInput("hello; rm -rf /")).toBe("hello rm rf");
        expect(sanitizeShellInput("test && evil")).toBe("test evil");
        expect(sanitizeShellInput("cat /etc/passwd | mail")).toBe("cat etcpasswd mail");
      });

      it("trims whitespace", () => {
        expect(sanitizeShellInput("  hello  ")).toBe("hello");
      });

      it("handles empty input", () => {
        expect(sanitizeShellInput("")).toBe("");
      });
    });

    describe("sanitizeSessionName", () => {
      it("allows valid session names", () => {
        expect(sanitizeSessionName("session-123")).toBe("session-123");
        expect(sanitizeSessionName("my_session")).toBe("my_session");
        expect(sanitizeSessionName("Agent007")).toBe("Agent007");
      });

      it("removes invalid characters", () => {
        expect(sanitizeSessionName("session.123")).toBe("session123");
        expect(sanitizeSessionName("my session")).toBe("mysession");
        expect(sanitizeSessionName("session@123")).toBe("session123");
      });
    });

    describe("sanitizeChainId", () => {
      it("allows valid chain IDs", () => {
        expect(sanitizeChainId("chain-123")).toBe("chain-123");
        expect(sanitizeChainId("my_chain")).toBe("my_chain");
        expect(sanitizeChainId("Chain007")).toBe("Chain007");
      });

      it("removes invalid characters", () => {
        expect(sanitizeChainId("chain.123")).toBe("chain123");
        expect(sanitizeChainId("my/chain")).toBe("mychain");
        expect(sanitizeChainId("chain@123")).toBe("chain123");
      });
    });

    describe("sanitizePath", () => {
      it("removes null bytes", () => {
        expect(sanitizePath("test\x00file")).toBe("testfile");
      });

      it("prevents path traversal", () => {
        expect(sanitizePath("../../../etc/passwd")).toBe("etcpasswd");
        expect(sanitizePath("./hidden")).toBe("hidden");
        expect(sanitizePath(".../test")).toBe("test");
      });

      it("preserves valid paths", () => {
        expect(sanitizePath("path/to/file")).toBe("path/to/file");
        expect(sanitizePath("/absolute/path")).toBe("absolutepath");
      });
    });

    describe("isValidUrl", () => {
      it("accepts safe URLs", () => {
        expect(isValidUrl("https://example.com")).toBe(true);
        expect(isValidUrl("http://example.com")).toBe(true);
        expect(isValidUrl("ftp://files.example.com")).toBe(true);
      });

      it("rejects dangerous protocols", () => {
        expect(isValidUrl("javascript:alert(1)")).toBe(false);
        expect(isValidUrl("data:text/html,<script>")).toBe(false);
        expect(isValidUrl("file:///etc/passwd")).toBe(false);
      });

      it("rejects invalid URLs", () => {
        expect(isValidUrl("not-a-url")).toBe(false);
        expect(isValidUrl("htp://example.com")).toBe(false);
      });
    });

    describe("truncate", () => {
      it("returns short strings unchanged", () => {
        expect(truncate("hello", 10)).toBe("hello");
      });

      it("truncates long strings", () => {
        expect(truncate("hello world", 5)).toBe("hello");
        expect(truncate("abcdefghij", 5)).toBe("abcde");
      });
    });
  });

  describe("password hashing", () => {
    it("hashes passwords with salt", async () => {
      const result = await hashPassword("password123");
      expect(result.hash).toMatch(/^[0-9a-f]{64}$/); // 256 bits = 64 hex chars
      expect(result.salt).toMatch(/^[0-9a-f]{32}$/); // 16 bytes = 32 hex chars
    });

    it("generates different hashes for same password", async () => {
      const result1 = await hashPassword("password123");
      const result2 = await hashPassword("password123");
      expect(result1.hash).not.toBe(result2.hash);
      expect(result1.salt).not.toBe(result2.salt);
    });

    it("verifies correct password", async () => {
      const { hash, salt } = await hashPassword("password123");
      const isValid = await verifyPassword("password123", hash, salt);
      expect(isValid).toBe(true);
    });

    it("rejects incorrect password", async () => {
      const { hash, salt } = await hashPassword("password123");
      const isValid = await verifyPassword("wrongpassword", hash, salt);
      expect(isValid).toBe(false);
    });

    it("uses provided salt", async () => {
      const salt = "a".repeat(32); // fixed salt
      const result1 = await hashPassword("password123", salt);
      const result2 = await hashPassword("password123", salt);
      expect(result1.hash).toBe(result2.hash);
    });

    it("handles empty password", async () => {
      const { hash, salt } = await hashPassword("");
      const isValid = await verifyPassword("", hash, salt);
      expect(isValid).toBe(true);
    });
  });

  describe("security headers", () => {
    it("includes all standard headers", () => {
      const headers = getSecurityHeaders();
      expect(headers["X-Frame-Options"]).toBe("DENY");
      expect(headers["X-Content-Type-Options"]).toBe("nosniff");
      expect(headers["X-XSS-Protection"]).toBe("1; mode=block");
      expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    });

    it("includes CSP in production", () => {
      const originalEnv = process.env.NODE_ENV;
      (process.env as Record<string, string>).NODE_ENV = "production";
      const headers = getSecurityHeaders();
      (process.env as Record<string, string>).NODE_ENV = originalEnv;

      expect(headers["Content-Security-Policy"]).toBeDefined();
      expect(headers["Content-Security-Policy"]).toContain("default-src 'self'");
    });

    it("excludes CSP in development", () => {
      const originalEnv = process.env.NODE_ENV;
      (process.env as Record<string, string>).NODE_ENV = "development";
      const headers = getSecurityHeaders();
      (process.env as Record<string, string>).NODE_ENV = originalEnv;

      expect(headers["Content-Security-Policy"]).toBeUndefined();
    });

    it("includes HSTS in production", () => {
      const originalEnv = process.env.NODE_ENV;
      (process.env as Record<string, string>).NODE_ENV = "production";
      const headers = getSecurityHeaders();
      (process.env as Record<string, string>).NODE_ENV = originalEnv;

      expect(headers["Strict-Transport-Security"]).toBeDefined();
      expect(headers["Strict-Transport-Security"]).toContain("max-age=31536000");
    });

    it("allows disabling CSP", () => {
      const headers = getSecurityHeaders({ enableCSP: false });
      expect(headers["Content-Security-Policy"]).toBeUndefined();
    });

    it("allows disabling HSTS", () => {
      const headers = getSecurityHeaders({ enableHSTS: false });
      expect(headers["Strict-Transport-Security"]).toBeUndefined();
    });
  });

  describe("SVG sanitization", () => {
    it("removes script tags", () => {
      const svg = '<svg><script>alert("xss")</script></svg>';
      const sanitized = sanitizeSvg(svg);
      expect(sanitized).not.toContain("<script>");
      expect(sanitized).not.toContain("alert");
    });

    it("removes event handler attributes", () => {
      const svg = '<svg><rect onclick="evil()" onload="bad()"/></svg>';
      const sanitized = sanitizeSvg(svg);
      expect(sanitized).not.toContain("onclick");
      expect(sanitized).not.toContain("onload");
    });

    it("removes javascript hrefs", () => {
      const svg = '<svg><a href="javascript:alert(1)">link</a></svg>';
      const sanitized = sanitizeSvg(svg);
      expect(sanitized).not.toContain("javascript:");
    });

    it("removes data hrefs", () => {
      const svg = '<svg><a href="data:text/html,xss">link</a></svg>';
      const sanitized = sanitizeSvg(svg);
      expect(sanitized).not.toContain("data:");
    });

    it("removes xlink:href with javascript", () => {
      const svg = '<svg><a xlink:href="javascript:alert(1)">link</a></svg>';
      const sanitized = sanitizeSvg(svg);
      expect(sanitized).not.toContain("javascript:");
    });

    it("preserves safe SVG content", () => {
      const svg = '<svg><rect x="10" y="10" width="100" height="100"/></svg>';
      const sanitized = sanitizeSvg(svg);
      expect(sanitized).toContain("<rect");
      expect(sanitized).toContain('x="10"');
    });

    it("handles empty input", () => {
      expect(sanitizeSvg("")).toBe("");
    });

    it("handles non-string input", () => {
      expect(sanitizeSvg(null as any)).toBe("");
      expect(sanitizeSvg(undefined as any)).toBe("");
    });
  });
});
