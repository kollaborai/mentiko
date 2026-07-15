import { validateRunnerV2Contract } from "@/lib/runner-v2/contracts";
import type { RunnerV2Contract } from "@/lib/runner-v2/types";

const baseContract: RunnerV2Contract = {
  schema_version: "runner-contract/v1",
  migration_mode: "side-by-side",
  default_runner: "shell",
  flag: {
    name: "MENTIKO_RUNNER_V2",
    enabled_values: ["1", "true", "yes", "on"],
    default: "off",
    scope: "test",
  },
  completion_flag: {
    name: "MENTIKO_RUNNER_V2_COMPLETION",
    enabled_values: ["1", "true", "yes", "on"],
    default: "on",
    scope: "test",
  },
  invariants: ["default shell behavior remains unchanged"],
};

describe("runner-v2 contract validation", () => {
  it("accepts the side-by-side shell-default contract", () => {
    expect(() => validateRunnerV2Contract(baseContract)).not.toThrow();
  });

  it("blocks changing the default runner inside the contract", () => {
    expect(() => validateRunnerV2Contract({
      ...baseContract,
      default_runner: "runner-v2" as "shell",
    })).toThrow("default runner");
  });

  it("requires invariants", () => {
    expect(() => validateRunnerV2Contract({
      ...baseContract,
      invariants: [],
    })).toThrow("invariants");
  });
});
