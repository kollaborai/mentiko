import {
  getRunChainId,
  isSystemChainMetadata,
  isSystemChainRecord,
  isSystemChainRun,
  isSystemRunMetadata,
} from "../system-chain";

describe("system chain helpers", () => {
  it("detects managed core chain metadata", () => {
    expect(isSystemChainMetadata({ coreDecisionChain: true })).toBe(true);
    expect(isSystemChainMetadata({ coreGenerationChain: true })).toBe(true);
    expect(isSystemChainMetadata({ systemChain: true })).toBe(true);
    expect(isSystemChainRecord({ metadata: { coreGenerationChain: true } })).toBe(true);
    expect(isSystemChainMetadata({ category: "user" })).toBe(false);
  });

  it("detects generation and decision runs without naming assumptions", () => {
    expect(isSystemRunMetadata({ generationKind: "task" })).toBe(true);
    expect(isSystemRunMetadata({ generationJobId: "job-1" })).toBe(true);
    expect(isSystemRunMetadata({ decisionPhase: "research" })).toBe(true);
    expect(isSystemRunMetadata({ taskId: "TASK-001" })).toBe(false);
  });

  it("detects runs by their source system chain id", () => {
    const systemChainIds = new Set(["task-generation"]);

    expect(isSystemChainRun({ chainId: "task-generation" }, systemChainIds)).toBe(true);
    expect(isSystemChainRun({ chain: "Task Generation" }, systemChainIds)).toBe(true);
    expect(isSystemChainRun({ chainId: "user-chain" }, systemChainIds)).toBe(false);
    expect(getRunChainId({ chain: "User Chain" })).toBe("user-chain");
  });
});
