import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

jest.mock("@/lib/config", () => ({
  __esModule: true,
  default: { agentsDir: "/typed-agents", runsDir: "/unused-runs" },
}));
jest.mock("@/lib/runner-v2/chain-validation-cli", () => ({
  validateChainFile: jest.fn(() => ({ errors: [] })),
}));
jest.mock("@/lib/runner-v2/chain-contract", () => ({
  loadNormalizedChainDefinition: jest.fn(() => ({
    id: "typed-chain",
    name: "Typed Chain",
    description: "chain default goal",
    config: { workspace: { type: "local" } },
    agents: [{ id: "first", name: "First", triggers: ["manual-start"] }],
  })),
}));
jest.mock("@/lib/runner-v2/bootstrap-executor", () => ({
  startRunnerV2Bootstrap: jest.fn(async () => ({ support: "supported", mode: "typed-plan" })),
}));
jest.mock("@/lib/runner-v2/task-context", () => ({
  loadTaskContext: jest.fn(async ({ taskId }: { taskId: string }) => ({
    task: { id: taskId, title: "Typed task", description: "Do the work", type: "task", priority: "2", acceptanceCriteria: "Prove it", design: "", notes: "" },
    comments: [], context: `TASK ID: ${taskId}\nTITLE: Typed task`,
  })),
  taskContextEnvironment: jest.fn((result: { task: { id: string }; context: string }) => ({ TASK_ID: result.task.id, TASK_CONTEXT: result.context })),
}));

import { runTypedDirect, parseDirectRunArgs } from "@/lib/runner-v2/direct-run";
import { startRunnerV2Bootstrap } from "@/lib/runner-v2/bootstrap-executor";

describe("typed direct run arguments", () => {
  it("accepts only one local initial agent with optional workspace and debug", () => {
    expect(parseDirectRunArgs(["chain.json", "--workspace", "/tmp/work", "--start", "first", "--debug"])).toMatchObject({
      chainPath: expect.stringMatching(/chain\.json$/), workspacePath: "/tmp/work", agentId: "first", debug: true,
    });
  });

  it("parses task association and dry-run as typed direct modes", () => {
    expect(parseDirectRunArgs(["chain.json", "--task", "TASK-12", "--dry-run"])).toMatchObject({
      taskId: "TASK-12", dryRun: true,
    });
  });

  it("retires raw parallel process fan-out", () => {
    expect(() => parseDirectRunArgs(["chain.json", "--parallel", "writer"])).toThrow("--parallel was retired");
  });

  it("rejects missing values, unknown flags, and multiple chain files", () => {
    expect(() => parseDirectRunArgs(["chain.json", "--workspace"])).toThrow("requires a value");
    expect(() => parseDirectRunArgs(["chain.json", "--unknown"])).toThrow("unsupported mentiko run option");
    expect(() => parseDirectRunArgs(["one.json", "two.json"])).toThrow("unexpected positional argument");
  });

  it("reserves an internal run id and batch goal without replacing an existing run", async () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-direct-run-"));
    const runsDir = join(root, "runs");
    try {
      const result = await runTypedDirect({
        chainPath: join(root, "batch-snapshot.json"),
        runsDir,
        runId: "run-reserved-batch",
        goal: "batch invocation goal",
        debug: false,
      });
      expect(result).toMatchObject({ runId: "run-reserved-batch", runDir: join(realpathSync(runsDir), "run-reserved-batch") });
      expect(JSON.parse(readFileSync(join(runsDir, "run-reserved-batch", "run.json"), "utf8"))).toMatchObject({
        id: "run-reserved-batch",
        goal: "batch invocation goal",
        chain: "Typed Chain",
      });
      expect(existsSync(join(runsDir, "run-reserved-batch", "chain.json"))).toBe(true);
      await expect(runTypedDirect({
        chainPath: join(root, "batch-snapshot.json"),
        runsDir,
        runId: "run-reserved-batch",
        goal: "replacement attempt",
        debug: false,
      })).rejects.toThrow("EEXIST");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("persists typed task association on a launched direct run", async () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-direct-task-"));
    const runsDir = join(root, "runs");
    try {
      const result = await runTypedDirect({
        chainPath: join(root, "task-chain.json"), runsDir, runId: "run-task-bound", taskId: "TASK-12", debug: false,
      });
      if (result.dryRun) throw new Error("unexpected dry run");
      expect(JSON.parse(readFileSync(join(runsDir, result.runId, "run.json"), "utf8"))).toMatchObject({ taskId: "TASK-12" });
      expect(startRunnerV2Bootstrap).toHaveBeenLastCalledWith(expect.objectContaining({
        taskId: "TASK-12",
        env: expect.objectContaining({ TASK_ID: "TASK-12", TASK_CONTEXT: "TASK ID: TASK-12\nTITLE: Typed task" }),
      }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("validates dry-run without creating a run directory or bootstrap PTY", async () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-direct-dry-run-"));
    const runsDir = join(root, "runs");
    try {
      const result = await runTypedDirect({
        chainPath: join(root, "chain.json"), runsDir, taskId: "TASK-12", dryRun: true, debug: false,
      });
      expect(result).toMatchObject({ dryRun: true, chainName: "Typed Chain", agentId: "first" });
      expect(existsSync(runsDir)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
