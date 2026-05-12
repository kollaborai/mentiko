import { validateChain } from "../validators";

function chainWithTimeout(timeout: number) {
  return {
    name: "Generated chain",
    description: "A generated chain",
    version: "1.0.0",
    config: {},
    agents: [
      {
        id: "researcher",
        name: "Researcher",
        triggers: ["chain_start"],
        emits: "research_complete",
        timeout,
      },
    ],
  };
}

describe("validateChain", () => {
  it("accepts generated agent timeout sentinels", () => {
    expect(validateChain(chainWithTimeout(0)).valid).toBe(true);
    expect(validateChain(chainWithTimeout(-1)).valid).toBe(true);
  });

  it("rejects invalid negative agent timeouts", () => {
    const result = validateChain(chainWithTimeout(-2));

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("agents[0].timeout: must be -1 or at least 0");
  });
});
