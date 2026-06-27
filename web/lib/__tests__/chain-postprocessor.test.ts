import { rewriteChainInlineToRef } from "@/lib/chains/chain-postprocessor";
import { validateChain } from "@/lib/validators";

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
      { $ref: "worker-a-v2", triggers: ["start-ready"], emits: "worker-a-complete" },
      { $ref: "worker-b-v2", triggers: ["start-ready"], emits: "worker-b-complete" },
      { $ref: "validator-v2", triggers: ["worker-a-complete", "worker-b-complete"], emits: "validated" },
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

  it("keeps emitted events on extracted refs so generated branch chains still save", () => {
    const chain = {
      name: "Git API stash mock fix chain",
      description: "Fixes stash mock test failures and validates the result.",
      version: "1.0.0",
      config: {
        max_rounds: 3,
        on_complete: "stop",
      },
      agents: [
        {
          id: "test-failure-analyzer",
          name: "Test Failure Analyzer",
          prompt: "analyze failures",
          triggers: ["manual-start"],
          emits: "analysis-complete",
        },
        {
          id: "mock-implementation-fixer",
          name: "Mock Implementation Fixer",
          prompt: "fix mock implementation",
          triggers: ["analysis-complete"],
          emits: "mock-fixes-complete",
        },
        {
          id: "test-suite-validator",
          name: "Test Suite Validator",
          prompt: "validate tests",
          triggers: ["mock-fixes-complete"],
          emits: "validation-complete",
        },
      ],
      branches: {
        "validation-complete": {
          conditions: [
            { if: "validation-complete with 100% pass rate", then: "stop" },
            { if: "validation-complete with remaining failures", then: "test-failure-analyzer" },
          ],
        },
      },
    };

    const rewritten = rewriteChainInlineToRef(
      chain,
      new Map([
        ["test-failure-analyzer", "test-failure-analyzer-v2"],
        ["mock-implementation-fixer", "mock-implementation-fixer-v2"],
        ["test-suite-validator", "test-suite-validator-v2"],
      ])
    );

    expect(rewritten.branches).toEqual({
      "validation-complete": {
        conditions: [
          { if: "validation-complete with 100% pass rate", then: "stop" },
          { if: "validation-complete with remaining failures", then: "test-failure-analyzer-v2" },
        ],
      },
    });
    expect(validateChain(rewritten).valid).toBe(true);
  });
});
