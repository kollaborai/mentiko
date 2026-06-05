/**
 * @jest-environment node
 */

const mockStartChainRun = jest.fn().mockResolvedValue({
  runId: "run-123",
  chainId: "decision-preference-synthesis",
  status: "started",
});

jest.mock("@/lib/runs/chain-run-service", () => ({
  startChainRun: (...args: unknown[]) => mockStartChainRun(...args),
}));

jest.mock("@/lib/decisions/decision-core-chains", () => ({
  ensureDecisionCoreChains: jest.fn(),
}));

jest.mock("@/lib/config", () => ({
  orgPath: (_namespaceId: string, _orgId: string, ...segments: string[]) => `/tmp/${segments.join("/")}`,
}));

jest.mock("node:fs", () => ({
  readFileSync: jest.fn((_path: string) => JSON.stringify({ id: "chain-id", agents: [] })),
}));

describe("startDecisionChainRun", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("maps synthesis phase to decision-preference-synthesis core chain", async () => {
    const { startDecisionChainRun } = await import("../decisions/decision-chain-dispatch");
    await startDecisionChainRun({
      request: new Request("http://localhost/api/decisions/1/guided/synthesize", { method: "POST" }),
      namespaceId: "default",
      orgId: "default",
      decision: { id: "dec-1", workspacePath: "/repo" } as never,
      phase: "synthesis",
      prompt: "synthesize this",
      workspacePath: "/repo",
    });

    expect(mockStartChainRun).toHaveBeenCalledWith(expect.objectContaining({
      namespaceId: "default",
      orgId: "default",
      body: expect.objectContaining({
        chainId: "decision-preference-synthesis",
        metadata: expect.objectContaining({
          decisionId: "dec-1",
          decisionPhase: "synthesis",
          workspacePath: "/repo",
        }),
      }),
    }));
  });

  test("maps retrospective phase to decision-retrospective core chain", async () => {
    const { startDecisionChainRun } = await import("../decisions/decision-chain-dispatch");
    await startDecisionChainRun({
      request: new Request("http://localhost/api/decisions/1/retrospective", { method: "POST" }),
      namespaceId: "default",
      orgId: "default",
      decision: { id: "dec-1", workspacePath: "/repo" } as never,
      phase: "retrospective",
      prompt: "retrospective this",
      workspacePath: "/repo",
    });

    expect(mockStartChainRun).toHaveBeenCalledWith(expect.objectContaining({
      namespaceId: "default",
      orgId: "default",
      body: expect.objectContaining({
        chainId: "decision-retrospective",
        metadata: expect.objectContaining({
          decisionId: "dec-1",
          decisionPhase: "retrospective",
          workspacePath: "/repo",
        }),
      }),
    }));
  });
});
