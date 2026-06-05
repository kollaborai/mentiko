/**
 * @jest-environment node
 */

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

jest.mock("@/lib/ai-engine/mentiko-mcp-ops-auth", () => ({
  requireOpsAuth: jest.fn().mockResolvedValue({
    userId: "user-test",
    sessionId: "session-test",
    namespaceId: "mike",
    orgId: "default",
    role: "owner",
    scopes: ["decisions:write"],
  }),
  requireOpsPermission: jest.fn().mockReturnValue(null),
}));

const mockGetDecision = jest.fn();
jest.mock("@/lib/decisions/decision-storage", () => ({
  getDecision: (...args: unknown[]) => mockGetDecision(...args),
}));

const mockResolveDecisionToTasks = jest.fn();
jest.mock("@/lib/decisions/decision-resolution", () => ({
  resolveDecisionToTasks: (...args: unknown[]) => mockResolveDecisionToTasks(...args),
}));

import { POST } from "./route";

function makeRequest(body: Record<string, unknown>): Request {
  return {
    url: "http://localhost:3000/api/mentiko-mcp/ops/decisions/approve",
    headers: new Headers({
      "content-type": "application/json",
      authorization: "Bearer test-token",
    }),
    json: async () => body,
  } as Request;
}

describe("POST /api/mentiko-mcp/ops/decisions/approve", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDecision.mockReturnValue({
      id: "decision-1",
      status: "briefed",
      prompt: "Approve me",
      options: [],
      guidedFlow: {
        round2: { selectedOptionId: "opt-a", tailoredOptions: [] },
      },
    });
    mockResolveDecisionToTasks.mockResolvedValue({
      decision: { id: "decision-1", status: "approved" },
      taskId: "EPIC-001",
      taskIds: ["EPIC-001", "TASK-001"],
    });
  });

  it("resolves the decision into tasks instead of status-only patching", async () => {
    const res = await POST(makeRequest({ decisionId: "decision-1" }) as Parameters<typeof POST>[0]);

    expect(res.status).toBe(200);
    expect(mockGetDecision).toHaveBeenCalledWith(
      "mike",
      "default",
      "decision-1",
      undefined,
    );
    expect(mockResolveDecisionToTasks).toHaveBeenCalledWith({
      namespaceId: "mike",
      orgId: "default",
      decisionId: "decision-1",
      selectedOptionId: "opt-a",
      notes: undefined,
      workspaceId: undefined,
      workspacePath: undefined,
      selectedBy: "mentiko-mcp",
    });
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      data: {
        taskId: "EPIC-001",
        taskIds: ["EPIC-001", "TASK-001"],
      },
    });
  });
});
