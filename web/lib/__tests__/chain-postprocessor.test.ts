import { rewriteChainInlineToRef } from "@/lib/chains/chain-postprocessor";

describe("rewriteChainInlineToRef", () => {
  it("rewrites branch fan-out and fan-in ids when inline agents are extracted with new ids", () => {
    const chain = {
      name: "Generated Branch Chain",
      agents: [
        {
          id: "worker-a",
          name: "Worker A",
          prompt: "do work",
          triggers: ["start-ready"],
          emits: "worker-a-complete",
        },
        {
          id: "worker-b",
          name: "Worker B",
          prompt: "do work",
          triggers: ["start-ready"],
          emits: "worker-b-complete",
        },
        {
          id: "validator",
          name: "Validator",
          prompt: "validate work",
          triggers: ["worker-a-complete", "worker-b-complete"],
          emits: "validated",
        },
      ],
      branches: {
        "start-ready": {
          fan_out: ["worker-a", "worker-b"],
          fan_in: "validator",
          on_error: "validator",
          wait_for: "all",
        },
      },
    };

    const rewritten = rewriteChainInlineToRef(
      chain,
      new Map([
        ["worker-a", "worker-a-v2"],
        ["worker-b", "worker-b-v2"],
        ["validator", "validator-v2"],
      ])
    );

    expect(rewritten.agents).toEqual([
      { $ref: "worker-a-v2" },
      { $ref: "worker-b-v2" },
      { $ref: "validator-v2" },
    ]);
    expect(rewritten.branches).toEqual({
      "start-ready": {
        fan_out: ["worker-a-v2", "worker-b-v2"],
        fan_in: "validator-v2",
        on_error: "validator-v2",
        wait_for: "all",
      },
    });
  });
});
