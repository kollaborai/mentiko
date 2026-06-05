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
    namespaceId: "tenant-a",
    orgId: "engineering",
    role: "member",
    scopes: [],
  }),
}));

jest.mock("@/lib/workspaces/workspace-storage", () => ({
  listWorkspaces: jest.fn().mockReturnValue([{ id: "w1", path: "/tmp/work" }]),
}));

import { GET } from "./route";

describe("/api/mentiko-mcp/ops/fs", () => {
  test("rejects paths that only share an allowed-root prefix", async () => {
    const res = await GET(new Request(
      "http://localhost/api/mentiko-mcp/ops/fs?action=list_dir&path=/tmp/work-secret",
    ));

    expect(res.status).toBe(403);
  });
});
