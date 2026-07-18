/**
 * @jest-environment node
 */

import { EventEmitter } from "events";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawn, spawnSync, type ChildProcess } from "child_process";
import { isRunnerV2Enabled } from "@/lib/runner-v2/flags";
import { startRunnerV2Launch } from "@/lib/runner-v2/controller";

jest.mock("child_process", () => ({
  ...jest.requireActual("child_process"),
  spawn: jest.fn(() => {
    const child = new EventEmitter() as EventEmitter & { unref: jest.Mock };
    child.unref = jest.fn();
    return child;
  }),
  spawnSync: jest.fn(),
}));

jest.mock("@/lib/config", () => ({
  __esModule: true,
  config: {
    root: "/repo",
    globalRoot: "/tmp/mentiko-global",
  },
  default: {
    binDir: "/repo/bin",
    codeRoot: "/repo",
    globalRoot: "/tmp/mentiko-global",
    get eventsDir() {
      return globalThis.__MENTIKO_CHAIN_RUN_EVENTS_DIR__;
    },
  },
  nsPath: jest.fn((namespaceId: string) => `/tmp/ns/${namespaceId}`),
  orgPath: jest.fn((namespaceId: string, orgId: string) => `/tmp/ns/${namespaceId}/orgs/${orgId}`),
}));

jest.mock("@/lib/api/audit-exec", () => ({
  execAuditLog: jest.fn(() => Promise.resolve()),
  shellEscape: (value: string) => value,
}));

jest.mock("@/lib/auth/auth-bridge", () => ({
  getSessionUser: jest.fn(() => Promise.resolve({ id: "user-1", role: "admin" })),
}));

jest.mock("@/lib/agents/agent-loader", () => ({
  resolveChainAgents: jest.fn((agents) => agents),
}));

jest.mock("@/lib/agents/agent-profile-storage", () => ({
  getProfile: jest.fn(() => null),
  listProfiles: jest.fn(() => []),
}));

jest.mock("@/lib/secrets/secrets-store", () => ({
  getSecretsEnvVars: jest.fn(() => ({})),
  resolveProfileEnvVars: jest.fn(() => ({})),
}));

jest.mock("@/lib/workspaces/workspace-storage", () => ({
  getWorkspace: jest.fn(() => null),
  listWorkspaces: jest.fn(() => []),
}));

jest.mock("@/lib/webhooks/webhook-utils", () => ({
  fireWebhooks: jest.fn(() => Promise.resolve()),
}));

jest.mock("@/lib/system/system-settings", () => ({
  resolveMaxConcurrentChains: jest.fn(() => 0),
}));

jest.mock("@/lib/tasks/task-store", () => ({
  taskMergeMeta: jest.fn(),
  taskUpdate: jest.fn(),
}));

jest.mock("@/lib/notifications/notification-server", () => ({
  createNotification: jest.fn(),
}));

jest.mock("@/lib/runs/child-env", () => ({
  buildChildEnv: jest.fn((env) => env),
}));

jest.mock("@/lib/ai-gateway/local-proxy-env", () => ({
  buildLocalAiGatewayProxyEnv: jest.fn(() => ({})),
}));

jest.mock("@/lib/runner-v2/flags", () => ({
  isRunnerV2Enabled: jest.fn(),
}));

jest.mock("@/lib/runner-v2/controller", () => ({
  startRunnerV2Launch: jest.fn(),
}));

jest.mock("@/lib/auth/workspace-auth", () => ({
  resolveAuthorizedWorkspacePath: jest.fn(() => undefined),
}));

jest.mock("@/lib/links/link-run-runtime", () => ({
  resolveLinkRunsDir: jest.fn(),
}));

jest.mock("@/lib/auth/internal-api-auth", () => ({
  resolveInternalAuthSecret: jest.fn((scope: string) => `secret-${scope}`),
}));

jest.mock("@/lib/auth/session-token", () => ({
  mintSessionToken: jest.fn(() => Promise.resolve("session-token")),
  verifySessionToken: jest.fn(),
}));

jest.mock("@/lib/agents/run-agent-profile", () => ({
  resolveRunAgentProfileId: jest.fn(() => undefined),
}));

jest.mock("@/lib/runs/run-provenance", () => ({
  shouldRecordTaskExecutionMetadata: jest.fn(() => true),
}));

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;
const mockSpawnSync = spawnSync as jest.MockedFunction<typeof spawnSync>;
const mockIsRunnerV2Enabled = isRunnerV2Enabled as jest.MockedFunction<typeof isRunnerV2Enabled>;
const mockStartRunnerV2Launch = startRunnerV2Launch as jest.MockedFunction<typeof startRunnerV2Launch>;
let currentRunsDir = "";

declare global {
  var __MENTIKO_CHAIN_RUN_EVENTS_DIR__: string;
}

async function startMinimalRun(runId: string, metadata?: Record<string, unknown>) {
  const { startChainRun } = await import("@/lib/runs/chain-run-service");
  return startChainRun({
    request: new Request("http://localhost:3000/api/chains/run"),
    namespaceId: "default",
    orgId: "default",
    body: {
      runId,
      chain: {
        id: "test-chain",
        name: "Test Chain",
        description: "test chain",
        version: "1.0.0",
        config: { cli: "codex", monitor: true },
        agents: [{ id: "agent-a", name: "Agent A", prompt: "do it", emits: "done", triggers: ["manual-start"] }],
      },
      userPrompt: "ship it",
      ...(metadata ? { metadata } : {}),
    },
  });
}

describe("chain-run-service runner-v2 guard", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockIsRunnerV2Enabled.mockImplementation((env) => env?.MENTIKO_RUNNER_V2 === "1");
    currentRunsDir = mkdtempSync(join(tmpdir(), "mentiko-runner-v2-runs-"));
    globalThis.__MENTIKO_CHAIN_RUN_EVENTS_DIR__ = join(currentRunsDir, "events");
    const { resolveLinkRunsDir } = await import("@/lib/links/link-run-runtime");
    (resolveLinkRunsDir as jest.MockedFunction<typeof resolveLinkRunsDir>).mockReturnValue(currentRunsDir);
    mockSpawnSync.mockImplementation((_command, args, options) => {
      const runDir = options?.env?.MENTIKO_RUN_DIR;
      const agentId = Array.isArray(args) ? args.at(-1) : undefined;
      if (runDir && agentId) {
        const runJsonPath = join(runDir, "run.json");
        const current = JSON.parse(readFileSync(runJsonPath, "utf8"));
        const session = `probe-${agentId}`;
        const now = new Date().toISOString();
        current.agents = [...(current.agents || []).filter((agent: { id?: string }) => agent.id !== agentId), {
          id: agentId,
          name: agentId,
          session,
          status: "running",
        }];
        current.sessions = [...new Set([...(current.sessions || []), session])];
        current.runnerV2 = {
          ...(current.runnerV2 || {}),
          attempts: [...(current.runnerV2?.attempts || []), {
            id: `attempt-${agentId}`,
            runId: options?.env?.MENTIKO_RUN_ID || current.id,
            agentId,
            phase: "instructions_submitted",
            leaseId: session,
            processEvidence: { processPid: 4321, processSpawnedAt: now, ptySessionId: session },
            instructionLedger: [],
            recoveryDecisionCount: 0,
            createdAt: now,
            updatedAt: now,
            transitions: [],
          }],
        };
        writeFileSync(runJsonPath, JSON.stringify(current));
      }
      return { status: 0, pid: 4321, stdout: "", stderr: "" } as ReturnType<typeof spawnSync>;
    });
    mockStartRunnerV2Launch.mockResolvedValue({ support: "supported", mode: "typed-plan" });
  });

  it("uses the typed launch path even when the retired flag is off", async () => {
    mockIsRunnerV2Enabled.mockReturnValue(false);

    await startMinimalRun("run-flag-off");

    expect(mockStartRunnerV2Launch).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-flag-off",
      cwd: "/repo",
      env: expect.objectContaining({ MENTIKO_RUN_ID: "run-flag-off" }),
    }));
    expect(mockIsRunnerV2Enabled).not.toHaveBeenCalled();
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("fails closed when runner-v2 reports unsupported before any typed side effects", async () => {
    mockStartRunnerV2Launch.mockResolvedValue({
      support: "unsupported",
      reason: "runner-v2 contract must define invariants",
    });

    await expect(startMinimalRun("run-v2-unsupported")).rejects.toThrow("runner-v2 contract must define invariants");

    expect(mockStartRunnerV2Launch).toHaveBeenCalledWith(expect.objectContaining({
      chainName: "Test Chain",
      runId: "run-v2-unsupported",
      cwd: "/repo",
      env: expect.objectContaining({
        MENTIKO_RUN_ID: "run-v2-unsupported",
      }),
    }));
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("uses runner-v2 and avoids fallback shell spawn when the flag is on and supported", async () => {
    const child = new EventEmitter() as EventEmitter & { unref: jest.Mock };
    child.unref = jest.fn();
    mockStartRunnerV2Launch.mockResolvedValue({
      support: "supported",
      mode: "typed-plan",
      child: child as unknown as ChildProcess,
    });

    await startMinimalRun("run-v2-supported");

    expect(mockStartRunnerV2Launch).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-v2-supported",
      chainName: "Test Chain",
      env: expect.objectContaining({
        MENTIKO_RUN_ID: "run-v2-supported",
      }),
    }));
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("does not fallback to shell when typed bootstrap fails", async () => {
    mockStartRunnerV2Launch.mockResolvedValue({
      support: "unsupported",
      reason: "runner-v2 typed bootstrap timed out waiting for agent CLI readiness",
      fallbackAllowed: false,
    });

    await expect(startMinimalRun("run-v2-partial-failure")).rejects.toThrow("runner-v2 typed bootstrap timed out");

    expect(mockStartRunnerV2Launch).toHaveBeenCalled();
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("runs the typed dry-run probe through the service when explicitly requested", async () => {
    const { buildChildEnv } = await import("@/lib/runs/child-env");
    (buildChildEnv as jest.MockedFunction<typeof buildChildEnv>).mockImplementation((env) => ({ ...env, NODE_ENV: "test", MENTIKO_RUNNER_V2: "1" } as ReturnType<typeof buildChildEnv>));
    await startMinimalRun("run-v2-probe", { runnerV2Probe: true });

    expect(mockStartRunnerV2Launch).not.toHaveBeenCalled();
    expect(mockSpawn).not.toHaveBeenCalled();

    const { readFileSync, existsSync } = await import("fs");
    const probePath = join(currentRunsDir, "run-v2-probe", "runner-v2-probe.json");
    expect(existsSync(probePath)).toBe(true);
    expect(JSON.parse(readFileSync(probePath, "utf8"))).toMatchObject({
      status: "ok",
      plan: {
        action: "route",
        launches: [{ kind: "single" }],
      },
      adapter: {
        effectsApplied: ["event-side-effects"],
      },
    });
    expect(JSON.parse(readFileSync(join(currentRunsDir, "run-v2-probe", "run.json"), "utf8"))).toMatchObject({
      status: "completed",
      status_message: "runner-v2 typed dry-run probe completed",
    });
  });

  it("runs the typed live probe through the service only with explicit live metadata", async () => {
    const { buildChildEnv } = await import("@/lib/runs/child-env");
    (buildChildEnv as jest.MockedFunction<typeof buildChildEnv>).mockImplementation((env) => ({ ...env, NODE_ENV: "test", MENTIKO_RUNNER_V2: "1" } as ReturnType<typeof buildChildEnv>));
    await startMinimalRun("run-v2-live-probe", {
      runnerV2Probe: true,
      runnerV2ProbeMode: "live",
    });

    expect(mockStartRunnerV2Launch).not.toHaveBeenCalled();
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(mockSpawnSync).toHaveBeenCalledWith(
      process.execPath,
      [expect.stringMatching(/runner-v2-launch-agent/), expect.any(String), "reviewer"],
      expect.objectContaining({ env: expect.objectContaining({ MENTIKO_RUNNER_V2: "1" }) }),
    );

    const { readFileSync } = await import("fs");
    const probePath = join(currentRunsDir, "run-v2-live-probe", "runner-v2-probe.json");
    expect(JSON.parse(readFileSync(probePath, "utf8"))).toMatchObject({
      status: "ok",
      mode: "live",
      adapter: {
        launchesStarted: [{ command: expect.stringMatching(/runner-v2-launch-agent.*reviewer/) }],
      },
    });
    expect(readFileSync(
      join(globalThis.__MENTIKO_CHAIN_RUN_EVENTS_DIR__, "archive", "run-probe-writer-draft-ready.event"),
      "utf8",
    )).toContain("processed: true");
    expect(JSON.parse(readFileSync(join(currentRunsDir, "run-v2-live-probe", "run.json"), "utf8"))).toMatchObject({
      status: "completed",
      status_message: "runner-v2 typed live probe completed",
    });
  });

  it("runs the typed live probe with external-effects dispatch only when explicitly requested", async () => {
    const { buildChildEnv } = await import("@/lib/runs/child-env");
    (buildChildEnv as jest.MockedFunction<typeof buildChildEnv>).mockImplementation((env) => ({ ...env, NODE_ENV: "test", MENTIKO_RUNNER_V2: "1" } as ReturnType<typeof buildChildEnv>));
    await startMinimalRun("run-v2-live-dispatch-probe", {
      runnerV2Probe: true,
      runnerV2ProbeMode: "live",
      runnerV2DispatchExternalEffects: true,
    });

    const { readFileSync, existsSync } = await import("fs");
    const probeDir = join(currentRunsDir, "run-v2-live-dispatch-probe", "runner-v2-probe");
    const probePath = join(currentRunsDir, "run-v2-live-dispatch-probe", "runner-v2-probe.json");
    expect(JSON.parse(readFileSync(probePath, "utf8"))).toMatchObject({
      status: "ok",
      mode: "live",
      externalDispatch: {
        dispatched: 3,
        failed: 0,
      },
    });
    expect(existsSync(join(probeDir, "external-effects.jsonl"))).toBe(true);
    expect(readFileSync(join(probeDir, "external-effects.dispatch.jsonl"), "utf8")).toContain("\"status\":\"dispatched\"");
  });
});
