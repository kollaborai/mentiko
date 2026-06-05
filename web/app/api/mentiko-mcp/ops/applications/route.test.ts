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

jest.mock("@/lib/ai-engine/mentiko-mcp-ops-auth", () => {
  const { NextResponse } = jest.requireMock("next/server");
  return {
    requireOpsAuth: jest.fn(),
    requireOpsPermission: jest.fn((ctx) => (
      ctx.role === "guest"
        ? NextResponse.json({ error: "Forbidden" }, { status: 403 })
        : null
    )),
  };
});

jest.mock("@/lib/schedules/scheduled-application-storage", () => ({
  getScheduledApplication: jest.fn(),
  listScheduledApplications: jest.fn().mockReturnValue([]),
  removeScheduledApplication: jest.fn(),
  upsertScheduledApplication: jest.fn(),
}));

jest.mock("@/lib/schedules/schedule-targets", () => ({
  validateScheduleTarget: jest.fn().mockReturnValue([]),
}));

jest.mock("@/lib/schedules/schedule-storage", () => ({
  slugify: (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
}));

import { DELETE, POST } from "./route";
import { requireOpsAuth } from "@/lib/ai-engine/mentiko-mcp-ops-auth";
import {
  removeScheduledApplication,
  upsertScheduledApplication,
} from "@/lib/schedules/scheduled-application-storage";

const guestCtx = {
  userId: "guest-user",
  sessionId: "session-1",
  namespaceId: "default",
  orgId: "default",
  role: "guest",
  scopes: [],
};

function jsonRequest(body: Record<string, unknown>): Request {
  return {
    url: "http://localhost/api/mentiko-mcp/ops/applications",
    headers: new Headers({ authorization: "Bearer test-token" }),
    json: async () => body,
  } as Request;
}

describe("/api/mentiko-mcp/ops/applications", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireOpsAuth as jest.Mock).mockResolvedValue(guestCtx);
  });

  test("rejects guest application registration before storage mutation", async () => {
    const res = await POST(jsonRequest({
      name: "importer",
      executable: "python3",
      workingDirectory: "/work/importer",
    }));

    expect(res.status).toBe(403);
    expect(upsertScheduledApplication).not.toHaveBeenCalled();
  });

  test("rejects guest application deletion before storage mutation", async () => {
    const req = {
      url: "http://localhost/api/mentiko-mcp/ops/applications?id=importer",
      headers: new Headers({ authorization: "Bearer test-token" }),
    } as Request;

    const res = await DELETE(req);

    expect(res.status).toBe(403);
    expect(removeScheduledApplication).not.toHaveBeenCalled();
  });
});
