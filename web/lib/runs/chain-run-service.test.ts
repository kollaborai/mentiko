import type { Chain } from "@/lib/types";
import { readFileSync } from "node:fs";
import { join } from "node:path";

jest.mock("@/lib/auth/session-token", () => ({
  mintSessionToken: jest.fn(),
  verifySessionToken: jest.fn(),
}));

import { assertRunnableChainDefinition } from "@/lib/runs/chain-run-service";
import { ValidationError } from "@/lib/api-errors";

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

  // 2026-07-31 incident, TASK-012: run start re-validated an ALREADY SAVED
  // chain under the v0.3.48 prose classifier and blocked its launch. Prose may
  // never block (chain-contract-plan-of-record.md A2) -- run start accepts a
  // chain whose prose mentions lifecycle state and rejects only structural
  // invalidity.
  it("accepts lifecycle-flavored prose at the fully resolved launch boundary", () => {
    const chain = {
      name: "resolved-generated-chain",
      description: "The effective runtime snapshot is contract-checked.",
      version: "1.0.0",
      config: {},
      metadata: {
        generated_chain_contract: {
          version: 1,
          mode: "research",
          acceptance_criteria: "runtime evidence exists",
        },
      },
      agents: [{
        id: "verifier",
        name: "Verifier",
        prompt: "Verify the linked task is open before emitting.",
        triggers: ["manual-start"],
        emits: "verified",
        deliverable: "an evidence-backed verdict",
        verification: "inspect the runtime evidence",
        final_verifier: true,
        verifies_acceptance_criteria: true,
        success_assertion: "runtime evidence exists",
      }],
    } as unknown as Chain;

    expect(() => assertRunnableChainDefinition(chain)).not.toThrow();
  });

  it("still rejects a structurally invalid generated chain at the launch boundary", () => {
    const chain = {
      name: "resolved-generated-chain",
      description: "Structural checks stay blocking.",
      version: "1.0.0",
      config: {},
      metadata: {
        generated_chain_contract: {
          version: 1,
          mode: "research",
          acceptance_criteria: "runtime evidence exists",
        },
      },
      agents: [{
        id: "verifier",
        name: "Verifier",
        prompt: "Verify the runtime evidence.",
        triggers: ["manual-start"],
        emits: "verified",
        deliverable: "an evidence-backed verdict",
        verification: "inspect the runtime evidence",
        // final_verifier missing: the structural gate must still block.
      }],
    } as unknown as Chain;

    try {
      assertRunnableChainDefinition(chain);
      throw new Error("expected generated chain rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect(error).toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 422,
        message: "Invalid generated chain delivery contract",
        details: {
          errors: [expect.stringContaining("final_verifier")],
        },
      });
    }
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
