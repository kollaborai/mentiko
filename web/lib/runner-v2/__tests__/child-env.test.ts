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

  it("preserves tenant capacity limits through the detached runner boundary", () => {
    const keys = {
      MENTIKO_CAP_DISABLED: "0",
      MENTIKO_MAX_CONCURRENT_CHAINS: "2",
      MENTIKO_CAP_MAX_WAIT_SECS: "90",
      MENTIKO_CAP_POLL_SECS: "1",
      MENTIKO_CAP_POLL_MAX_SECS: "5",
      MENTIKO_MAX_ACTIVE_AGENTS: "1",
      MAX_CONCURRENT_AGENTS: "1",
      MENTIKO_AGENT_CAP_MAX_WAIT_SECS: "90",
      MENTIKO_AGENT_CAP_POLL_SECS: "1",
      MENTIKO_AGENT_CAP_POLL_MAX_SECS: "5",
    } as const;
    const previous = new Map(Object.keys(keys).map((key) => [key, process.env[key]]));
    Object.assign(process.env, keys);
    try {
      expect(buildChildEnv()).toEqual(expect.objectContaining(keys));
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("preserves runner liveness policy through the detached runner boundary", () => {
    const keys = {
      MENTIKO_MONITOR_INTERVAL: "2",
      MENTIKO_MONITOR_MAX_STALE: "30",
      MENTIKO_ADVISOR_STALE_COUNT: "1",
      MENTIKO_MONITOR_MAX_NUDGES: "2",
      MENTIKO_MONITOR_NEVER_ARMED_GRACE: "4",
      MENTIKO_RUNNER_V2_SUBMISSION_POLL_MS: "250",
      MENTIKO_RUNNER_V2_SUBMISSION_DEADLINE_MS: "5000",
    } as const;
    const previous = new Map(Object.keys(keys).map((key) => [key, process.env[key]]));
    Object.assign(process.env, keys);
    try {
      expect(buildChildEnv()).toEqual(expect.objectContaining(keys));
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
