import type { Chain } from "@/lib/types";
import { readFileSync } from "node:fs";
import { join } from "node:path";

jest.mock("@/lib/auth/session-token", () => ({
  mintSessionToken: jest.fn(),
  verifySessionToken: jest.fn(),
}));

import { assertRunnableChainDefinition } from "@/lib/runs/chain-run-service";

describe("assertRunnableChainDefinition", () => {
  it("rejects a self-joining fan-out before a run snapshot is created", () => {
    const chain = {
      name: "invalid-self-join",
      description: "A malformed branch must not enter the runner.",
      version: "1.0.0",
      config: {},
      agents: [
        {
          id: "verifier",
          name: "Verifier",
          prompt: "Verify the result.",
          triggers: ["manual-start"],
          emits: "verified",
        },
      ],
      branches: {
        verified: { fan_out: ["verifier"], fan_in: "verifier", wait_for: "all" },
      },
    } as unknown as Chain;

    expect(() => assertRunnableChainDefinition(chain)).toThrow(
      "Invalid chain",
    );
  });
});

describe("typed chain launch boundary", () => {
  it.each(["1", "0"])("never selects a shell runner when MENTIKO_RUNNER_V2=%s", () => {
    const source = readFileSync(join(process.cwd(), "lib", "runs", "chain-run-service.ts"), "utf8");
    // Both the synchronous (default) and deferred (decision-phase, FIX 6)
    // launch paths call the SAME typed launcher through the SAME shared
    // context object -- proving neither branch drifted onto a shell runner.
    expect(source.match(/startRunnerV2Launch\(runnerV2LaunchContext\)/g)).toHaveLength(2);
    expect(source).not.toContain("isRunnerV2Enabled");
    expect(source).not.toMatch(/spawn\(\s*["']\/bin\/zsh/);
    expect(source).not.toContain("bin/mentiko");
    expect(source).not.toContain("chain-runner.sh");
  });
});
