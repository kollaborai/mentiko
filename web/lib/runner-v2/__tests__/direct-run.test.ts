import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TextEncoder } from "node:util";

// jsdom lacks TextEncoder; session-token.ts needs it at mint time.
Object.defineProperty(globalThis, "TextEncoder", { value: TextEncoder, configurable: true });

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

// jose v6 is ESM-only; jest (CJS) cannot load it. Use the crypto-backed HS256
// mirror so mintSessionToken really signs and verification fails on secret
// mismatches, instead of a mock that hides mint failures.
jest.mock("jose", () => require("./helpers/functional-jose"));

import { runTypedDirect, parseDirectRunArgs } from "@/lib/runner-v2/direct-run";
import { startRunnerV2Bootstrap } from "@/lib/runner-v2/bootstrap-executor";

// resolveAppSecret reads process.env, and lib/secrets/dev-secret caches its
// fallback per module instance. Pinning BETTER_AUTH_SECRET before any mint
// makes every token in this file sign deterministically regardless of cache
// state or the host's ~/.mentiko dev secret.
const previousAuthSecret = process.env.BETTER_AUTH_SECRET;
const previousSecretKey = process.env.SECRET_KEY;
const previousNodeEnv = process.env.NODE_ENV;
beforeAll(() => {
  process.env.BETTER_AUTH_SECRET = "direct-run-test-secret";
});
afterAll(() => {
  if (previousAuthSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
  else process.env.BETTER_AUTH_SECRET = previousAuthSecret;
  if (previousSecretKey !== undefined) process.env.SECRET_KEY = previousSecretKey;
  Object.defineProperty(process.env, "NODE_ENV", { value: previousNodeEnv, configurable: true, writable: true });
});

describe("typed direct run arguments", () => {
  // The CLI checks its minted token against the web app before launching;
  // stand in for an accepting web app.
  // (The Jest environment may lack fetch, so it is assigned, not spied.)
  const originalFetch = globalThis.fetch;
  let webTokenCheck: jest.Mock;
  beforeEach(() => {
    webTokenCheck = jest.fn().mockResolvedValue({ status: 200 });
    globalThis.fetch = webTokenCheck as unknown as typeof fetch;
  });
  afterEach(() => { globalThis.fetch = originalFetch; });
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
        env: { NODE_ENV: "test", MENTIKO_WEB_URL: "http://127.0.0.1:3100" },
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
        env: { NODE_ENV: "test", MENTIKO_WEB_URL: "http://127.0.0.1:3100" },
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
        env: { NODE_ENV: "test", MENTIKO_WEB_URL: "http://127.0.0.1:3100" },
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

  it("mints an ops session token for CLI launches without one", async () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-direct-token-"));
    const runsDir = join(root, "runs");
    try {
      const result = await runTypedDirect({
        chainPath: join(root, "chain.json"), runsDir, runId: "run-cli-token", debug: false,
        env: { NODE_ENV: "test", NAMESPACE_ID: "ns-1", ORG_ID: "org-1", MENTIKO_WEB_URL: "http://127.0.0.1:3100" },
      });
      if (result.dryRun) throw new Error("unexpected dry run");
      const launchEnv = (startRunnerV2Bootstrap as jest.Mock).mock.calls.at(-1)![0].env as Record<string, string>;
      expect(launchEnv.MENTIKO_SESSION_ID).toBe("chain-run-cli-token");
      expect(typeof launchEnv.MENTIKO_SESSION_TOKEN).toBe("string");
      const [, payload] = launchEnv.MENTIKO_SESSION_TOKEN.split(".");
      expect(JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))).toMatchObject({
        sub: "cli",
        jti: "chain-run-cli-token",
        ns: "ns-1",
        org: "org-1",
        scopes: ["ops:*"],
      });
      expect(launchEnv.MENTIKO_WEB_URL).toBe("http://127.0.0.1:3100");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("marks the run failed and never launches when no secret can mint the token", async () => {
    const bootstrapCalls = (startRunnerV2Bootstrap as jest.Mock).mock.calls.length;
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.SECRET_KEY;
    Object.defineProperty(process.env, "NODE_ENV", { value: "production", configurable: true, writable: true });
    const root = mkdtempSync(join(tmpdir(), "mentiko-direct-mint-fail-"));
    const runsDir = join(root, "runs");
    try {
      await expect(runTypedDirect({
        chainPath: join(root, "chain.json"), runsDir, runId: "run-mint-fail", debug: false,
        env: { NODE_ENV: "production", MENTIKO_WEB_URL: "http://127.0.0.1:3100" },
      })).rejects.toThrow("cli session token setup failed");
      expect((startRunnerV2Bootstrap as jest.Mock).mock.calls.length).toBe(bootstrapCalls);
      const runState = JSON.parse(readFileSync(join(runsDir, "run-mint-fail", "run.json"), "utf8"));
      expect(runState.status).toBe("failed");
      expect(runState.statusReason).toMatchObject({ actor: "system" });
      expect(runState.statusReason.reason).toContain("BETTER_AUTH_SECRET is required in production");
    } finally {
      rmSync(root, { recursive: true, force: true });
      process.env.BETTER_AUTH_SECRET = "direct-run-test-secret";
      Object.defineProperty(process.env, "NODE_ENV", { value: "test", configurable: true, writable: true });
    }
  });

  it("marks the run failed and never launches when the web app rejects the CLI token", async () => {
    const bootstrapCalls = (startRunnerV2Bootstrap as jest.Mock).mock.calls.length;
    webTokenCheck.mockResolvedValue({ status: 401 });
    const root = mkdtempSync(join(tmpdir(), "mentiko-direct-token-rejected-"));
    const runsDir = join(root, "runs");
    try {
      await expect(runTypedDirect({
        chainPath: join(root, "chain.json"), runsDir, runId: "run-token-rejected", debug: false,
        env: { NODE_ENV: "test", MENTIKO_WEB_URL: "http://127.0.0.1:3100" },
      })).rejects.toThrow("rejected the CLI session token (HTTP 401)");
      expect(webTokenCheck.mock.calls[0][0]).toBe("http://127.0.0.1:3100/api/mentiko-mcp/ops/monitor/status");
      expect((startRunnerV2Bootstrap as jest.Mock).mock.calls.length).toBe(bootstrapCalls);
      const runState = JSON.parse(readFileSync(join(runsDir, "run-token-rejected", "run.json"), "utf8"));
      expect(runState.status).toBe("failed");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("never overrides a caller-provided session token context", async () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-direct-token-kept-"));
    const runsDir = join(root, "runs");
    try {
      await runTypedDirect({
        chainPath: join(root, "chain.json"), runsDir, runId: "run-cli-token-kept", debug: false,
        env: { NODE_ENV: "test", MENTIKO_SESSION_TOKEN: "caller-token", MENTIKO_SESSION_ID: "caller-session", MENTIKO_WEB_URL: "http://caller" },
      });
      const launchEnv = (startRunnerV2Bootstrap as jest.Mock).mock.calls.at(-1)![0].env as Record<string, string>;
      expect(launchEnv.MENTIKO_SESSION_TOKEN).toBe("caller-token");
      expect(launchEnv.MENTIKO_SESSION_ID).toBe("caller-session");
      expect(launchEnv.MENTIKO_WEB_URL).toBe("http://caller");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
