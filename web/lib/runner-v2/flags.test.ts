import { isRunnerV2Enabled } from "@/lib/runner-v2/flags";

describe("runner-v2 flag", () => {
  it("is off by default", () => {
    expect(isRunnerV2Enabled({})).toBe(false);
  });

  it("accepts explicit opt-in values", () => {
    for (const value of ["1", "true", "yes", "on", " TRUE "]) {
      expect(isRunnerV2Enabled({ MENTIKO_RUNNER_V2: value })).toBe(true);
    }
  });

  it("rejects non opt-in values", () => {
    for (const value of ["0", "false", "no", "", "2"]) {
      expect(isRunnerV2Enabled({ MENTIKO_RUNNER_V2: value })).toBe(false);
    }
  });
});

