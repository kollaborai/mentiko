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

  it("builds a single --start launch plan", () => {
    expect(buildRoutedLaunchPlans({
      action: "launch",
      agentIds: ["reviewer"],
      reason: "trigger match",
    }, context)).toEqual([{
      kind: "single",
      command: "bash '/repo/lib/chain-runner.sh' '/runs/run-1/chain.json' --workspace '/workspace' --task 'task-1' --debug --start 'reviewer'",
      env: { MENTIKO_RUN_ID: "run-1" },
      detached: true,
    }]);
  });

  it("builds one --parallel launch plan for multiple agents", () => {
    expect(buildRoutedLaunchPlans({
      action: "launch",
      agentIds: ["a", "b"],
      reason: "trigger match",
    }, context)[0]).toMatchObject({
      kind: "parallel",
      command: "bash '/repo/lib/chain-runner.sh' '/runs/run-1/chain.json' --workspace '/workspace' --task 'task-1' --debug --parallel 'a' 'b'",
      detached: true,
    });
  });

  it("builds detached fan-out plans with per-agent logs and fan metadata", () => {
    expect(buildRoutedLaunchPlans({
      action: "launch",
      agentIds: ["a", "b"],
      reason: "branch fan-out",
      fanIn: "merge",
      waitFor: "all",
    }, context)).toEqual([
      {
        kind: "fan-out",
        command: "bash '/repo/lib/chain-runner.sh' '/runs/run-1/chain.json' --workspace '/workspace' --task 'task-1' --debug --start 'a'",
        env: { MENTIKO_RUN_ID: "run-1", AGENT_FAN_GROUP_AGENT_ID: "a", AGENT_FAN_GROUP_ID: "draft-ready-20260626-1234" },
        logPath: "/runs/run-1/fanout-a.log",
        detached: true,
      },
      {
        kind: "fan-out",
        command: "bash '/repo/lib/chain-runner.sh' '/runs/run-1/chain.json' --workspace '/workspace' --task 'task-1' --debug --start 'b'",
        env: { MENTIKO_RUN_ID: "run-1", AGENT_FAN_GROUP_AGENT_ID: "b", AGENT_FAN_GROUP_ID: "draft-ready-20260626-1234" },
        logPath: "/runs/run-1/fanout-b.log",
        detached: true,
      },
    ]);
  });
});
