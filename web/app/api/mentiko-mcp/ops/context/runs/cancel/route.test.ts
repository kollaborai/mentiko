jest.mock("next/server", () => {
  class MockNextResponse {
    status: number;
    _body: unknown;
    constructor(body?: unknown, init?: { status?: number }) {
      this.status = init?.status ?? 200;
      this._body = body;
    }
    async text() { return typeof this._body === "string" ? this._body : JSON.stringify(this._body); }
    static json(body: unknown, init?: { status?: number }) {
      return new MockNextResponse(body, init);
    }
  }
  return { NextResponse: MockNextResponse };
});

jest.mock("@/lib/ai-engine/mentiko-mcp-ops-auth", () => ({
  requireOpsAuth: jest.fn().mockResolvedValue({
    userId: "user-1",
    sessionId: "session-1",
    namespaceId: "default",
    orgId: "default",
    role: "member",
    scopes: [],
  }),
  requireOpsPermission: jest.fn().mockReturnValue(null),
}));

jest.mock("@/lib/config", () => ({
  __esModule: true,
  default: { runsDir: "/tmp/mentiko-runs" },
  orgPath: jest.fn((namespaceId: string, orgId: string, ...parts: string[]) =>
    orgId === "default"
      ? ["/tmp/mentiko", namespaceId, ...parts].join("/")
      : ["/tmp/mentiko", namespaceId, "orgs", orgId, ...parts].join("/"),
  ),
}));

jest.mock("@/lib/pty/pty-client", () => ({
  pty: { remove: jest.fn() },
}));

jest.mock("@/lib/tasks/task-store", () => ({
  taskMergeMeta: jest.fn(),
}));

jest.mock("@/lib/system/system-logger", () => ({
  writeLog: jest.fn(),
}));

import { POST } from "./route";

function request(body: Record<string, unknown>): Request {
  return {
    url: "http://localhost/api/mentiko-mcp/ops/context/runs/cancel",
    json: async () => body,
  } as Request;
}

describe("POST /api/mentiko-mcp/ops/context/runs/cancel", () => {
  test("rejects traversal-shaped run ids before filesystem access", async () => {
    const res = await POST(request({ runId: "run-123/../../secret" }));

    expect(res.status).toBe(400);
  });
});
