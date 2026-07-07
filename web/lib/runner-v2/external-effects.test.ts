import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execFile } from "child_process";
import {
  dispatchExternalEffects,
  drainExternalEffectsOutbox,
  drainRunnerV2ExternalEffects,
} from "@/lib/runner-v2/external-effects";
import { fireWebhooks } from "@/lib/webhooks/webhook-utils";
import { postOutboundWebhook } from "@/lib/webhooks/outbound-webhook-delivery";
import { createNotification } from "@/lib/notifications/notification-server";
import { taskGet, taskMergeMeta, taskUpdate } from "@/lib/tasks/task-store";

jest.mock("@/lib/webhooks/webhook-utils", () => ({
  fireWebhooks: jest.fn(() => Promise.resolve()),
}));

jest.mock("@/lib/webhooks/outbound-webhook-delivery", () => ({
  postOutboundWebhook: jest.fn(() => Promise.resolve({ statusCode: 200 })),
}));

jest.mock("@/lib/notifications/notification-server", () => ({
  createNotification: jest.fn(),
}));

jest.mock("@/lib/tasks/task-store", () => ({
  taskGet: jest.fn(() => ({ id: "TASK-1", status: "in_progress" })),
  taskMergeMeta: jest.fn(),
  taskUpdate: jest.fn(),
}));

jest.mock("child_process", () => ({
  ...jest.requireActual("child_process"),
  execFile: jest.fn((_cmd: string, _args: string[], _opts: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
    callback(null, "", "");
  }),
}));

function tempDir() {
  return mkdtempSync(join(tmpdir(), "runner-v2-external-effects-"));
}

function writeOutbox(dir: string, records: unknown[]) {
  const path = join(dir, "external-effects.jsonl");
  writeFileSync(path, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
  return path;
}

describe("runner-v2 external effects dispatcher", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("dispatches supported notification and metadata webhook records", async () => {
    const dir = tempDir();
    const outboxPath = writeOutbox(dir, [
      {
        type: "notification",
        status: "queued",
        operation: { type: "notification", event: "chain-completed", chainName: "Build Chain", runId: "run-123", agentId: "writer" },
      },
      {
        type: "metadata-webhooks",
        status: "queued",
        operation: {
          type: "metadata-webhooks",
          event: "completed",
          chainId: "build-chain",
          chainPath: "/data/runs/run-123/chain.json",
          chainName: "Build Chain",
          runId: "run-123",
        },
      },
    ]);

    const result = await dispatchExternalEffects({
      outboxPath,
      namespaceId: "default",
      orgId: "default",
    });

    expect(createNotification).toHaveBeenCalledWith("default", expect.objectContaining({
      type: "chain_complete",
      metadata: expect.objectContaining({ chainId: "Build Chain", runId: "run-123", agentId: "writer" }),
    }));
    expect(fireWebhooks).toHaveBeenCalledWith("default", "default", "build-chain", "completed", { runId: "run-123" });
    expect(result).toMatchObject({ handled: 2, dispatched: 2, skipped: 0, failed: 0 });
    expect(readFileSync(join(dir, "external-effects.dispatch.jsonl"), "utf8")).toContain("\"status\":\"dispatched\"");
  });

  it("does not derive metadata webhook chain ids from run-local chain snapshots", async () => {
    const dir = tempDir();
    const outboxPath = writeOutbox(dir, [
      {
        type: "metadata-webhooks",
        status: "queued",
        operation: {
          type: "metadata-webhooks",
          event: "completed",
          chainId: "run-summary-generation",
          chainPath: "/data/runs/run-1783372176742-1dfead7e/chain.json",
          chainName: "Run Summary Generation",
          runId: "run-1783372176742-1dfead7e",
        },
      },
    ]);

    await dispatchExternalEffects({
      outboxPath,
      namespaceId: "default",
      orgId: "default",
    });

    expect(fireWebhooks).toHaveBeenCalledWith(
      "default",
      "default",
      "run-summary-generation",
      "completed",
      { runId: "run-1783372176742-1dfead7e" }
    );
  });

  it("falls back to the display chain name when a metadata webhook has no chain path", async () => {
    const dir = tempDir();
    const outboxPath = writeOutbox(dir, [
      {
        type: "metadata-webhooks",
        status: "queued",
        operation: { type: "metadata-webhooks", event: "completed", chainName: "Build Chain", runId: "run-123" },
      },
    ]);

    await dispatchExternalEffects({
      outboxPath,
      namespaceId: "default",
      orgId: "default",
    });

    expect(fireWebhooks).toHaveBeenCalledWith("default", "default", "Build Chain", "completed", { runId: "run-123" });
  });

  it("keeps agent-level notification typing so mid-chain completions never read as chain-level", async () => {
    const dir = tempDir();
    const outboxPath = writeOutbox(dir, [
      {
        type: "notification",
        status: "queued",
        operation: { type: "notification", event: "agent-completed", chainName: "Build Chain", runId: "run-123", agentId: "writer" },
      },
      {
        type: "notification",
        status: "queued",
        operation: { type: "notification", event: "agent-failed", chainName: "Build Chain", runId: "run-123", agentId: "writer", reason: "boom" },
      },
    ]);

    const result = await dispatchExternalEffects({
      outboxPath,
      namespaceId: "default",
      orgId: "default",
    });

    expect(createNotification).toHaveBeenCalledWith("default", expect.objectContaining({
      type: "agent_complete",
      title: "Agent completed in Build Chain",
      metadata: expect.objectContaining({ agentId: "writer" }),
    }));
    expect(createNotification).toHaveBeenCalledWith("default", expect.objectContaining({
      type: "agent_error",
      title: "Agent failed in Build Chain",
      message: "boom",
    }));
    expect(result).toMatchObject({ handled: 2, dispatched: 2 });
  });

  it("uses the tenant identity recorded on each queued record over the input default", async () => {
    const dir = tempDir();
    const outboxPath = writeOutbox(dir, [
      {
        type: "notification",
        status: "queued",
        namespaceId: "acme",
        orgId: "engineering",
        operation: { type: "notification", event: "chain-completed", chainName: "Build Chain", runId: "run-123" },
      },
    ]);

    await dispatchExternalEffects({ outboxPath, namespaceId: "default", orgId: "default" });

    expect(createNotification).toHaveBeenCalledWith("acme", expect.anything());
  });

  it("records dispatch failures without throwing the batch away", async () => {
    (fireWebhooks as jest.Mock).mockRejectedValueOnce(new Error("network down"));
    const dir = tempDir();
    const outboxPath = writeOutbox(dir, [
      {
        type: "metadata-webhooks",
        status: "queued",
        operation: { type: "metadata-webhooks", event: "failed", chainName: "Build Chain", runId: "run-123" },
      },
    ]);

    const result = await dispatchExternalEffects({
      outboxPath,
      namespaceId: "default",
      orgId: "default",
    });

    expect(result).toMatchObject({ handled: 1, dispatched: 0, skipped: 0, failed: 1 });
    expect(readFileSync(join(dir, "external-effects.dispatch.jsonl"), "utf8")).toContain("network down");
  });

  it("dispatches a legacy send-webhook event through the chain webhook subsystem", async () => {
    const dir = tempDir();
    const outboxPath = writeOutbox(dir, [
      {
        type: "webhook",
        status: "queued",
        operation: { type: "webhook", event: "chain-completed", chainPath: "/data/chains/Build Chain/chain.json" },
      },
    ]);

    const result = await dispatchExternalEffects({ outboxPath, namespaceId: "default", orgId: "default" });

    expect(fireWebhooks).toHaveBeenCalledWith("default", "default", "Build Chain", "completed");
    expect(result).toMatchObject({ handled: 1, dispatched: 1, skipped: 0, failed: 0 });
    expect(readFileSync(join(dir, "external-effects.dispatch.jsonl"), "utf8")).toContain("\"status\":\"dispatched\"");
  });

  it("dispatches webhook operations with explicit chainId before path fallback", async () => {
    const dir = tempDir();
    const outboxPath = writeOutbox(dir, [
      {
        type: "webhook",
        status: "queued",
        operation: {
          type: "webhook",
          event: "chain-completed",
          chainId: "run-summary-generation",
          chainPath: "/data/runs/run-1/chain.json",
        },
      },
    ]);

    const result = await dispatchExternalEffects({ outboxPath, namespaceId: "default", orgId: "default" });

    expect(fireWebhooks).toHaveBeenCalledWith("default", "default", "run-summary-generation", "completed");
    expect(result).toMatchObject({ handled: 1, dispatched: 1, skipped: 0, failed: 0 });
  });

  it("skips a webhook event whose chain path cannot be resolved", async () => {
    const dir = tempDir();
    const outboxPath = writeOutbox(dir, [
      { type: "webhook", status: "queued", operation: { type: "webhook", event: "completed" } },
    ]);

    const result = await dispatchExternalEffects({ outboxPath, namespaceId: "default", orgId: "default" });

    expect(fireWebhooks).not.toHaveBeenCalled();
    expect(result).toMatchObject({ handled: 1, dispatched: 0, skipped: 1, failed: 0 });
    expect(readFileSync(join(dir, "external-effects.dispatch.jsonl"), "utf8")).toContain("missing chain path");
  });

  it("updates the linked task and reopens it when the run completed", async () => {
    const dir = tempDir();
    const outboxPath = writeOutbox(dir, [
      {
        type: "task-status",
        status: "queued",
        operation: { type: "task-status", status: "completed", taskId: "TASK-1", runId: "run-123" },
      },
    ]);

    const result = await dispatchExternalEffects({ outboxPath, namespaceId: "default", orgId: "default" });

    expect(taskMergeMeta).toHaveBeenCalledWith("default", "TASK-1", {
      last_run_status: "completed",
      last_run_id: "run-123",
    }, "default");
    expect(taskUpdate).toHaveBeenCalledWith("default", "TASK-1", { status: "open" }, "default");
    expect(result).toMatchObject({ handled: 1, dispatched: 1, skipped: 0, failed: 0 });
  });

  it("records run outcome on the task without reopening it for a stopped run", async () => {
    const dir = tempDir();
    const outboxPath = writeOutbox(dir, [
      {
        type: "task-status",
        status: "queued",
        operation: { type: "task-status", status: "stopped", taskId: "TASK-1", runId: "run-123" },
      },
    ]);

    await dispatchExternalEffects({ outboxPath, namespaceId: "default", orgId: "default" });

    expect(taskMergeMeta).toHaveBeenCalledWith("default", "TASK-1", {
      last_run_status: "stopped",
      last_run_id: "run-123",
    }, "default");
    expect(taskUpdate).not.toHaveBeenCalled();
  });

  it("skips task-status records without a linked or existing task", async () => {
    (taskGet as jest.Mock).mockReturnValueOnce(null);
    const dir = tempDir();
    const outboxPath = writeOutbox(dir, [
      { type: "task-status", status: "queued", operation: { type: "task-status", status: "completed" } },
      { type: "task-status", status: "queued", operation: { type: "task-status", status: "completed", taskId: "TASK-9" } },
    ]);

    const result = await dispatchExternalEffects({ outboxPath, namespaceId: "default", orgId: "default" });

    expect(taskMergeMeta).not.toHaveBeenCalled();
    expect(result).toMatchObject({ handled: 2, dispatched: 0, skipped: 2, failed: 0 });
    const audit = readFileSync(join(dir, "external-effects.dispatch.jsonl"), "utf8");
    expect(audit).toContain("no linked task");
    expect(audit).toContain("task not found: TASK-9");
  });

  it("keeps plugin dispatch out of probe contexts without the drain opt-in", async () => {
    const dir = tempDir();
    const outboxPath = writeOutbox(dir, [
      {
        type: "plugin",
        status: "queued",
        operation: { type: "plugin", event: "chain-completed", chainName: "Build Chain", runId: "run-123" },
      },
    ]);

    const result = await dispatchExternalEffects({ outboxPath, namespaceId: "default", orgId: "default" });

    expect(execFile).not.toHaveBeenCalled();
    expect(result).toMatchObject({ handled: 1, dispatched: 0, skipped: 1, failed: 0 });
    expect(readFileSync(join(dir, "external-effects.dispatch.jsonl"), "utf8")).toContain("live drain opt-in");
  });

  it("invokes the shared shell plugin runner when plugin dispatch is allowed", async () => {
    const dir = tempDir();
    const outboxPath = writeOutbox(dir, [
      {
        type: "plugin",
        status: "queued",
        operation: { type: "plugin", event: "chain-completed", chainName: "Build Chain", runId: "run-123", agentId: "writer" },
      },
    ]);

    const result = await dispatchExternalEffects({
      outboxPath,
      namespaceId: "default",
      orgId: "default",
      allowPluginDispatch: true,
    });

    expect(execFile).toHaveBeenCalledWith(
      "bash",
      expect.arrayContaining([
        expect.stringContaining("plugin-runner.sh"),
        "chain-completed",
        "Build Chain",
        "run-123",
        "writer",
      ]),
      expect.objectContaining({
        env: expect.objectContaining({ NAMESPACE_ID: "default", ORG_ID: "default" }),
      }),
      expect.any(Function),
    );
    expect(result).toMatchObject({ handled: 1, dispatched: 1, skipped: 0, failed: 0 });
  });

  it("dispatches a legacy-webhook over the network only with explicit opt-in", async () => {
    const dir = tempDir();
    const outboxPath = writeOutbox(dir, [
      {
        type: "legacy-webhook",
        status: "queued",
        operation: { type: "legacy-webhook", url: "https://hooks.example.test/chain", payload: { chain: "Build Chain" } },
      },
    ]);

    const result = await dispatchExternalEffects({
      outboxPath,
      namespaceId: "default",
      orgId: "default",
      allowLegacyWebhookNetwork: true,
    });

    expect(postOutboundWebhook).toHaveBeenCalledWith(
      "https://hooks.example.test/chain",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ chain: "Build Chain" }) }),
    );
    expect(result).toMatchObject({ handled: 1, dispatched: 1, skipped: 0, failed: 0 });
  });

  it("never touches the network for a legacy-webhook without opt-in", async () => {
    const dir = tempDir();
    const outboxPath = writeOutbox(dir, [
      {
        type: "legacy-webhook",
        status: "queued",
        operation: { type: "legacy-webhook", url: "https://hooks.example.test/chain", payload: {} },
      },
    ]);

    const result = await dispatchExternalEffects({ outboxPath, namespaceId: "default", orgId: "default" });

    expect(postOutboundWebhook).not.toHaveBeenCalled();
    expect(result).toMatchObject({ handled: 1, dispatched: 0, skipped: 1, failed: 0 });
    expect(readFileSync(join(dir, "external-effects.dispatch.jsonl"), "utf8")).toContain("explicit network opt-in");
  });

  it("records a legacy-webhook non-2xx response as a failure", async () => {
    (postOutboundWebhook as jest.Mock).mockResolvedValueOnce({ statusCode: 500 });
    const dir = tempDir();
    const outboxPath = writeOutbox(dir, [
      {
        type: "legacy-webhook",
        status: "queued",
        operation: { type: "legacy-webhook", url: "https://hooks.example.test/chain", payload: {} },
      },
    ]);

    const result = await dispatchExternalEffects({
      outboxPath,
      namespaceId: "default",
      orgId: "default",
      allowLegacyWebhookNetwork: true,
    });

    expect(result).toMatchObject({ handled: 1, dispatched: 0, skipped: 0, failed: 1 });
    expect(readFileSync(join(dir, "external-effects.dispatch.jsonl"), "utf8")).toContain("HTTP 500");
  });
});

describe("runner-v2 external effects drain", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("consumes the outbox after dispatching every queued record", async () => {
    const dir = tempDir();
    const outboxPath = writeOutbox(dir, [
      {
        type: "notification",
        status: "queued",
        operation: { type: "notification", event: "chain-completed", chainName: "Build Chain", runId: "run-123" },
      },
    ]);

    const result = await drainExternalEffectsOutbox({ outboxPath, namespaceId: "default", orgId: "default" });

    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ handled: 1, dispatched: 1, requeued: 0, failed: 0 });
    expect(existsSync(outboxPath)).toBe(false);
    expect(readFileSync(join(dir, "external-effects.dispatch.jsonl"), "utf8")).toContain("\"attempt\":1");
  });

  it("requeues a transient failure with a bounded attempt count, then fails it permanently", async () => {
    (fireWebhooks as jest.Mock).mockRejectedValue(new Error("network down"));
    const dir = tempDir();
    const outboxPath = writeOutbox(dir, [
      {
        type: "metadata-webhooks",
        status: "queued",
        operation: { type: "metadata-webhooks", event: "failed", chainName: "Build Chain", runId: "run-123" },
      },
    ]);

    const first = await drainExternalEffectsOutbox({ outboxPath, namespaceId: "default", orgId: "default", maxAttempts: 2 });
    expect(first).toMatchObject({ handled: 1, dispatched: 0, requeued: 1, failed: 0 });
    expect(existsSync(outboxPath)).toBe(true);
    expect(readFileSync(outboxPath, "utf8")).toContain("\"attempts\":1");

    const second = await drainExternalEffectsOutbox({ outboxPath, namespaceId: "default", orgId: "default", maxAttempts: 2 });
    expect(second).toMatchObject({ handled: 1, dispatched: 0, requeued: 0, failed: 1 });
    expect(existsSync(outboxPath)).toBe(false);
    expect(readFileSync(join(dir, "external-effects.dispatch.jsonl"), "utf8")).toContain("max dispatch attempts reached (2)");
  });

  it("adopts a claim file orphaned by a crashed drain", async () => {
    const dir = tempDir();
    const outboxPath = join(dir, "external-effects.jsonl");
    const orphanPath = `${outboxPath}.claim-999-1`;
    writeFileSync(orphanPath, JSON.stringify({
      type: "notification",
      status: "queued",
      operation: { type: "notification", event: "chain-completed", chainName: "Build Chain", runId: "run-123" },
    }) + "\n");
    const past = new Date(Date.now() - 10 * 60_000);
    utimesSync(orphanPath, past, past);

    const result = await drainExternalEffectsOutbox({ outboxPath, namespaceId: "default", orgId: "default" });

    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ handled: 1, dispatched: 1 });
    expect(existsSync(orphanPath)).toBe(false);
  });

  it("sweeps the project state outbox and per-run state outboxes for the live path", async () => {
    const root = tempDir();
    const stateDir = join(root, "state");
    const runsDir = join(root, "runs");
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(join(runsDir, "run-1", "state"), { recursive: true });
    mkdirSync(join(runsDir, "run-2", "runner-v2-probe"), { recursive: true });
    writeOutbox(stateDir, [
      {
        type: "notification",
        status: "queued",
        operation: { type: "notification", event: "chain-completed", chainName: "Build Chain", runId: "run-0" },
      },
    ]);
    writeOutbox(join(runsDir, "run-1", "state"), [
      {
        type: "plugin",
        status: "queued",
        operation: { type: "plugin", event: "chain-completed", chainName: "Build Chain", runId: "run-1" },
      },
    ]);
    // probe fixtures are dispatched by the probe itself and must not be swept
    writeOutbox(join(runsDir, "run-2", "runner-v2-probe"), [
      {
        type: "notification",
        status: "queued",
        operation: { type: "notification", event: "chain-completed", chainName: "Probe Chain", runId: "run-probe" },
      },
    ]);

    const result = await drainRunnerV2ExternalEffects({
      stateDir,
      runsDir,
      namespaceId: "default",
      orgId: "default",
    });

    expect(result).toMatchObject({ outboxes: 2, handled: 2, dispatched: 2, failed: 0 });
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(existsSync(join(stateDir, "external-effects.jsonl"))).toBe(false);
    expect(existsSync(join(runsDir, "run-1", "state", "external-effects.jsonl"))).toBe(false);
    expect(existsSync(join(runsDir, "run-2", "runner-v2-probe", "external-effects.jsonl"))).toBe(true);
  });
});
