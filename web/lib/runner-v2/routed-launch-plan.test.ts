import { buildRoutedLaunchPlans } from "@/lib/runner-v2/routed-launch-plan";

jest.mock("@/lib/config", () => ({
  __esModule: true,
  default: {
    codeRoot: "/repo",
  },
}));

jest.mock("@/lib/api/audit-exec", () => ({
  shellEscape: (value: string) => `'${value.replace(/'/g, "'\\''")}'`,
}));

describe("runner-v2 routed launch plans", () => {
  const context = {
    chainPath: "/runs/run-1/chain.json",
    workspacePath: "/workspace",
    taskId: "task-1",
    debug: true,
    runDir: "/runs/run-1",
    fanGroupId: "draft-ready-20260626-1234",
    env: { MENTIKO_RUN_ID: "run-1" },
  };

  it("builds a single typed routed launch plan", () => {
    expect(buildRoutedLaunchPlans({
      action: "launch",
      agentIds: ["reviewer"],
      reason: "trigger match",
    }, context)).toEqual([expect.objectContaining({
      kind: "single",
      agentIds: ["reviewer"],
      command: expect.stringContaining("runner-v2-launch-agent"),
      env: expect.objectContaining({ MENTIKO_RUN_ID: "run-1", MENTIKO_RUN_DIR: "/runs/run-1", MENTIKO_WORKSPACE_PATH: "/workspace" }),
    })]);
    expect(buildRoutedLaunchPlans({ action: "launch", agentIds: ["reviewer"], reason: "trigger match" }, context)[0].command)
      .not.toContain("chain-runner.sh");
  });

  it("shell-escapes a '--'-prefixed agent id instead of treating it as a bare flag", () => {
    expect(buildRoutedLaunchPlans({
      action: "launch",
      agentIds: ["--evil; rm -rf"],
      reason: "trigger match",
    }, context)[0]).toMatchObject({
      kind: "single",
      command: expect.stringContaining("'--evil; rm -rf'"),
    });
  });

  it("shell-escapes an agent id that collides with a known flag name", () => {
    expect(buildRoutedLaunchPlans({
      action: "launch",
      agentIds: ["--start"],
      reason: "trigger match",
    }, context)[0]).toMatchObject({
      kind: "single",
      command: expect.stringContaining("'--start'"),
    });
  });

  it("builds one typed parallel launch plan for multiple agents", () => {
    expect(buildRoutedLaunchPlans({
      action: "launch",
      agentIds: ["a", "b"],
      reason: "trigger match",
    }, context)[0]).toMatchObject({
      kind: "parallel",
      agentIds: ["a", "b"],
      command: expect.stringMatching(/runner-v2-launch-agent.*'a' 'b'/),
    });
  });

  it("builds synchronous-acceptance fan-out plans with per-agent logs and fan metadata", () => {
    expect(buildRoutedLaunchPlans({
      action: "launch",
      agentIds: ["a", "b"],
      reason: "branch fan-out",
      fanIn: "merge",
      waitFor: "all",
    }, context)).toEqual([
      expect.objectContaining({
        kind: "fan-out",
        agentIds: ["a"],
        command: expect.stringMatching(/runner-v2-launch-agent.*'a'/),
        env: expect.objectContaining({ MENTIKO_RUN_ID: "run-1", AGENT_FAN_GROUP_AGENT_ID: "a", AGENT_FAN_GROUP_ID: "draft-ready-20260626-1234" }),
        logPath: "/runs/run-1/fanout-a.log",
      }),
      expect.objectContaining({
        kind: "fan-out",
        agentIds: ["b"],
        command: expect.stringMatching(/runner-v2-launch-agent.*'b'/),
        env: expect.objectContaining({ MENTIKO_RUN_ID: "run-1", AGENT_FAN_GROUP_AGENT_ID: "b", AGENT_FAN_GROUP_ID: "draft-ready-20260626-1234" }),
        logPath: "/runs/run-1/fanout-b.log",
      }),
    ]);
  });
});
