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

import { runTypedDirect, parseDirectRunArgs } from "@/lib/runner-v2/direct-run";

describe("typed direct run arguments", () => {
  it("accepts only one local initial agent with optional workspace and debug", () => {
    expect(parseDirectRunArgs(["chain.json", "--workspace", "/tmp/work", "--start", "first", "--debug"])).toMatchObject({
      chainPath: expect.stringMatching(/chain\.json$/), workspacePath: "/tmp/work", agentId: "first", debug: true,
    });
  });

  it.each(["--task", "--parallel", "--dry-run"])("rejects legacy shell-only mode %s", (flag) => {
    expect(() => parseDirectRunArgs(["chain.json", flag, "value"])).toThrow("not supported by typed direct run");
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
});
