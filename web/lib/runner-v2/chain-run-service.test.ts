/**
 * @jest-environment node
 */

import { EventEmitter } from "events";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawn, type ChildProcess } from "child_process";
import { isRunnerV2Enabled } from "@/lib/runner-v2/flags";
import { startRunnerV2Launch } from "@/lib/runner-v2/controller";

jest.mock("child_process", () => ({
  ...jest.requireActual("child_process"),
  spawn: jest.fn(() => {
    const child = new EventEmitter() as EventEmitter & { unref: jest.Mock };
    child.unref = jest.fn();
    return child;
  }),
}));

jest.mock("@/lib/config", () => ({
  __esModule: true,
  default: {
    binDir: "/repo/bin",
    codeRoot: "/repo",
    globalRoot: "/tmp/mentiko-global",
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
const mockIsRunnerV2Enabled = isRunnerV2Enabled as jest.MockedFunction<typeof isRunnerV2Enabled>;
const mockStartRunnerV2Launch = startRunnerV2Launch as jest.MockedFunction<typeof startRunnerV2Launch>;
let currentRunsDir = "";

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
        agents: [{ id: "agent-a", name: "Agent A", prompt: "do it", emits: "done", triggers: [] }],
      },
      userPrompt: "ship it",
      ...(metadata ? { metadata } : {}),
    },
  });
}

describe("chain-run-service runner-v2 guard", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    currentRunsDir = mkdtempSync(join(tmpdir(), "mentiko-runner-v2-runs-"));
    const { resolveLinkRunsDir } = await import("@/lib/links/link-run-runtime");
    (resolveLinkRunsDir as jest.MockedFunction<typeof resolveLinkRunsDir>).mockReturnValue(currentRunsDir);
  });

  it("uses the normal shell path and never calls runner-v2 when the flag is off", async () => {
    mockIsRunnerV2Enabled.mockReturnValue(false);

    await startMinimalRun("run-flag-off");

    expect(mockStartRunnerV2Launch).not.toHaveBeenCalled();
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(mockSpawn).toHaveBeenCalledWith(
      "/bin/zsh",
      ["-lc", expect.stringContaining("/repo/bin/mentiko run")],
      expect.objectContaining({
        cwd: "/repo",
        detached: true,
        env: expect.objectContaining({
          MENTIKO_RUN_ID: "run-flag-off",
          NAMESPACE_ID: "default",
          ORG_ID: "default",
        }),
      }),
    );
  });

  it("falls back to the normal shell path when runner-v2 reports unsupported", async () => {
    mockIsRunnerV2Enabled.mockReturnValue(true);
    mockStartRunnerV2Launch.mockResolvedValue({
      support: "unsupported",
      reason: "runner-v2 contract must define invariants",
    });

    await startMinimalRun("run-v2-unsupported");

    expect(mockStartRunnerV2Launch).toHaveBeenCalledWith(expect.objectContaining({
      chainName: "Test Chain",
      runId: "run-v2-unsupported",
      cwd: "/repo",
      env: expect.objectContaining({
        MENTIKO_RUN_ID: "run-v2-unsupported",
      }),
    }));
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(mockSpawn).toHaveBeenCalledWith(
      "/bin/zsh",
      ["-lc", expect.stringContaining("/repo/bin/mentiko run")],
      expect.objectContaining({ cwd: "/repo", detached: true }),
    );
  });

  it("uses runner-v2 and avoids fallback shell spawn when the flag is on and supported", async () => {
    const child = new EventEmitter() as EventEmitter & { unref: jest.Mock };
    child.unref = jest.fn();
    mockIsRunnerV2Enabled.mockReturnValue(true);
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

  it("does not fallback to shell when runner-v2 fails after mutating typed bootstrap", async () => {
    mockIsRunnerV2Enabled.mockReturnValue(true);
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
    mockIsRunnerV2Enabled.mockReturnValue(true);

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
    mockIsRunnerV2Enabled.mockReturnValue(true);

    await startMinimalRun("run-v2-live-probe", {
      runnerV2Probe: true,
      runnerV2ProbeMode: "live",
    });

    expect(mockStartRunnerV2Launch).not.toHaveBeenCalled();
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(mockSpawn).toHaveBeenCalledWith(
      "/bin/bash",
      ["-lc", expect.stringContaining("--start reviewer")],
      expect.objectContaining({ detached: false }),
    );

    const { readFileSync } = await import("fs");
    const probePath = join(currentRunsDir, "run-v2-live-probe", "runner-v2-probe.json");
    expect(JSON.parse(readFileSync(probePath, "utf8"))).toMatchObject({
      status: "ok",
      mode: "live",
      adapter: {
        launchesStarted: [{ command: expect.stringContaining("--start reviewer") }],
      },
    });
    expect(readFileSync(
      join(currentRunsDir, "run-v2-live-probe", "runner-v2-probe", "events", "run-probe-writer-draft-ready.event"),
      "utf8",
    )).toContain("processed: true");
    expect(JSON.parse(readFileSync(join(currentRunsDir, "run-v2-live-probe", "run.json"), "utf8"))).toMatchObject({
      status: "completed",
      status_message: "runner-v2 typed live probe completed",
    });
  });

  it("runs the typed live probe with external-effects dispatch only when explicitly requested", async () => {
    mockIsRunnerV2Enabled.mockReturnValue(true);

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
