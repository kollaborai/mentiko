jest.mock("next/server", () => {
  class MockNextResponse {
    status: number;
    _body: unknown;
    constructor(body?: unknown, init?: { status?: number }) {
      this.status = init?.status ?? 200;
      this._body = body;
    }
    async json() { return this._body; }
    async text() { return typeof this._body === "string" ? this._body : JSON.stringify(this._body); }
    static json(body: unknown, init?: { status?: number }) {
      return new MockNextResponse(body, init);
    }
  }
  return { NextResponse: MockNextResponse };
});

jest.mock("@/lib/ai-engine/mentiko-mcp-inbox", () => ({
  consumeResult: jest.fn(),
  storeResult: jest.fn(),
}));

jest.mock("@/lib/auth/auth", () => ({
  validateRequest: jest.fn(),
}));

jest.mock("@/lib/auth/session-token", () => ({
  verifySessionToken: jest.fn(),
}));

import { GET, POST } from "./route";
import { consumeResult, storeResult } from "@/lib/ai-engine/mentiko-mcp-inbox";
import { validateRequest } from "@/lib/auth/auth";
import { verifySessionToken } from "@/lib/auth/session-token";

function makeRequest(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
): Request {
  return {
    url,
    method: options.method ?? "GET",
    headers: new Headers(options.headers),
    json: async () => options.body,
  } as never;
}

describe("/api/mentiko-mcp/reply", () => {
  const originalInboxKey = process.env.MENTIKO_INBOX_KEY;

  beforeEach(() => {
    process.env.MENTIKO_INBOX_KEY = "test-inbox-key";
    jest.clearAllMocks();
    (validateRequest as jest.Mock).mockResolvedValue(true);
    (verifySessionToken as jest.Mock).mockResolvedValue({
      sub: "user-1",
      jti: "session-token-jti",
      ns: "default",
      org: "default",
    });
  });

  afterAll(() => {
    process.env.MENTIKO_INBOX_KEY = originalInboxKey;
  });

  test("GET consumes replies from the requested session bucket", async () => {
    (consumeResult as jest.Mock).mockReturnValue({ choice: "approve" });

    const req = makeRequest(
      "http://localhost/api/mentiko-mcp/reply?toolId=tool-1&sessionId=session-a",
      { headers: { "X-Mentiko-Inbox-Key": "test-inbox-key" } },
    );

    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(consumeResult).toHaveBeenCalledWith("session-a", "tool-1");
    await expect(res.json()).resolves.toEqual({ result: { choice: "approve" } });
  });

  test("POST stores replies under the verified bearer token session", async () => {
    const req = makeRequest("http://localhost/api/mentiko-mcp/reply", {
      method: "POST",
      headers: { authorization: "Bearer valid-token" },
      body: {
        toolId: "tool-1",
        result: { choice: "approve" },
        sessionId: "body-session",
      },
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(storeResult).toHaveBeenCalledWith(
      "session-token-jti",
      "tool-1",
      { choice: "approve" },
    );
  });

  test("POST rejects invalid bearer tokens instead of falling back to body/global", async () => {
    (verifySessionToken as jest.Mock).mockRejectedValue(new Error("bad token"));

    const req = makeRequest("http://localhost/api/mentiko-mcp/reply", {
      method: "POST",
      headers: { authorization: "Bearer bad-token" },
      body: {
        toolId: "tool-1",
        result: "ok",
        sessionId: "body-session",
      },
    });

    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(storeResult).not.toHaveBeenCalled();
  });

  test("POST requires explicit session scope when no bearer token is present", async () => {
    const req = makeRequest("http://localhost/api/mentiko-mcp/reply", {
      method: "POST",
      body: {
        toolId: "tool-1",
        result: "ok",
      },
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(storeResult).not.toHaveBeenCalled();
  });

  test("POST stores replies under the body session fallback when no bearer is present", async () => {
    const req = makeRequest("http://localhost/api/mentiko-mcp/reply", {
      method: "POST",
      body: {
        toolId: "tool-1",
        result: "ok",
        sessionId: "body-session",
      },
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(storeResult).toHaveBeenCalledWith("body-session", "tool-1", "ok");
  });
});
