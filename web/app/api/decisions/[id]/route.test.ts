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
const taskUpdate = jest.fn();
const taskGet = jest.fn();
const taskDelete = jest.fn();
const taskList = jest.fn();
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

jest.mock("@/lib/tasks/task-store", () => ({
  taskDelete: (...args: unknown[]) => taskDelete(...args),
  taskGet: (...args: unknown[]) => taskGet(...args),
  taskList: (...args: unknown[]) => taskList(...args),
  taskUpdate: (...args: unknown[]) => taskUpdate(...args),
}));

jest.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => existsSync(...args),
  readFileSync: (...args: unknown[]) => readFileSync(...args),
}));

jest.mock("@/lib/auth/internal-api-auth", () => ({
  resolveInternalAuthSecret: jest.fn(() => "derived-decision-import-secret"),
}));

import { DELETE, GET, PATCH } from "./route";

function makeRequest(body?: Record<string, unknown>): Parameters<typeof GET>[0] {
  return {
    method: body ? "PATCH" : "GET",
    url: "http://localhost:3000/api/decisions/decision-1",
    headers: new Headers(),
    json: async () => body,
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

  test("marks a blocked research run as recoverable instead of leaving it researching forever", async () => {
    const decision = {
      id: "decision-blocked",
      status: "researching",
      prompt: "choose a path",
      createdAt: "2026-06-09T00:00:00.000Z",
      updatedAt: "2026-06-09T00:00:00.000Z",
      options: [],
      researchRunId: "run-blocked",
    };
    const updatedDecision = { ...decision, activeJobId: undefined };

    getDecision.mockReturnValue(decision);
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(JSON.stringify({ status: "blocked" }));
    updateDecision.mockResolvedValue(updatedDecision);

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: decision.id }) });

    expect(updateDecision).toHaveBeenCalledWith(
      "default",
      "default",
      decision.id,
      { activeJobId: undefined },
      undefined,
    );
    await expect(res.json()).resolves.toMatchObject({
      data: {
        decision: {
          status: "researching",
          researchRecovery: "dead",
        },
      },
    });
  });

  test("keeps the repair marker for an intake decision with a dead research pointer", async () => {
    const decision = {
      id: "decision-intake-repair",
      status: "intake",
      prompt: "choose a path",
      createdAt: "2026-06-09T00:00:00.000Z",
      updatedAt: "2026-06-09T00:00:00.000Z",
      options: [],
      researchRunId: "run-stopped",
    };

    getDecision.mockReturnValue(decision);
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(JSON.stringify({ status: "stopped" }));

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: decision.id }) });

    expect(updateDecision).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({
      data: {
        decision: {
          id: decision.id,
          status: "intake",
          researchRecovery: "dead",
        },
      },
    });
  });

  test("nudges a completed-but-unimported guided round without blocking the response (this is the surface the guided-flow UI actually polls)", async () => {
    const originalFetch = global.fetch;
    const decision = {
      id: "decision-2",
      status: "briefed",
      prompt: "choose a path",
      title: "choose a path",
      options: [{ id: "opt-a" }],
      guidedFlow: {
        currentRound: 2,
        round1: { status: "complete", questions: [], answers: [] },
        round2: { status: "ready", tailoredOptions: [], selectedOptionId: "opt-a" },
        round3: { status: "generating", generationRunId: "run-plan-lost" },
      },
    };
    getDecision.mockReturnValue(decision);
    existsSync.mockReturnValue(true);
    readFileSync.mockImplementation((path: string) => {
      if (path.endsWith("run.json")) return JSON.stringify({ status: "completed" });
      if (path.endsWith("decision-result.json")) return JSON.stringify({});
      throw new Error(`unexpected read: ${path}`);
    });
    const fetchMock = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
    global.fetch = fetchMock;

    try {
      const res = await GET(makeRequest(), { params: Promise.resolve({ id: "decision-2" }) });
      expect(res.status).toBe(200);
      // The response returns the still-stale decision (fire-and-forget, not
      // synchronous like the research stale-check above) -- let the nudge's
      // microtask run before asserting on it.
      await Promise.resolve();
      await Promise.resolve();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toContain("/api/decisions/decision-2/import");
      expect(JSON.parse(init.body)).toEqual({
        phase: "plan",
        runId: "run-plan-lost",
        selectedOptionId: "opt-a",
      });
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe("PATCH /api/decisions/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    checkAuth.mockResolvedValue(true);
    getNamespaceIdFromRequest.mockResolvedValue("default");
    getOrgIdFromRequest.mockResolvedValue("default");
    getWorkspacePath.mockReturnValue("/repo");
    getDecision.mockReturnValue({
      id: "decision-1",
      taskId: "DEC-001",
      title: "Old title",
      prompt: "Old prompt",
      status: "briefed",
      options: [],
    });
    updateDecision.mockResolvedValue({
      id: "decision-1",
      taskId: "DEC-001",
      title: "New title",
      prompt: "Old prompt",
      status: "briefed",
      options: [],
    });
  });

  test("syncs the linked task title when the decision title changes", async () => {
    const res = await PATCH(
      makeRequest({ title: "New title" }) as Parameters<typeof PATCH>[0],
      { params: Promise.resolve({ id: "decision-1" }) },
    );

    expect(res.status).toBe(200);
    expect(taskUpdate).toHaveBeenCalledWith(
      "default",
      "DEC-001",
      { title: "New title" },
      "default",
    );
  });
});

describe("DELETE /api/decisions/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    checkAuth.mockResolvedValue(true);
    getNamespaceIdFromRequest.mockResolvedValue("default");
    getOrgIdFromRequest.mockResolvedValue("default");
    getWorkspacePath.mockReturnValue("/repo");
    getDecision.mockReturnValue({
      id: "decision-1",
      taskId: "DEC-038",
      parentTaskId: "TASK-093",
      title: "Dead gate",
      prompt: "Dead gate",
      status: "briefed",
      options: [],
    });
    taskGet.mockImplementation((_orgId: string, taskId: string) => {
      if (taskId === "DEC-038") {
        return {
          id: "DEC-038",
          parent_id: "TASK-093",
          metadata: {
            decision_id: "decision-1",
          },
        };
      }
      if (taskId === "TASK-093") {
        return {
          id: "TASK-093",
          metadata: {
            decision_subtask_id: "DEC-038",
            last_run_decision_required: true,
            superseded_decision_subtask_ids: ["DEC-039", "DEC-038"],
            unrelated: "keep",
          },
        };
      }
      return null;
    });
    taskList.mockReturnValue([]);
  });

  test("deletes linked decision task and clears parent task references", async () => {
    const res = await DELETE(
      makeRequest() as Parameters<typeof DELETE>[0],
      { params: Promise.resolve({ id: "decision-1" }) },
    );

    expect(res.status).toBe(200);
    expect(deleteDecision).toHaveBeenCalledWith("default", "default", "decision-1", "/repo");
    expect(taskDelete).toHaveBeenCalledWith("default", "DEC-038", "default");
    expect(taskUpdate).toHaveBeenCalledWith(
      "default",
      "TASK-093",
      {
        status: "open",
        metadata: expect.objectContaining({
          last_run_decision_required: false,
          superseded_decision_subtask_ids: ["DEC-039"],
          unrelated: "keep",
        }),
      },
      "default",
    );
  });

  test("falls back to DEC task metadata when the decision JSON is already missing", async () => {
    getDecision.mockReturnValue(null);
    taskList.mockReturnValue([
      {
        id: "DEC-038",
        parent_id: "TASK-093",
        issue_type: "decision",
        metadata: {
          decision_id: "decision-1",
          decision_source: "completion-audit",
        },
      },
    ]);
    taskGet.mockImplementation((_orgId: string, taskId: string) => {
      if (taskId === "TASK-093") {
        return {
          id: "TASK-093",
          metadata: {
            decision_subtask_id: "DEC-038",
            last_run_decision_required: true,
          },
        };
      }
      return null;
    });

    const res = await DELETE(
      makeRequest() as Parameters<typeof DELETE>[0],
      { params: Promise.resolve({ id: "decision-1" }) },
    );

    expect(res.status).toBe(200);
    expect(taskList).toHaveBeenCalledWith("default", { status: "all" }, undefined, "default");
    expect(taskDelete).toHaveBeenCalledWith("default", "DEC-038", "default");
    expect(taskUpdate).toHaveBeenCalledWith(
      "default",
      "TASK-093",
      {
        status: "open",
        metadata: expect.objectContaining({ last_run_decision_required: false }),
      },
      "default",
    );
  });

  test("keeps decision-required true when another live completion-audit gate remains", async () => {
    getDecision.mockReturnValue({
      id: "decision-1",
      taskId: "DEC-038",
      parentTaskId: "TASK-093",
      title: "Dead gate",
      prompt: "Dead gate",
      status: "briefed",
      options: [],
    });
    taskList.mockReturnValue([
      {
        id: "DEC-999",
        parent_id: "TASK-093",
        issue_type: "decision",
        status: "open",
        metadata: {
          decision_id: "decision-live",
          decision_source: "completion-audit",
        },
      },
    ]);

    const res = await DELETE(
      makeRequest() as Parameters<typeof DELETE>[0],
      { params: Promise.resolve({ id: "decision-1" }) },
    );

    expect(res.status).toBe(200);
    expect(taskUpdate).toHaveBeenCalledWith(
      "default",
      "TASK-093",
      {
        status: "blocked",
        metadata: expect.objectContaining({
          decision_subtask_id: "DEC-999",
          last_run_decision_required: true,
          superseded_decision_subtask_ids: ["DEC-039"],
          unrelated: "keep",
        }),
      },
      "default",
    );
  });

  test("is idempotent when the decision JSON and linked DEC task are already gone", async () => {
    getDecision.mockReturnValue(null);
    taskList.mockReturnValue([]);
    taskGet.mockReturnValue(null);

    const res = await DELETE(
      makeRequest() as Parameters<typeof DELETE>[0],
      { params: Promise.resolve({ id: "decision-1" }) },
    );

    expect(res.status).toBe(200);
    expect(deleteDecision).toHaveBeenCalledWith("default", "default", "decision-1", "/repo");
    expect(taskDelete).not.toHaveBeenCalled();
    expect(taskUpdate).not.toHaveBeenCalled();
  });
});
