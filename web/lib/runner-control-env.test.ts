import {
  pickRunnerControlEnv,
  RUNNER_CONTROL_ENV_KEYS,
} from "@/lib/runner-control-env";

describe("runner control environment", () => {
  it("keeps the first non-empty safe value and ignores unrelated secrets", () => {
    expect(pickRunnerControlEnv(
      {
        MENTIKO_MAX_ACTIVE_AGENTS: "",
        MENTIKO_MAX_CONCURRENT_CHAINS: "2",
        DATABASE_URL: "must-not-propagate",
      },
      {
        MENTIKO_MAX_ACTIVE_AGENTS: "1",
        MENTIKO_MAX_CONCURRENT_CHAINS: "4",
      },
    )).toEqual({
      MENTIKO_MAX_CONCURRENT_CHAINS: "2",
      MENTIKO_MAX_ACTIVE_AGENTS: "1",
    });
  });

  it("defines the nano agent cap and both typed-runner switches once", () => {
    expect(RUNNER_CONTROL_ENV_KEYS).toEqual(expect.arrayContaining([
      "MENTIKO_MAX_ACTIVE_AGENTS",
      "MENTIKO_RUNNER_V2",
      "MENTIKO_RUNNER_V2_COMPLETION",
    ]));
    expect(new Set(RUNNER_CONTROL_ENV_KEYS).size).toBe(RUNNER_CONTROL_ENV_KEYS.length);
  });
});
