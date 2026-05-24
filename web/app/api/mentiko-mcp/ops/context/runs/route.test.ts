import { existsSync, mkdirSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

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

const root = join(tmpdir(), `mentiko-mcp-runs-route-${process.pid}`);

jest.mock("@/lib/config", () => ({
  orgPath: (namespaceId: string, orgId: string, ...segments: string[]) => (
    orgId === "default"
      ? join(root, "namespaces", namespaceId, ...segments)
      : join(root, "namespaces", namespaceId, "orgs", orgId, ...segments)
  ),
}));

jest.mock("@/lib/mentiko-mcp-ops-auth", () => ({
  requireOpsAuth: jest.fn().mockResolvedValue({
    userId: "user-test",
    sessionId: "session-test",
    namespaceId: "mike",
    orgId: "default",
    role: "owner",
    scopes: ["runs:start"],
  }),
  requireOpsPermission: jest.fn().mockReturnValue(null),
}));

import { POST } from "./route";

function safeRemoveTemp(path: string) {
  if (!path.startsWith(tmpdir()) || !path.includes("mentiko-mcp-runs-route-")) {
    throw new Error(`refusing unsafe cleanup path: ${path}`);
  }
  if (!existsSync(path)) return;
  // keep this away from recursive force cleanup; tests only create files/dirs.
  const entries = readdirSync(path, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) safeRemoveTemp(full);
    else unlinkSync(full);
  }
  rmdirSync(path);
}

function writeChain(chainId: string, chain: Record<string, unknown>) {
  const chainDir = join(root, "namespaces", "mike", "chains", chainId);
  mkdirSync(chainDir, { recursive: true });
  writeFileSync(join(chainDir, "chain.json"), JSON.stringify(chain, null, 2));
}

function makeRequest(body: Record<string, unknown>): Request {
  return {
    url: "http://localhost:3000/api/mentiko-mcp/ops/context/runs",
    headers: new Headers({
      "content-type": "application/json",
      authorization: "Bearer test-token",
    }),
    json: async () => body,
  } as Request;
}

describe("POST /api/mentiko-mcp/ops/context/runs", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    safeRemoveTemp(root);
    mkdirSync(root, { recursive: true });
    jest.clearAllMocks();
    process.env.BETTER_AUTH_SECRET = "internal-secret";
    process.env.MENTIKO_WEB_URL = "";
    global.fetch = fetchMock as unknown as typeof fetch;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ success: true, data: { runId: "run-123" } }),
      text: async () => JSON.stringify({ success: true, data: { runId: "run-123" } }),
    });
  });

  afterAll(() => {
    safeRemoveTemp(root);
  });

  test("loads the chain and calls chains/run with internal service auth", async () => {
    writeChain("smoke-chain", {
      name: "smoke-chain",
      description: "smoke",
      agents: [{ id: "a", name: "A", triggers: ["manual-start"], emits: "done" }],
    });

    const res = await POST(makeRequest({
      chainId: "smoke-chain",
      task: "run the smoke",
      workspaceId: "ws-1",
    }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ runId: "run-123" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:3000/api/chains/run");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer internal-secret",
      "x-namespace-id": "mike",
      "x-org-id": "default",
    });
    expect(JSON.parse(init.body)).toMatchObject({
      chainId: "smoke-chain",
      chain: { name: "smoke-chain" },
      userPrompt: "run the smoke",
      workspaceId: "ws-1",
    });
  });

  test("rejects invalid chain ids before filesystem or fetch work", async () => {
    const res = await POST(makeRequest({ chainId: "../mike", task: "bad" }));

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
