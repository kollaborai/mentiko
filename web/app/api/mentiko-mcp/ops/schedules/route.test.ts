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

jest.mock("@/lib/mentiko-mcp-ops-auth", () => {
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

jest.mock("@/lib/schedule-storage", () => ({
  addSchedule: jest.fn(),
  calculateAndStoreNextRun: jest.fn().mockResolvedValue(null),
  getSchedule: jest.fn(),
  listSchedules: jest.fn().mockResolvedValue([]),
  removeSchedule: jest.fn(),
  slugify: (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  updateSchedule: jest.fn(),
}));

jest.mock("@/lib/validators", () => ({
  validateSchedule: jest.fn().mockReturnValue({ valid: true, errors: [] }),
}));

jest.mock("@/lib/schedule-targets", () => ({
  validateScheduleTarget: jest.fn().mockReturnValue([]),
}));

import { DELETE, POST } from "./route";
import { requireOpsAuth } from "@/lib/mentiko-mcp-ops-auth";
import { addSchedule, removeSchedule } from "@/lib/schedule-storage";

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
    url: "http://localhost/api/mentiko-mcp/ops/schedules",
    headers: new Headers({ authorization: "Bearer test-token" }),
    json: async () => body,
  } as Request;
}

describe("/api/mentiko-mcp/ops/schedules", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireOpsAuth as jest.Mock).mockResolvedValue(guestCtx);
  });

  test("rejects guest schedule creation before storage mutation", async () => {
    const res = await POST(jsonRequest({
      name: "nightly",
      cron: "0 1 * * *",
      target: { type: "chain_run", chainId: "chain-a" },
    }));

    expect(res.status).toBe(403);
    expect(addSchedule).not.toHaveBeenCalled();
  });

  test("rejects guest schedule deletion before storage mutation", async () => {
    const req = {
      url: "http://localhost/api/mentiko-mcp/ops/schedules?id=nightly",
      headers: new Headers({ authorization: "Bearer test-token" }),
    } as Request;

    const res = await DELETE(req);

    expect(res.status).toBe(403);
    expect(removeSchedule).not.toHaveBeenCalled();
  });
});
