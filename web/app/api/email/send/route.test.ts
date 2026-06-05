/**
 * email/send route integration tests.
 * tests validation, auth, quota, circuit breaker, and SMTP paths.
 */

// mock next/server BEFORE importing route
jest.mock("next/server", () => ({
  NextRequest: class MockNextRequest {
    public url: string;
    public method: string;
    public headers: Headers;
    private _body: string;
    public nextUrl: URL;

    constructor(url: string, init?: { method?: string; body?: string; headers?: HeadersInit }) {
      this.url = url;
      this.method = init?.method || "GET";
      this.headers = new Headers(init?.headers);
      this._body = init?.body || "";
      this.nextUrl = new URL(url);
    }

    async json() {
      return JSON.parse(this._body);
    }

    async text() {
      return this._body;
    }
  },
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      headers: new Headers(),
      json: async () => body,
    }),
  },
}));

jest.mock("@/lib/auth/rbac-auth", () => ({
  requirePermission: jest.fn(),
}));

jest.mock("@/lib/email/email-storage", () => ({
  enqueueOutbound: jest.fn(),
  updateOutboundEntry: jest.fn(),
  moveOutboundEntry: jest.fn(),
  getSendCount: jest.fn(),
  incrementSendCount: jest.fn(),
  appendAuditLog: jest.fn(),
  SEND_QUOTA_PER_DAY: 1000,
}));

jest.mock("@/lib/orgs/org-storage", () => ({
  loadOrg: jest.fn(() => Promise.resolve({ id: "default", name: "Default", settings: {} })),
}));

jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: jest.fn((req: Request) => req.headers.get("x-namespace-id") || "default"),
  getOrgIdFromRequest: jest.fn((req: Request) => req.headers.get("x-org-id") || "default"),
}));

import { POST } from "./route";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { enqueueOutbound, getSendCount } from "@/lib/email/email-storage";

describe("POST /api/email/send", () => {
  const originalEnv = process.env;
  type MockNextRequest = InstanceType<typeof import("next/server").NextRequest>;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    // default: authorized
    (requirePermission as jest.Mock).mockResolvedValue(null);
    // default: within quota
    (getSendCount as jest.Mock).mockResolvedValue(0);
    // default: SMTP not configured
    process.env.SMTP_USER = "";
    process.env.SMTP_PASS = "";
    process.env.EMAIL_SEND_QUOTA_PER_DAY = "1000";
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function mockRequest(body: Record<string, unknown>): MockNextRequest {
    const h = new Headers();
    h.set("x-namespace-id", "test-ns");
    h.set("content-type", "application/json");
    return {
      url: "http://localhost:3000/api/email/send",
      method: "POST",
      headers: h,
      json: async () => body,
      nextUrl: new URL("http://localhost:3000/api/email/send"),
    } as unknown as MockNextRequest;
  }

  function mockRequestWithInvalidJson(): MockNextRequest {
    const h = new Headers();
    h.set("x-namespace-id", "test-ns");
    return {
      url: "http://localhost:3000/api/email/send",
      method: "POST",
      headers: h,
      json: async () => {
        throw new Error("Invalid JSON");
      },
      text: async () => "invalid json",
      nextUrl: new URL("http://localhost:3000/api/email/send"),
    } as unknown as MockNextRequest;
  }

  describe("validation", () => {
    it("missing 'to' returns 400", async () => {
      const req = mockRequest({ subject: "test" });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toBe("Field 'to' is required");
    });

    it("empty array 'to' returns 400", async () => {
      const req = mockRequest({ to: [], subject: "test" });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toBe("Field 'to' is required");
    });

    it("missing 'subject' returns 400", async () => {
      const req = mockRequest({ to: "test@example.com" });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toBe("Field 'subject' is required");
    });

    it("invalid JSON body returns 500", async () => {
      const req = mockRequestWithInvalidJson();
      const res = await POST(req);
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error.code).toBe("INTERNAL_SERVER_ERROR");
      expect(data.error.message).toBe("Invalid JSON");
    });

    it("empty subject returns 400", async () => {
      const req = mockRequest({ to: "test@example.com", subject: "" });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toBe("Field 'subject' is required");
    });
  });

  describe("auth", () => {
    it("requirePermission returns 401 = route returns 401", async () => {
      const mockResponse = {
        status: 401,
        json: async () => ({ error: "Unauthorized" }),
        headers: new Headers(),
      };
      (requirePermission as jest.Mock).mockResolvedValue(mockResponse);

      const req = mockRequest({ to: "test@example.com", subject: "test" });
      const res = await POST(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("requirePermission returns 403 = route returns 403", async () => {
      const mockResponse = {
        status: 403,
        json: async () => ({ error: "Forbidden" }),
        headers: new Headers(),
      };
      (requirePermission as jest.Mock).mockResolvedValue(mockResponse);

      const req = mockRequest({ to: "test@example.com", subject: "test" });
      const res = await POST(req);
      expect(res.status).toBe(403);
    });
  });

  describe("send quota", () => {
    it("send quota exceeded returns 429", async () => {
      (getSendCount as jest.Mock).mockResolvedValue(1000);

      const req = mockRequest({ to: "test@example.com", subject: "test" });
      const res = await POST(req);
      expect(res.status).toBe(429);
      const data = await res.json();
      expect(data.error.code).toBe("RATE_LIMIT_EXCEEDED");
      expect(data.error.message).toContain("Daily send quota of 1000 reached");
    });

    it("send quota at limit returns 429", async () => {
      // use a higher count than default quota of 1000
      (getSendCount as jest.Mock).mockResolvedValue(1001);

      const req = mockRequest({ to: "test@example.com", subject: "test" });
      const res = await POST(req);
      expect(res.status).toBe(429);
    });

    it("send quota below limit allows send", async () => {
      (getSendCount as jest.Mock).mockResolvedValue(999);

      const req = mockRequest({ to: "test@example.com", subject: "test" });
      const res = await POST(req);
      expect(res.status).not.toBe(429);
    });
  });

  describe("circuit breaker", () => {
    it.skip("circuit breaker paused returns 503", async () => {
      // circuit breaker state is module-private and requires SMTP to trigger
      // skipping since we're only testing non-SMTP paths
    });
  });

  describe("SMTP not configured", () => {
    it("SMTP_USER empty returns 202 queued", async () => {
      process.env.SMTP_USER = "";
      process.env.SMTP_PASS = "";

      const req = mockRequest({
        to: "test@example.com",
        subject: "test subject",
        text: "test body",
      });
      const res = await POST(req);
      expect(res.status).toBe(202);
      const data = await res.json();
      expect(data.data.queued).toBe(true);
      expect(data.data.status).toBe("pending");
      expect(data.data.id).toBeTruthy();

      expect(enqueueOutbound).toHaveBeenCalledWith(
        "test-ns",
        "default",
        expect.objectContaining({
          id: data.data.id,
          status: "pending",
        })
      );
    });

    it("SMTP_PASS empty returns 202 queued", async () => {
      process.env.SMTP_USER = "user";
      process.env.SMTP_PASS = "";

      const req = mockRequest({
        to: "test@example.com",
        subject: "test subject",
      });
      const res = await POST(req);
      expect(res.status).toBe(202);
      const data = await res.json();
      expect(data.data.queued).toBe(true);
      expect(data.data.status).toBe("pending");
    });

    it("both SMTP_USER and SMTP_PASS empty returns 202 queued", async () => {
      process.env.SMTP_USER = "";
      process.env.SMTP_PASS = "";

      const req = mockRequest({
        to: ["test@example.com", "test2@example.com"],
        subject: "test subject",
        html: "<p>test</p>",
      });
      const res = await POST(req);
      expect(res.status).toBe(202);
      const data = await res.json();
      expect(data.data.queued).toBe(true);

      expect(enqueueOutbound).toHaveBeenCalledWith(
        "test-ns",
        "default",
        expect.objectContaining({
          payload: expect.objectContaining({
            to: ["test@example.com", "test2@example.com"],
            subject: "test subject",
            html: "<p>test</p>",
          }),
        })
      );
    });
  });

  describe("custom from address", () => {
    it("uses custom from when provided", async () => {
      process.env.SMTP_USER = "";

      const req = mockRequest({
        to: "test@example.com",
        subject: "test",
        from: "custom@example.com",
      });
      const res = await POST(req);
      expect(res.status).toBe(202);

      expect(enqueueOutbound).toHaveBeenCalledWith(
        "test-ns",
        "default",
        expect.objectContaining({
          payload: expect.objectContaining({
            from: "custom@example.com",
          }),
        })
      );
    });

    it("uses default noreply when custom from not provided", async () => {
      process.env.SMTP_USER = "";
      process.env.SMTP_FROM = "";

      const req = mockRequest({
        to: "test@example.com",
        subject: "test",
      });
      await POST(req);

      expect(enqueueOutbound).toHaveBeenCalledWith(
        "test-ns",
        "default",
        expect.objectContaining({
          payload: expect.objectContaining({
            from: "noreply@mentiko.com",
          }),
        })
      );
    });
  });

  describe("replyTo header", () => {
    it("stores replyTo when provided", async () => {
      process.env.SMTP_USER = "";

      const req = mockRequest({
        to: "test@example.com",
        subject: "test",
        replyTo: "replies@example.com",
      });
      const res = await POST(req);
      expect(res.status).toBe(202);

      expect(enqueueOutbound).toHaveBeenCalledWith(
        "test-ns",
        "default",
        expect.objectContaining({
          payload: expect.objectContaining({
            replyTo: "replies@example.com",
          }),
        })
      );
    });
  });

  describe("error handling", () => {
    it("enqueueOutbound throws returns 500", async () => {
      (enqueueOutbound as jest.Mock).mockRejectedValue(new Error("disk full"));

      const req = mockRequest({
        to: "test@example.com",
        subject: "test",
      });
      const res = await POST(req);
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error.message).toBe("disk full");
    });

    it("getSendCount throws returns 500", async () => {
      (getSendCount as jest.Mock).mockRejectedValue(new Error("db error"));

      const req = mockRequest({
        to: "test@example.com",
        subject: "test",
      });
      const res = await POST(req);
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error.message).toBe("db error");
    });

    it("JSON parsing error returns 500", async () => {
      const h = new Headers();
      h.set("x-namespace-id", "test-ns");
      const req = {
        url: "http://localhost:3000/api/email/send",
        method: "POST",
        headers: h,
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
        text: async () => "{invalid",
        nextUrl: new URL("http://localhost:3000/api/email/send"),
        cookies: {},
        page: {},
        ua: "",
      } as unknown as MockNextRequest;

      const res = await POST(req);
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error.code).toBe("INTERNAL_SERVER_ERROR");
      expect(data.error.message).toBe("Unexpected token");
    });
  });

  describe("namespace header", () => {
    it("uses x-namespace-id header when present", async () => {
      const h = new Headers();
      h.set("x-namespace-id", "custom-ns");
      const req = {
        url: "http://localhost:3000/api/email/send",
        method: "POST",
        headers: h,
        json: async () => ({ to: "test@example.com", subject: "test" }),
        nextUrl: new URL("http://localhost:3000/api/email/send"),
        cookies: {},
        page: {},
        ua: "",
      } as unknown as MockNextRequest;

      await POST(req);

      expect(enqueueOutbound).toHaveBeenCalledWith("custom-ns", "default", expect.anything());
    });

    it("falls back to default namespace when header missing", async () => {
      const h = new Headers();
      const req = {
        url: "http://localhost:3000/api/email/send",
        method: "POST",
        headers: h,
        json: async () => ({ to: "test@example.com", subject: "test" }),
        nextUrl: new URL("http://localhost:3000/api/email/send"),
        cookies: {},
        page: {},
        ua: "",
      } as unknown as MockNextRequest;

      await POST(req);

      expect(enqueueOutbound).toHaveBeenCalledWith("default", "default", expect.anything());
    });
  });

  describe("entry creation", () => {
    it("creates entry with generated UUID", async () => {
      process.env.SMTP_USER = "";

      const req = mockRequest({
        to: "test@example.com",
        subject: "test",
      });
      await POST(req);

      // check that enqueueOutbound was called with a UUID
      expect(enqueueOutbound).toHaveBeenCalledWith(
        "test-ns",
        "default",
        expect.objectContaining({
          id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        })
      );
    });

    it("creates entry with timestamps", async () => {
      process.env.SMTP_USER = "";

      const req = mockRequest({
        to: "test@example.com",
        subject: "test",
      });
      await POST(req);

      expect(enqueueOutbound).toHaveBeenCalledWith(
        "test-ns",
        "default",
        expect.objectContaining({
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        })
      );
    });

    it("initializes entry with zero attempts", async () => {
      process.env.SMTP_USER = "";

      const req = mockRequest({
        to: "test@example.com",
        subject: "test",
      });
      await POST(req);

      expect(enqueueOutbound).toHaveBeenCalledWith(
        "test-ns",
        "default",
        expect.objectContaining({
          attempts: 0,
          lastAttemptAt: null,
          nextRetryAt: null,
        })
      );
    });

    it("sets status to pending initially", async () => {
      process.env.SMTP_USER = "";

      const req = mockRequest({
        to: "test@example.com",
        subject: "test",
      });
      await POST(req);

      expect(enqueueOutbound).toHaveBeenCalledWith(
        "test-ns",
        "default",
        expect.objectContaining({
          status: "pending",
        })
      );
    });
  });

  describe("array to field", () => {
    it("handles string to field", async () => {
      process.env.SMTP_USER = "";

      const req = mockRequest({
        to: "single@example.com",
        subject: "test",
      });
      await POST(req);

      expect(enqueueOutbound).toHaveBeenCalledWith(
        "test-ns",
        "default",
        expect.objectContaining({
          payload: expect.objectContaining({
            to: "single@example.com",
          }),
        })
      );
    });

    it("handles array to field", async () => {
      process.env.SMTP_USER = "";

      const req = mockRequest({
        to: ["one@example.com", "two@example.com"],
        subject: "test",
      });
      await POST(req);

      expect(enqueueOutbound).toHaveBeenCalledWith(
        "test-ns",
        "default",
        expect.objectContaining({
          payload: expect.objectContaining({
            to: ["one@example.com", "two@example.com"],
          }),
        })
      );
    });
  });
});
