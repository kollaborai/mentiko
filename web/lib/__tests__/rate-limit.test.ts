/**
 * tests for rate limiter in lib/security.ts
 */

// mock next/server to provide NextRequest/NextResponse in test env
jest.mock("next/server", () => {
  class MockNextResponse {
    status: number;
    _headers: Map<string, string>;
    _body: string;
    constructor(body: string, init?: { status?: number; headers?: Record<string, string> }) {
      this._body = body;
      this.status = init?.status || 200;
      this._headers = new Map(Object.entries(init?.headers || {}));
    }
    get headers() {
      return {
        get: (k: string) => this._headers.get(k) || null,
        set: (k: string, v: string) => this._headers.set(k, v),
      };
    }
    static json(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
      return new MockNextResponse(JSON.stringify(body), init);
    }
  }
  return {
    NextRequest: class { headers = new Map(); },
    NextResponse: MockNextResponse,
  };
});

// mock NextRequest as a plain object (jest env doesn't have web APIs)
function makeRequest(ip = "127.0.0.1") {
  return {
    headers: {
      get(name: string) {
        if (name === "x-forwarded-for") return ip;
        if (name === "x-real-ip") return ip;
        return null;
      },
    },
  } as Parameters<typeof import("../auth/security").rateLimiters.api.check>[0];
}

describe("rate limiting", () => {
  let rateLimiters: typeof import("../auth/security").rateLimiters;

  beforeEach(async () => {
    jest.resetModules();
    const security = await import("../auth/security");
    rateLimiters = security.rateLimiters;
  });

  describe("RateLimiter.check()", () => {
    it("allows requests within the limit", () => {
      const req = makeRequest();
      const result = rateLimiters.api.check(req);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThan(0);
    });

    it("tracks remaining count correctly", () => {
      const req = makeRequest("10.0.0.1");
      const r1 = rateLimiters.api.check(req);
      const r2 = rateLimiters.api.check(req);
      expect(r2.remaining).toBe(r1.remaining - 1);
    });

    it("blocks requests over the limit", () => {
      const req = makeRequest("10.0.0.2");
      // api limit is 600 per minute
      for (let i = 0; i < 600; i++) {
        rateLimiters.api.check(req);
      }
      const result = rateLimiters.api.check(req);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it("tracks different IPs independently", () => {
      const req1 = makeRequest("10.0.0.3");
      const req2 = makeRequest("10.0.0.4");

      for (let i = 0; i < 600; i++) {
        rateLimiters.api.check(req1);
      }

      const result = rateLimiters.api.check(req2);
      expect(result.allowed).toBe(true);
    });

    it("provides a reset time in the future", () => {
      const req = makeRequest("10.0.0.5");
      const result = rateLimiters.api.check(req);
      expect(result.resetTime).toBeGreaterThan(Date.now());
    });

    it("resets after calling reset()", () => {
      const req = makeRequest("10.0.0.6");

      for (let i = 0; i < 600; i++) {
        rateLimiters.api.check(req);
      }
      expect(rateLimiters.api.check(req).allowed).toBe(false);

      rateLimiters.api.reset(req);

      const result = rateLimiters.api.check(req);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(599); // 600 - 1
    });
  });

  describe("pre-configured limiters", () => {
    it("has auth limiter", () => {
      expect(rateLimiters.auth).toBeDefined();
      const req = makeRequest("10.1.0.1");
      expect(rateLimiters.auth.check(req).allowed).toBe(true);
    });

    it("has api limiter", () => {
      expect(rateLimiters.api).toBeDefined();
    });

    it("has webhook limiter with lower limit (20)", () => {
      expect(rateLimiters.webhook).toBeDefined();
      const req = makeRequest("10.1.0.2");
      for (let i = 0; i < 20; i++) {
        rateLimiters.webhook.check(req);
      }
      expect(rateLimiters.webhook.check(req).allowed).toBe(false);
    });

    it("has public limiter with higher limit", () => {
      expect(rateLimiters.public).toBeDefined();
      const req = makeRequest("10.1.0.3");
      // public allows 1000 - just verify first request passes
      expect(rateLimiters.public.check(req).allowed).toBe(true);
    });
  });

  describe("remaining count accuracy", () => {
    it("starts at limit - 1 after first request", () => {
      const req = makeRequest("10.4.0.1");
      const result = rateLimiters.api.check(req);
      // api limit is 600, first request uses 1 -> 599 remaining
      expect(result.remaining).toBe(599);
    });

    it("reaches 0 at the limit", () => {
      const req = makeRequest("10.4.0.2");
      let result;
      for (let i = 0; i < 600; i++) {
        result = rateLimiters.api.check(req);
      }
      expect(result!.remaining).toBe(0);
      expect(result!.allowed).toBe(true); // 600th request is still allowed
    });

    it("stays at 0 after exceeding limit", () => {
      const req = makeRequest("10.4.0.3");
      for (let i = 0; i < 605; i++) {
        rateLimiters.api.check(req);
      }
      const result = rateLimiters.api.check(req);
      expect(result.remaining).toBe(0);
      expect(result.allowed).toBe(false);
    });
  });
});
