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
    scopes: ["decisions:write"],
  }),
  requireOpsPermission: jest.fn().mockReturnValue(null),
}));

jest.mock("@/lib/decision-storage", () => ({
  createDecision: jest.fn(),
  getDecision: jest.fn(),
  updateDecision: jest.fn(),
}));

import { GET, POST } from "./route";
import { createDecision, getDecision, updateDecision } from "@/lib/decision-storage";

function makeRequest(body: Record<string, unknown>): Request {
  return {
    url: "http://localhost:3000/api/mentiko-mcp/ops/decisions",
    headers: new Headers({
      "content-type": "application/json",
      authorization: "Bearer test-token",
    }),
    json: async () => body,
  } as Request;
}

describe("POST /api/mentiko-mcp/ops/decisions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (createDecision as jest.Mock).mockReturnValue({
      id: "decision-123",
      status: "intake",
      prompt: "smoke test decision",
      title: "smoke test decision",
      createdAt: "2026-05-24T00:00:00.000Z",
      updatedAt: "2026-05-24T00:00:00.000Z",
      options: [],
    });
    (updateDecision as jest.Mock).mockResolvedValue({
      id: "decision-123",
      status: "intake",
      prompt: "smoke test decision",
      title: "smoke test decision",
      createdAt: "2026-05-24T00:00:00.000Z",
      updatedAt: "2026-05-24T00:00:01.000Z",
      options: [],
      mode: "guided",
      guidedFlow: {
        currentRound: 1,
        startedAt: "2026-05-24T00:00:00.000Z",
        round1: { status: "pending", questions: [], answers: [] },
        round2: { status: "pending", tailoredOptions: [] },
        round3: { status: "pending" },
      },
    });
  });

  test("creates a guided decision for the authenticated namespace", async () => {
    const res = await POST(makeRequest({
      topic: "smoke test decision",
      mode: "guided",
    }));

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({
      decision: {
        id: "decision-123",
        mode: "guided",
        guidedFlow: {
          currentRound: 1,
          round1: { status: "pending", questions: [], answers: [] },
        },
      },
    });
    expect(createDecision).toHaveBeenCalledWith(
      "mike",
      "default",
      { prompt: "smoke test decision", source: "mentiko-mcp" },
      undefined,
    );
    expect(updateDecision).toHaveBeenCalledWith(
      "mike",
      "default",
      "decision-123",
      expect.objectContaining({
        mode: "guided",
        guidedFlow: expect.objectContaining({
          currentRound: 1,
          round1: { status: "pending", questions: [], answers: [] },
          round2: { status: "pending", tailoredOptions: [] },
          round3: { status: "pending" },
        }),
      }),
      undefined,
    );
  });

  test("rejects empty topics before storage mutation", async () => {
    const res = await POST(makeRequest({ topic: "   " }));

    expect(res.status).toBe(400);
    expect(createDecision).not.toHaveBeenCalled();
    expect(updateDecision).not.toHaveBeenCalled();
  });

  test("returns flattened decision state without apiSuccess nesting", async () => {
    (getDecision as jest.Mock).mockReturnValue({
      id: "decision-123",
      status: "intake",
      prompt: "smoke test decision",
      title: "smoke test decision",
      createdAt: "2026-05-24T00:00:00.000Z",
      updatedAt: "2026-05-24T00:00:01.000Z",
      options: [],
      mode: "guided",
      guidedFlow: {
        currentRound: 1,
        round1: {
          status: "pending",
          questions: [
            {
              id: "q1",
              text: "Speed or polish?",
              optionA: { label: "Speed", value: "speed" },
              optionB: { label: "Polish", value: "polish" },
              category: "priority",
              weight: 1,
            },
          ],
          answers: [],
        },
        round2: { status: "pending", tailoredOptions: [] },
        round3: { status: "pending" },
      },
    });

    const req = {
      url: "http://localhost:3000/api/mentiko-mcp/ops/decisions?id=decision-123",
      headers: new Headers({ authorization: "Bearer test-token" }),
      nextUrl: new URL("http://localhost:3000/api/mentiko-mcp/ops/decisions?id=decision-123"),
    } as unknown as Parameters<typeof GET>[0];
    const res = await GET(req);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      decision: expect.objectContaining({
        id: "decision-123",
        topic: "smoke test decision",
        pendingQuestions: [
          expect.objectContaining({
            id: "q1",
            questionText: "Speed or polish?",
          }),
        ],
      }),
    });
  });
});
