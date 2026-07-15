import { buildRunnerV2ExternalLaunchPlan } from "@/lib/runner-v2/launch-plan";

jest.mock("@/lib/config", () => ({
  __esModule: true,
  default: {
    binDir: "/repo/bin",
    codeRoot: "/repo",
    eventsDir: "/project/events",
  },
  ptyDaemonEnv: () => ({ PTY_DAEMON: "mentiko-test", PTY_MANAGER_DIR: "/repo/.pty-manager" }),
}));

jest.mock("@/lib/api/audit-exec", () => ({
  shellEscape: (value: string) => `'${value.replace(/'/g, "'\\''")}'`,
}));

describe("runner-v2 external launch plan", () => {
  it("builds a direct external CLI command with optional flags", () => {
    const plan = buildRunnerV2ExternalLaunchPlan({
      chainPath: "/tmp/run dir/chain.json",
      runDir: "/tmp/run dir",
      runId: "run-1",
      chainId: "test-chain",
      chainName: "Test Chain",
      workspacePath: "/workspace/here",
      taskId: "task-1",
      debug: true,
      logFd: 1,
      cwd: "/repo",
      env: { NODE_ENV: "test" },
    });

    expect(plan).toMatchObject({
      command: "/repo/bin/mentiko",
      cwd: "/repo",
      detached: true,
      mode: "external-cli",
    });
    expect(plan.args).toEqual(["run", "/tmp/run dir/chain.json", "--workspace", "/workspace/here", "--task", "task-1", "--debug"]);
  });

  it("marks the child env as external-cli without dropping caller env", () => {
    const plan = buildRunnerV2ExternalLaunchPlan({
      chainPath: "/tmp/run/chain.json",
      runDir: "/tmp/run",
      runId: "run-2",
      chainId: "test-chain",
      chainName: "Test Chain",
      logFd: 1,
      cwd: "/repo",
      env: { NODE_ENV: "test", MENTIKO_RUN_ID: "run-2" },
    });

    expect(plan.env).toMatchObject({
      NODE_ENV: "test",
      MENTIKO_RUN_ID: "run-2",
      MENTIKO_RUNNER_V2_ACTIVE: "1",
      MENTIKO_RUNNER_V2_MODE: "external-cli",
    });
  });

  it("does not synthesize shell --start routing for external transport", () => {
    const plan = buildRunnerV2ExternalLaunchPlan({
      chainPath: "/tmp/run/chain.json",
      runDir: "/tmp/run",
      runId: "run-3",
      chainId: "test-chain",
      chainName: "Test Chain",
      logFd: 1,
      cwd: "/repo",
      env: { NODE_ENV: "test", MENTIKO_RUN_ID: "run-3" },
    });

    expect(plan.args).not.toContain("--start");
    expect(plan.args).not.toContain("||");
  });
});
