/**
 * @jest-environment node
 *
 * Issue #142 round 4 (review P1-2): a task-linked run replacement must
 * serialize its task re-point against a live resume of the OLD run. The
 * service takes the old run's .resume-claim BEFORE launching the replacement
 * and holds it across launch + re-point; a claim busy past the wait budget
 * fails visibly with a retryable error and starts nothing. Real sqlite task
 * store; the launch itself is mocked at the controller seam.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// jest hoists mock factories above const initializers, so the shared test
// root is minted inside the config factory and read back afterwards.
jest.mock("@/lib/config", () => {
  const root = require("node:path").join("/tmp", `mentiko-repoint-142-${require("node:crypto").randomUUID()}`);
  (globalThis as Record<string, unknown>).__REPOINT_TEST_ROOT = root;
  return {
    __esModule: true,
    default: {
      namespaceId: "default",
      orgId: "default",
      runsDir: require("node:path").join(root, "runs"),
      eventsDir: require("node:path").join(root, "events"),
      globalRoot: root,
      codeRoot: require("node:path").join(root, "code"),
    },
    nsPath: (ns: string) => require("node:path").join(root, "namespaces", ns),
    orgPath: (ns: string, org: string, ...rest: string[]) =>
      require("node:path").join(root, "namespaces", ns, org, ...rest),
  };
});

jest.mock("@/lib/auth/auth-bridge", () => ({
  getSessionUser: async () => ({ id: "user-1", namespaceId: "default", orgId: "default", role: "member" }),
}));

jest.mock("@/lib/runner-v2/controller", () => ({
  startRunnerV2Launch: (...args: unknown[]) => mockStartRunnerV2Launch(...(args as [])),
}));

jest.mock("@/lib/webhooks/webhook-utils", () => ({ fireWebhooks: async () => undefined }));
jest.mock("@/lib/notifications/notification-server", () => ({ createNotification: () => undefined }));
jest.mock("@/lib/api/audit-exec", () => ({ execAuditLog: async () => undefined }));
jest.mock("@/lib/agents/agent-profile-storage", () => ({
  listProfiles: () => [],
  getProfile: () => null,
}));
jest.mock("@/lib/agents/agent-loader", () => ({
  resolveChainAgents: (agents: unknown[]) => agents,
}));
jest.mock("@/lib/chains/generated-chain-acceptance", () => ({
  verifyAcceptedManifest: () => ({ state: "none" }),
}));
jest.mock("@/lib/secrets/secrets-store", () => ({
  getSecretsEnvVars: () => ({}),
  resolveProfileEnvVars: () => ({}),
}));
jest.mock("@/lib/auth/internal-api-auth", () => ({ resolveInternalAuthSecret: () => "test-secret" }));
jest.mock("@/lib/auth/session-token", () => ({ mintSessionToken: async () => "test-token" }));
jest.mock("@/lib/system/system-settings", () => ({ resolveMaxConcurrentChains: () => 0 }));
jest.mock("@/lib/generation/generation-job-identity", () => ({ mintAdHocGenerationJobIdentity: () => undefined }));
jest.mock("@/lib/auth/workspace-auth", () => ({ resolveAuthorizedWorkspacePath: () => undefined }));
jest.mock("@/lib/workspaces/workspace-storage", () => ({
  getWorkspace: () => null,
  listWorkspaces: () => [],
}));
jest.mock("@/lib/ai-gateway/local-proxy-env", () => ({ buildLocalAiGatewayProxyEnv: () => ({}) }));
jest.mock("@/lib/runner-v2/probe", () => ({
  runSyntheticRunnerV2Probe: () => ({}),
  runSyntheticRunnerV2ProbeWithDispatch: () => ({}),
}));

import { startChainRun } from "@/lib/runs/chain-run-service";
import {
  acquireExclusiveFileClaim,
  ExclusiveFileClaimBusyError,
} from "@/lib/runner-v2/file-claim";
import { closeAll, taskCreate, taskGet } from "@/lib/tasks/task-store";

const mockStartRunnerV2Launch = jest.fn(async () => ({ support: "started" }));

const TEST_ROOT = (globalThis as Record<string, unknown>).__REPOINT_TEST_ROOT as string;
const RUNS = join(TEST_ROOT, "runs");

const chain = {
  id: "repoint-probe",
  name: "Repoint Probe",
  description: "Serialization probe chain.",
  version: "1.0.0",
  config: { cli: "claude", monitor: false },
  agents: [{
    id: "worker",
    name: "Worker",
    prompt: "Do the work.",
    triggers: ["manual-start"],
    emits: "done",
  }],
};

function seedOldRunWithClaimHolder(): { taskId: string; release: () => void } {
  const oldRunDir = join(RUNS, "run-old");
  mkdirSync(oldRunDir, { recursive: true });
  writeFileSync(join(oldRunDir, "run.json"), JSON.stringify({
    id: "run-old", chain: "Repoint Probe", goal: "g",
    started: new Date().toISOString(), status: "stopped", agents: [],
  }));
  const release = acquireExclusiveFileClaim(join(oldRunDir, ".resume-claim"), {});
  const task = taskCreate("default", {
    title: "repoint probe",
    issue_type: "task",
    metadata: { last_run_id: "run-old", last_run_status: "stopped" },
  }, "default");
  return { taskId: task.id, release };
}

function callStart(taskId: string, runId: string): Promise<unknown> {
  return startChainRun({
    request: new Request("http://localhost:3200/api/chains/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chain, taskId, runId }),
    }),
    namespaceId: "default",
    orgId: "default",
    body: { chain, taskId, runId },
  });
}

beforeEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  mkdirSync(RUNS, { recursive: true });
  mockStartRunnerV2Launch.mockClear();
});

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  closeAll();
});

jest.setTimeout(60_000);

describe("startChainRun task re-point serialization (#142 round 4)", () => {
  it("a claim held past the wait: nothing starts, the caller gets the retryable error, the task keeps the old run", async () => {
    const { taskId, release } = seedOldRunWithClaimHolder();
    try {
      await expect(callStart(taskId, "run-new-conflict")).rejects.toThrow(/resume is in progress/i);

      // nothing was launched and no new run is left running
      expect(mockStartRunnerV2Launch).not.toHaveBeenCalled();
      const newRun = JSON.parse(readFileSync(join(RUNS, "run-new-conflict", "run.json"), "utf8"));
      expect(newRun.status).toBe("failed");
      expect(newRun.status_message).toContain("resume is in progress");

      // the task still points at the old run
      const task = taskGet("default", taskId, "default")!;
      expect((task.metadata as Record<string, unknown>).last_run_id).toBe("run-old");
    } finally {
      release();
    }
  });

  it("a free claim: the service holds it across launch AND re-point, then releases", async () => {
    const oldRunDir = join(RUNS, "run-old");
    mkdirSync(oldRunDir, { recursive: true });
    const task = taskCreate("default", {
      title: "repoint probe free",
      issue_type: "task",
      metadata: { last_run_id: "run-old", last_run_status: "stopped" },
    }, "default");

    // seam: while the launch is in flight, the old run's claim must already be
    // held by the service — a concurrent acquire fails busy
    let claimHeldDuringLaunch = false;
    mockStartRunnerV2Launch.mockImplementationOnce(async () => {
      try {
        acquireExclusiveFileClaim(join(oldRunDir, ".resume-claim"), { waitTimeoutMs: 50 });
      } catch (error) {
        claimHeldDuringLaunch = error instanceof ExclusiveFileClaimBusyError;
      }
      return { support: "started" };
    });

    const result = await callStart(task.id, "run-new-free") as { runId: string; status: string };

    expect(result.status).toBe("started");
    expect(mockStartRunnerV2Launch).toHaveBeenCalledTimes(1);
    expect(claimHeldDuringLaunch).toBe(true);
    // the re-point landed inside the claim
    const after = taskGet("default", task.id, "default")!;
    expect(after.status).toBe("in_progress");
    expect((after.metadata as Record<string, unknown>).last_run_id).toBe("run-new-free");
    // and the claim was released afterwards
    const release = acquireExclusiveFileClaim(join(oldRunDir, ".resume-claim"), { waitTimeoutMs: 50 });
    release();
  });
});
