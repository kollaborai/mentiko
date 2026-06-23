/**
 * @jest-environment node
 */

describe("chain run task provenance", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock("@/lib/auth/session-token", () => ({
      mintSessionToken: jest.fn(),
      verifySessionToken: jest.fn(),
    }));
  });

  afterEach(() => {
    jest.dontMock("@/lib/auth/session-token");
  });

  test("assigned task chain runs are execution runs", async () => {
    const { shouldRecordTaskExecutionRun } = await import("../runs/chain-run-service");

    expect(shouldRecordTaskExecutionRun({
      taskId: "CHOR-001",
      chainId: "assigned-chain",
      metadata: undefined,
    })).toBe(true);
  });

  test("recommendation and generation audit runs are not execution runs", async () => {
    const { shouldRecordTaskExecutionRun } = await import("../runs/chain-run-service");

    expect(shouldRecordTaskExecutionRun({
      taskId: "CHOR-001",
      chainId: "chain-recommendation",
      metadata: {
        generationJobId: "job-recommend",
        generationKind: "chain_recommendation",
      },
    })).toBe(false);

    expect(shouldRecordTaskExecutionRun({
      taskId: "CHOR-001",
      chainId: "chain-generation",
      metadata: {
        generationJobId: "job-generate",
        generationKind: "chain_generation",
      },
    })).toBe(false);

    expect(shouldRecordTaskExecutionRun({
      taskId: "CHOR-001",
      chainId: "webhook-generation",
      metadata: {
        generationJobId: "job-webhook",
        generationKind: "webhook",
      },
    })).toBe(false);
  });
});
