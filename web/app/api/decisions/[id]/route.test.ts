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
    static json(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
      return new MockNextResponse(body, init);
    }
  }
  return { NextResponse: MockNextResponse };
});

const checkAuth = jest.fn();
const getNamespaceIdFromRequest = jest.fn();
const getOrgIdFromRequest = jest.fn();
const getWorkspacePath = jest.fn();
const getDecision = jest.fn();
const updateDecision = jest.fn();
const deleteDecision = jest.fn();
const getJob = jest.fn();
const resolveLinkRunsDir = jest.fn();
const applyDecisionRunResult = jest.fn();
const existsSync = jest.fn();
const readFileSync = jest.fn();

jest.mock("@/lib/auth/api-auth", () => ({
  checkAuth: (...args: unknown[]) => checkAuth(...args),
}));

jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: (...args: unknown[]) => getNamespaceIdFromRequest(...args),
  getOrgIdFromRequest: (...args: unknown[]) => getOrgIdFromRequest(...args),
}));

jest.mock("@/lib/workspaces/workspace-params", () => ({
  getWorkspacePath: (...args: unknown[]) => getWorkspacePath(...args),
}));

jest.mock("@/lib/decisions/decision-storage", () => ({
  getDecision: (...args: unknown[]) => getDecision(...args),
  updateDecision: (...args: unknown[]) => updateDecision(...args),
  deleteDecision: (...args: unknown[]) => deleteDecision(...args),
}));

jest.mock("@/lib/runs/job-store", () => ({
  getJob: (...args: unknown[]) => getJob(...args),
}));

jest.mock("@/lib/links/link-run-runtime", () => ({
  resolveLinkRunsDir: (...args: unknown[]) => resolveLinkRunsDir(...args),
}));

jest.mock("@/lib/decisions/decision-run-results", () => ({
  applyDecisionRunResult: (...args: unknown[]) => applyDecisionRunResult(...args),
}));

jest.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => existsSync(...args),
  readFileSync: (...args: unknown[]) => readFileSync(...args),
}));

import { GET } from "./route";

function makeRequest(): Parameters<typeof GET>[0] {
  return {
    method: "GET",
    url: "http://localhost:3000/api/decisions/decision-1",
    headers: new Headers(),
  } as unknown as Parameters<typeof GET>[0];
}

describe("GET /api/decisions/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    checkAuth.mockResolvedValue(true);
    getNamespaceIdFromRequest.mockResolvedValue("default");
    getOrgIdFromRequest.mockResolvedValue("default");
    getWorkspacePath.mockReturnValue(undefined);
    resolveLinkRunsDir.mockReturnValue("/tmp/runs");
  });

  test("imports completed research artifact before returning a stuck decision", async () => {
    const researchingDecision = {
      id: "decision-1",
      status: "researching",
      prompt: "choose a path",
      title: "choose a path",
      createdAt: "2026-06-09T00:00:00.000Z",
      updatedAt: "2026-06-09T00:00:00.000Z",
      options: [],
      researchRunId: "run-123",
    };
    const briefedDecision = {
      ...researchingDecision,
      status: "briefed",
      brief: { headline: "done" },
    };

    getDecision.mockReturnValue(researchingDecision);
    existsSync.mockReturnValue(true);
    readFileSync.mockImplementation((path: string) => {
      if (path.endsWith("/run.json")) return JSON.stringify({ status: "completed" });
      if (path.endsWith("/artifacts/decision-result.json")) {
        return JSON.stringify({
          title: "choose a path",
          brief: { headline: "done" },
        });
      }
      throw new Error(`unexpected read: ${path}`);
    });
    applyDecisionRunResult.mockResolvedValue(briefedDecision);

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "decision-1" }) });

    expect(res.status).toBe(200);
    expect(applyDecisionRunResult).toHaveBeenCalledWith({
      namespaceId: "default",
      orgId: "default",
      decisionId: "decision-1",
      phase: "research",
      result: {
        title: "choose a path",
        brief: { headline: "done" },
      },
      runId: "run-123",
      workspacePath: undefined,
    });
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      data: {
        decision: {
          status: "briefed",
          brief: { headline: "done" },
        },
      },
    });
  });
});
