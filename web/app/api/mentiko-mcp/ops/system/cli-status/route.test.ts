jest.mock("next/server", () => {
  class MockNextResponse {
    status: number;
    _body: unknown;
    headers: Headers;
    constructor(body?: unknown, init?: { status?: number; headers?: Record<string, string> }) {
      this.status = init?.status ?? 200;
      this._body = body;
      this.headers = new Headers(init?.headers);
    }
    async json() { return this._body; }
    async text() { return typeof this._body === "string" ? this._body : JSON.stringify(this._body); }
    static json(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
      return new MockNextResponse(body, init);
    }
  }
  return { NextResponse: MockNextResponse };
});

jest.mock("@/lib/mentiko-mcp-ops-auth", () => ({
  requireOpsAuth: jest.fn().mockResolvedValue({
    userId: "user-test",
    sessionId: "session-test",
    namespaceId: "mike",
    orgId: "default",
    role: "owner",
    scopes: [],
  }),
}));

import { GET } from "./route";

function makeRequest(): Parameters<typeof GET>[0] {
  return {
    url: "http://localhost:3000/api/mentiko-mcp/ops/system/cli-status",
    headers: new Headers({ authorization: "Bearer test-token" }),
  } as unknown as Parameters<typeof GET>[0];
}

describe("GET /api/mentiko-mcp/ops/system/cli-status", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.MENTIKO_WEB_URL = "http://localhost:3000";
    process.env.MENTIKO_INBOX_KEY = "inbox-secret";
    global.fetch = fetchMock as unknown as typeof fetch;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          tools: [{ name: "claude", found: true, authenticated: true }],
        },
      }),
    });
  });

  test("returns the proxied CLI payload without double nesting", async () => {
    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      tools: [{ name: "claude", found: true, authenticated: true }],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3000/api/system/detect-cli",
      {
        method: "GET",
        headers: {
          "X-Mentiko-Inbox-Key": "inbox-secret",
        },
      },
    );
  });
});
