import { buildRunnerV2LaunchPlan } from "@/lib/runner-v2/launch-plan";
import { readFileSync } from "fs";

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

jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  readFileSync: jest.fn(),
}));

const mockReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;

describe("runner-v2 launch plan", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReadFileSync.mockReturnValue(JSON.stringify({
      agents: [{ id: "writer", triggers: [] }],
    }));
  });

  it("builds a typed initial command with optional flags", () => {
    const plan = buildRunnerV2LaunchPlan({
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
      shell: "/bin/zsh",
      cwd: "/repo",
      detached: true,
      mode: "typed-plan",
    });
    expect(plan.args).toEqual([
      "-lc",
      "bash '/repo/lib/chain-runner.sh' '/tmp/run dir/chain.json' --workspace '/workspace/here' --task 'task-1' --debug --start 'writer' || exec '/repo/bin/mentiko' run '/tmp/run dir/chain.json' --workspace '/workspace/here' --task 'task-1' --debug",
    ]);
  });

  it("marks the child env as runner-v2 typed-plan without dropping caller env", () => {
    const plan = buildRunnerV2LaunchPlan({
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
      MENTIKO_RUNNER_V2_MODE: "typed-plan",
    });
  });

  it("prefers the manual-start agent when one is declared", () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      agents: [
        { id: "first", triggers: [] },
        { id: "manual", triggers: ["manual-start"] },
      ],
    }));

    const plan = buildRunnerV2LaunchPlan({
      chainPath: "/tmp/run/chain.json",
      runDir: "/tmp/run",
      runId: "run-3",
      chainId: "test-chain",
      chainName: "Test Chain",
      logFd: 1,
      cwd: "/repo",
      env: { NODE_ENV: "test", MENTIKO_RUN_ID: "run-3" },
    });

    expect(plan.args[1]).toContain("--start 'manual'");
    expect(plan.args[1]).toContain("|| exec '/repo/bin/mentiko' run");
  });

  it("defers scheduled chains to shell schedule semantics", () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      config: { schedule: "*/5 * * * *" },
      agents: [{ id: "writer", triggers: [] }],
    }));

    expect(() => buildRunnerV2LaunchPlan({
      chainPath: "/tmp/run/chain.json",
      runDir: "/tmp/run",
      runId: "run-4",
      chainId: "test-chain",
      chainName: "Test Chain",
      logFd: 1,
      cwd: "/repo",
      env: { NODE_ENV: "test", MENTIKO_RUN_ID: "run-4" },
    })).toThrow("scheduled chains");
  });
});
