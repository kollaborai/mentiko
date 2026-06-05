/**
 * @jest-environment node
 */

export {};

const mockCheckAuth = jest.fn().mockResolvedValue(true);
jest.mock("@/lib/auth/api-auth", () => ({
  checkAuth: (...args: unknown[]) => mockCheckAuth(...args),
}));

const mockGetDecision = jest.fn();
const mockUpdateDecision = jest.fn();
jest.mock("@/lib/decisions/decision-storage", () => ({
  getDecision: (...args: unknown[]) => mockGetDecision(...args),
  updateDecision: (...args: unknown[]) => mockUpdateDecision(...args),
}));

const mockCreateJob = jest.fn().mockReturnValue({ id: "job-1", status: "pending" });
const mockGetJob = jest.fn();
jest.mock("@/lib/runs/job-store", () => ({
  createJob: (...args: unknown[]) => mockCreateJob(...args),
  getJob: (...args: unknown[]) => mockGetJob(...args),
}));

const mockStartDecisionChainRun = jest.fn().mockResolvedValue({
  runId: "run-1",
  chainId: "decision-preference-synthesis",
  status: "started",
});
jest.mock("@/lib/decisions/decision-chain-dispatch", () => ({
  startDecisionChainRun: (...args: unknown[]) => mockStartDecisionChainRun(...args),
}));

jest.mock("@/lib/generation/generation-template-storage", () => ({
  getTemplate: jest.fn().mockReturnValue({ content: "template={{DECISION_CONTEXT}}" }),
}));

jest.mock("@/lib/system/template-resolver", () => ({
  resolveTemplate: (_template: string, vars: Record<string, string>) =>
    `resolved=${vars.DECISION_CONTEXT ?? ""}${vars.QUESTIONS_AND_ANSWERS ? `\n${vars.QUESTIONS_AND_ANSWERS}` : ""}`,
}));

jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: jest.fn().mockResolvedValue("default"),
  getOrgIdFromRequest: jest.fn().mockResolvedValue("default"),
}));

jest.mock("@/lib/workspaces/workspace-params", () => ({
  getWorkspacePath: jest.fn().mockReturnValue("/repo"),
}));

jest.mock("@/lib/auth/auth-bridge", () => ({
  getSessionUser: jest.fn().mockResolvedValue({ id: "user-1" }),
}));

jest.mock("@/lib/auth/workspace-auth", () => ({
  resolveAuthorizedWorkspacePath: jest.fn((_namespaceId, _orgId, workspacePath) => workspacePath),
}));

jest.mock("@/lib/api-response", () => ({
  withErrorHandling: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  apiSuccess: (data: unknown) => ({ status: 200, json: async () => data }),
}));

jest.mock("@/lib/api-errors", () => ({
  BadRequest: class BadRequest extends Error {
    constructor(message: string) { super(message); }
  },
  Unauthorized: class Unauthorized extends Error {},
  NotFound: class NotFound extends Error {},
  InternalServerError: class InternalServerError extends Error {},
}));

function makeNextRequest(body: Record<string, unknown>) {
  return {
    json: () => Promise.resolve(body),
    nextUrl: { origin: "http://localhost:3000" },
  } as never;
}

describe("decision synthesis + retrospective chain dispatch routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateJob.mockReturnValue({ id: "job-1", status: "pending" });
    mockStartDecisionChainRun.mockResolvedValue({ runId: "run-1", chainId: "chain-1", status: "started" });
  });

  test("guided synthesize phase 1 starts decision chain phase synthesis and sets synthesisJobId", async () => {
    const decision = {
      id: "dec-1",
      prompt: "pick a stack",
      workspacePath: "/repo",
      guidedFlow: {
        round1: {
          questions: [
            {
              id: "q1",
              category: "speed",
              weight: 3,
              optionA: { label: "A" },
              optionB: { label: "B" },
            },
          ],
          answers: [{ questionId: "q1", choice: "a" }],
          status: "collecting",
        },
      },
    };
    mockGetDecision.mockReturnValue(decision);
    const { POST } = await import("@/app/api/decisions/[id]/guided/synthesize/route");

    const response = await POST(makeNextRequest({}), { params: Promise.resolve({ id: "dec-1" }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ jobId: "job-1", runId: "run-1", status: "pending" });
    expect(mockStartDecisionChainRun).toHaveBeenCalledWith(expect.objectContaining({
      phase: "synthesis",
      decision,
    }));
    expect(mockUpdateDecision).toHaveBeenCalledWith(
      "default",
      "default",
      "dec-1",
      expect.objectContaining({
        guidedFlow: expect.objectContaining({
          round1: expect.objectContaining({
            synthesisJobId: "job-1",
          }),
        }),
      }),
      "/repo",
    );
  });

  test("guided synthesize phase 2 keeps apply behavior and clears synthesisJobId", async () => {
    mockGetJob.mockReturnValue({
      id: "job-complete",
      status: "complete",
      result: { archetype: "optimizer", confidence: 0.9 },
    });
    mockGetDecision.mockReturnValue({
      id: "dec-1",
      guidedFlow: { round1: { questions: [], answers: [], status: "synthesizing", synthesisJobId: "job-complete" } },
    });
    mockUpdateDecision.mockResolvedValue({ id: "dec-1", guidedFlow: { round1: { status: "complete" } } });
    const { POST } = await import("@/app/api/decisions/[id]/guided/synthesize/route");

    const response = await POST(makeNextRequest({ jobId: "job-complete" }), { params: Promise.resolve({ id: "dec-1" }) });

    expect(response.status).toBe(200);
    expect(mockStartDecisionChainRun).not.toHaveBeenCalled();
    expect(mockUpdateDecision).toHaveBeenCalledWith(
      "default",
      "default",
      "dec-1",
      expect.objectContaining({
        guidedFlow: expect.objectContaining({
          round1: expect.objectContaining({
            status: "complete",
            synthesisJobId: undefined,
          }),
        }),
      }),
      "/repo",
    );
  });

  test("retrospective phase 1 starts decision chain phase retrospective and sets retroJobId", async () => {
    const decision = {
      id: "dec-2",
      title: "Ship feature",
      prompt: "ship feature",
      workspacePath: "/repo",
      context: { problem: "slow flow", whyProblem: "users wait" },
      resolution: { selectedOptionId: "opt-1", notes: "go now" },
      options: [{ id: "opt-1", name: "option one", description: "details" }],
    };
    mockGetDecision.mockReturnValue(decision);
    const { POST } = await import("@/app/api/decisions/[id]/retrospective/route");

    const response = await POST(makeNextRequest({}), { params: Promise.resolve({ id: "dec-2" }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ jobId: "job-1", runId: "run-1", status: "pending" });
    expect(mockStartDecisionChainRun).toHaveBeenCalledWith(expect.objectContaining({
      phase: "retrospective",
      decision,
    }));
    expect(mockUpdateDecision).toHaveBeenCalledWith("default", "default", "dec-2", { retroJobId: "job-1" }, "/repo");
  });

  test("retrospective phase 2 keeps apply behavior and clears retroJobId", async () => {
    mockGetJob.mockReturnValue({
      id: "job-retro",
      status: "complete",
      result: { summary: "done", outcome: "good", lessonsLearned: ["ship smaller"] },
    });
    mockUpdateDecision.mockResolvedValue({ id: "dec-2", status: "done" });
    const { POST } = await import("@/app/api/decisions/[id]/retrospective/route");

    const response = await POST(makeNextRequest({ jobId: "job-retro" }), { params: Promise.resolve({ id: "dec-2" }) });

    expect(response.status).toBe(200);
    expect(mockStartDecisionChainRun).not.toHaveBeenCalled();
    expect(mockUpdateDecision).toHaveBeenCalledWith(
      "default",
      "default",
      "dec-2",
      expect.objectContaining({
        status: "done",
        retroJobId: undefined,
        retrospective: expect.objectContaining({
          summary: "done",
          outcome: "good",
          lessonsLearned: ["ship smaller"],
        }),
      }),
      "/repo",
    );
  });
});
