import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mockRoot = mkdtempSync(join(tmpdir(), "mentiko-ops-cancel-"));

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

jest.mock("@/lib/links/link-run-runtime", () => ({ resolveLinkRunsDir: () => mockRoot }));
jest.mock("@/lib/auth/run-acl", () => ({
  checkRunAccessForUser: () => ({ ok: true }),
  normalizeRunId: (value: unknown) => typeof value === "string" && /^run-\d+$/.test(value) ? value : null,
}));
jest.mock("@/lib/runs/run-provenance", () => ({ isNonExecutionRun: () => false }));

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
  beforeEach(() => {
    rmSync(mockRoot, { recursive: true, force: true });
    mkdirSync(join(mockRoot, "run-123"), { recursive: true });
  });

  afterAll(() => rmSync(mockRoot, { recursive: true, force: true }));

  test("rejects traversal-shaped run ids before filesystem access", async () => {
    const res = await POST(request({ runId: "run-123/../../secret" }));

    expect(res.status).toBe(400);
  });

  test("cancels under the shared run.json lock and clears an open idle incident", async () => {
    const runPath = join(mockRoot, "run-123", "run.json");
    writeFileSync(runPath, JSON.stringify({
      id: "run-123",
      taskId: "TASK-1",
      chain: "sample",
      status: "running",
      agents: [{ id: "agent-1", status: "running", session: "agent-session" }],
      runnerV2: { idleIncident: { id: "incident-1", status: "open", reason: "stale run" } },
    }));

    const response = await POST(request({ runId: "run-123" }));
    const run = JSON.parse(readFileSync(runPath, "utf8")) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(run.status).toBe("cancelled");
    expect(run.runnerV2).toMatchObject({ idleIncident: { id: "incident-1", status: "cleared" } });
    expect(run.agents).toEqual([expect.objectContaining({ id: "agent-1", status: "cancelled" })]);
  });
});
