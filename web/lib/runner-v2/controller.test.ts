import { getRunnerV2TypedExecutorSupport, startRunnerV2Launch } from "@/lib/runner-v2/controller";
import { startRunnerV2Bootstrap } from "@/lib/runner-v2/bootstrap-executor";
import { loadRunnerV2Contract } from "@/lib/runner-v2/contracts";
import { spawn } from "child_process";
import { readFileSync } from "fs";

jest.mock("child_process", () => ({
  ...jest.requireActual("child_process"),
  spawn: jest.fn(() => ({ unref: jest.fn() })),
}));

jest.mock("@/lib/runner-v2/contracts", () => ({
  loadRunnerV2Contract: jest.fn(),
}));

jest.mock("@/lib/runner-v2/bootstrap-executor", () => ({
  startRunnerV2Bootstrap: jest.fn(),
}));

jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  readFileSync: jest.fn(),
}));

const mockLoadContract = loadRunnerV2Contract as jest.MockedFunction<typeof loadRunnerV2Contract>;
const mockStartBootstrap = startRunnerV2Bootstrap as jest.MockedFunction<typeof startRunnerV2Bootstrap>;
const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;
const mockReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;

function launchContext() {
  return {
    chainPath: "/tmp/run/chain.json",
    runDir: "/tmp/run",
    runId: "run-1",
    chainName: "Test Chain",
    logFd: 1,
    cwd: "/repo",
    env: { NODE_ENV: "test" as const, PATH: "/bin" },
  };
}

describe("runner-v2 controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReadFileSync.mockReturnValue(JSON.stringify({
      agents: [{ id: "writer", triggers: [] }],
    }));
  });

  it("starts typed bootstrap without spawning shell --start while the contract keeps shell as default", async () => {
    mockLoadContract.mockReturnValue({
      schema_version: "runner-contract/v1",
      migration_mode: "side-by-side",
      default_runner: "shell",
      flag: {
        name: "MENTIKO_RUNNER_V2",
        enabled_values: ["1"],
        default: "off",
        scope: "test",
      },
      invariants: ["default shell behavior remains unchanged"],
    });

    mockStartBootstrap.mockResolvedValue({
      support: "supported",
      mode: "typed-plan",
      sessionName: "workspace-writer-run-1",
    });

    const result = await startRunnerV2Launch(launchContext());

    expect(result.support).toBe("supported");
    if (result.support === "supported") {
      expect(result.mode).toBe("typed-plan");
      expect(result.sessionName).toBe("workspace-writer-run-1");
    }
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("returns unsupported when typed bootstrap cannot resolve an agent", async () => {
    mockLoadContract.mockReturnValue({
      schema_version: "runner-contract/v1",
      migration_mode: "side-by-side",
      default_runner: "shell",
      flag: {
        name: "MENTIKO_RUNNER_V2",
        enabled_values: ["1"],
        default: "off",
        scope: "test",
      },
      invariants: ["default shell behavior remains unchanged"],
    });
    mockStartBootstrap.mockResolvedValue({
      support: "unsupported",
      reason: "runner-v2 bootstrap requires an agent id",
      fallbackAllowed: false,
    });

    await expect(startRunnerV2Launch(launchContext())).resolves.toEqual({
      support: "unsupported",
      reason: "runner-v2 bootstrap requires an agent id",
      fallbackAllowed: false,
    });
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("falls back unsupported when contract validation/loading fails", async () => {
    mockLoadContract.mockImplementation(() => {
      throw new Error("runner-v2 contract must define invariants");
    });

    await expect(startRunnerV2Launch(launchContext())).resolves.toEqual({
      support: "unsupported",
      reason: "runner-v2 contract must define invariants",
    });
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("refuses to run if the contract tries to change the default runner", async () => {
    mockLoadContract.mockReturnValue({
      schema_version: "runner-contract/v1",
      migration_mode: "side-by-side",
      default_runner: "runner-v2" as "shell",
      flag: {
        name: "MENTIKO_RUNNER_V2",
        enabled_values: ["1"],
        default: "off",
        scope: "test",
      },
      invariants: ["default shell behavior remains unchanged"],
    });

    await expect(startRunnerV2Launch(launchContext())).resolves.toEqual({
      support: "unsupported",
      reason: "contract changed default runner before parity gate",
    });
  });

  it("keeps shell fallback only for non-local transports while parity is incomplete", async () => {
    mockLoadContract.mockReturnValue({
      schema_version: "runner-contract/v1",
      migration_mode: "side-by-side",
      default_runner: "shell",
      flag: {
        name: "MENTIKO_RUNNER_V2",
        enabled_values: ["1"],
        default: "off",
        scope: "test",
      },
      invariants: ["default shell behavior remains unchanged"],
    });
    mockStartBootstrap.mockResolvedValue({
      support: "unsupported",
      reason: "runner-v2 typed bootstrap only supports local workspaces, got ssh",
      fallbackAllowed: true,
    });

    const result = await startRunnerV2Launch(launchContext());

    expect(result.support).toBe("supported");
    expect(mockSpawn).toHaveBeenCalledWith(
      "/bin/zsh",
      ["-lc", expect.stringContaining(" --start 'writer'")],
      expect.objectContaining({ cwd: "/repo", detached: true }),
    );
  });

  it("does not shell fallback when typed bootstrap reports a partial mutation failure", async () => {
    mockLoadContract.mockReturnValue({
      schema_version: "runner-contract/v1",
      migration_mode: "side-by-side",
      default_runner: "shell",
      flag: {
        name: "MENTIKO_RUNNER_V2",
        enabled_values: ["1"],
        default: "off",
        scope: "test",
      },
      invariants: ["default shell behavior remains unchanged"],
    });
    mockStartBootstrap.mockResolvedValue({
      support: "unsupported",
      reason: "runner-v2 typed bootstrap timed out waiting for agent CLI readiness",
      fallbackAllowed: false,
    });

    await expect(startRunnerV2Launch(launchContext())).resolves.toEqual({
      support: "unsupported",
      reason: "runner-v2 typed bootstrap timed out waiting for agent CLI readiness",
      fallbackAllowed: false,
    });
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("exposes typed-plan support without spawning shell-compat", () => {
    mockLoadContract.mockReturnValue({
      schema_version: "runner-contract/v1",
      migration_mode: "side-by-side",
      default_runner: "shell",
      flag: {
        name: "MENTIKO_RUNNER_V2",
        enabled_values: ["1"],
        default: "off",
        scope: "test",
      },
      invariants: ["default shell behavior remains unchanged"],
    });

    expect(getRunnerV2TypedExecutorSupport()).toEqual({
      support: "supported",
      mode: "typed-plan",
    });
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("blocks typed-plan support if the contract default drifts", () => {
    mockLoadContract.mockReturnValue({
      schema_version: "runner-contract/v1",
      migration_mode: "side-by-side",
      default_runner: "runner-v2" as "shell",
      flag: {
        name: "MENTIKO_RUNNER_V2",
        enabled_values: ["1"],
        default: "off",
        scope: "test",
      },
      invariants: ["default shell behavior remains unchanged"],
    });

    expect(getRunnerV2TypedExecutorSupport()).toEqual({
      support: "unsupported",
      reason: "typed executor cannot run after default runner contract drift",
    });
  });
});
