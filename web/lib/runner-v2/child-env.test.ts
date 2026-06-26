import { buildChildEnv } from "@/lib/runs/child-env";

describe("runner-v2 child env propagation", () => {
  it("preserves the opt-in flag through the real child env allowlist", () => {
    const previous = process.env.MENTIKO_RUNNER_V2;
    process.env.MENTIKO_RUNNER_V2 = "1";
    try {
      expect(buildChildEnv().MENTIKO_RUNNER_V2).toBe("1");
    } finally {
      if (previous === undefined) delete process.env.MENTIKO_RUNNER_V2;
      else process.env.MENTIKO_RUNNER_V2 = previous;
    }
  });
});
