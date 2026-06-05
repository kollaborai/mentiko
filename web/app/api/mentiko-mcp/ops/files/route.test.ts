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

  class MockNextRequest extends Request {
    nextUrl: URL;
    constructor(url: string) {
      super(url);
      this.nextUrl = new URL(url);
    }
  }

  return { NextResponse: MockNextResponse, NextRequest: MockNextRequest };
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
  requireOpsPermission: jest.fn().mockReturnValue(null),
}));

jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: jest.fn().mockResolvedValue("default"),
  getOrgIdFromRequest: jest.fn().mockResolvedValue("default"),
}));

jest.mock("@/lib/config", () => ({
  __esModule: true,
  config: {
    root: "/tmp/mentiko-root",
    workspaceDir: "/tmp/mentiko-workspaces",
  },
  default: {
    root: "/tmp/mentiko-root",
    workspaceDir: "/tmp/mentiko-workspaces",
  },
}));

jest.mock("@/lib/workspaces/workspace-storage", () => ({
  listWorkspaces: jest.fn().mockReturnValue([]),
}));

import { GET } from "./route";
import { listWorkspaces } from "@/lib/workspaces/workspace-storage";

describe("/api/mentiko-mcp/ops/files", () => {
  test("builds allowed roots from the ops token namespace and org", async () => {
    const url = new URL("http://localhost/api/mentiko-mcp/ops/files?path=/tmp/file");
    const res = await GET({ nextUrl: url } as never);

    expect(res.status).toBe(403);
    expect(listWorkspaces).toHaveBeenCalledWith("tenant-a", "engineering");
  });
});
