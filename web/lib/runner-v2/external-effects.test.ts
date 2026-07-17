import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawn, type ChildProcess } from "child_process";
import {
  dispatchExternalEffects,
  drainExternalEffectsOutbox,
  drainRunnerV2ExternalEffects,
  enqueueExternalEffectsOnce,
  withExternalEffectsLock,
} from "@/lib/runner-v2/external-effects";
import { fireWebhooks } from "@/lib/webhooks/webhook-utils";
import { postOutboundWebhook } from "@/lib/webhooks/outbound-webhook-delivery";
import { createNotification } from "@/lib/notifications/notification-server";
import {
  taskClaimMetadataKeyIfUnset,
  taskGet,
  taskMergeMeta,
  taskUpdate,
} from "@/lib/tasks/task-store";
import { claimProcessIdentityHash } from "@/lib/runner-v2/file-claim";
import { dispatchPlugins } from "@/lib/system/plugin-dispatch";

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
  taskClaimMetadataKeyIfUnset: jest.fn(() => true),
  taskMergeMeta: jest.fn(),
  taskUpdate: jest.fn(),
}));

jest.mock("@/lib/system/plugin-dispatch", () => ({ dispatchPlugins: jest.fn(() => ({ launched: [], skipped: [] })) }));

function tempDir() {
  return mkdtempSync(join(tmpdir(), "runner-v2-external-effects-"));
}

function writeOutbox(dir: string, records: unknown[]) {
  const path = join(dir, "external-effects.jsonl");
  writeFileSync(path, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
  return path;
}

const externalEffectsChildFixture = join(
  __dirname,
  "test-support",
  "external-effects-child.fixture.ts",
);
const jestBin = join(process.cwd(), "node_modules", "jest", "bin", "jest.js");

function spawnExternalEffectsFixture(input: {
  mode: "hold" | "enqueue";
  outboxPath: string;
  artifactPath: string;
  gatePath?: string;
  effectId?: string;
}): ChildProcess {
  return spawn(process.execPath, [
    jestBin,
    "--runInBand",
    "--testMatch",
    "**/external-effects-child.fixture.ts",
    "--runTestsByPath",
    externalEffectsChildFixture,
  ], {
    cwd: process.cwd(),
    stdio: "ignore",
    env: {
      ...process.env,
      EXTERNAL_EFFECTS_CHILD_MODE: input.mode,
      EXTERNAL_EFFECTS_CHILD_OUTBOX: input.outboxPath,
      EXTERNAL_EFFECTS_CHILD_ARTIFACT: input.artifactPath,
      EXTERNAL_EFFECTS_CHILD_GATE: input.gatePath || "",
      EXTERNAL_EFFECTS_CHILD_ID: input.effectId || "",
    },
  });
}

async function waitForFile(path: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${path}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function waitForExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
}

describe("runner-v2 external effects dispatcher", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (taskClaimMetadataKeyIfUnset as jest.Mock).mockReturnValue(true);
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

  it("audits notification persistence failures as failed instead of dispatched", async () => {
    (createNotification as jest.Mock).mockImplementationOnce(() => {
      throw new Error("notification store write failed");
    });
    const dir = tempDir();
    const outboxPath = writeOutbox(dir, [{
      type: "notification",
      idempotencyKey: "notification-write-failure",
      status: "queued",
      operation: {
        type: "notification",
        event: "chain-completed",
        chainName: "Build Chain",
        runId: "run-123",
        idempotencyKey: "notification-write-failure",
      },
    }]);

    const result = await dispatchExternalEffects({
      outboxPath,
      namespaceId: "default",
      orgId: "default",
    });

    expect(result).toMatchObject({ handled: 1, dispatched: 0, skipped: 0, failed: 1 });
    const audit = readFileSync(join(dir, "external-effects.dispatch.jsonl"), "utf8");
    expect(audit).toContain("\"status\":\"failed\"");
    expect(audit).toContain("notification store write failed");
    expect(audit).not.toContain("\"status\":\"dispatched\"");
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

  it("dispatches typed watchdog stalls as chain failures", async () => {
    const dir = tempDir();
    const outboxPath = writeOutbox(dir, [{
      type: "notification",
      status: "queued",
      operation: {
        type: "notification",
        event: "chain-stalled",
        chainName: "Build Chain",
        runId: "run-123",
        reason: "no live session",
      },
    }]);

    await dispatchExternalEffects({ outboxPath, namespaceId: "default", orgId: "default" });

    expect(createNotification).toHaveBeenCalledWith("default", expect.objectContaining({
      type: "chain_failed",
      title: "Chain stalled",
      message: "no live session",
      metadata: expect.objectContaining({ runId: "run-123" }),
    }));
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

  it("exposes a stable operation ID to at-least-once webhook consumers", async () => {
    const dir = tempDir();
    const outboxPath = writeOutbox(dir, [{
      type: "webhook",
      idempotencyKey: "effect-webhook-1",
      status: "queued",
      operation: {
        type: "webhook",
        event: "chain-completed",
        chainId: "build-chain",
        idempotencyKey: "effect-webhook-1",
      },
    }]);

    await dispatchExternalEffects({ outboxPath, namespaceId: "default", orgId: "default" });

    expect(fireWebhooks).toHaveBeenCalledWith(
      "default",
      "default",
      "build-chain",
      "completed",
      { idempotencyKey: "effect-webhook-1" },
    );
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

    expect(dispatchPlugins).not.toHaveBeenCalled();
    expect(result).toMatchObject({ handled: 1, dispatched: 0, skipped: 1, failed: 0 });
    expect(readFileSync(join(dir, "external-effects.dispatch.jsonl"), "utf8")).toContain("live drain opt-in");
  });

  it("dispatches enabled plugins through the typed registry owner when plugin dispatch is allowed", async () => {
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

    expect(dispatchPlugins).toHaveBeenCalledWith({
      namespaceId: "default",
      orgId: "default",
      event: "chain-completed",
      chainId: "Build Chain",
      runId: "run-123",
      agentId: "writer",
      data: {},
    });
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
    (taskClaimMetadataKeyIfUnset as jest.Mock).mockReturnValue(true);
  });

  it("serializes enqueue against claim rename under the shared lock", async () => {
    const dir = tempDir();
    const outboxPath = join(dir, "external-effects.jsonl");
    let blockedDrain: Awaited<ReturnType<typeof drainExternalEffectsOutbox>> | undefined;

    await withExternalEffectsLock(outboxPath, async () => {
      blockedDrain = await drainExternalEffectsOutbox({
        outboxPath,
        namespaceId: "default",
        orgId: "default",
      });
      appendFileSync(outboxPath, `${JSON.stringify({
        type: "notification",
        idempotencyKey: "effect-locked",
        status: "queued",
        operation: {
          type: "notification",
          event: "chain-stalled",
          chainName: "Build Chain",
          runId: "run-locked",
          idempotencyKey: "effect-locked",
        },
      })}\n`);
    });

    expect(blockedDrain).toMatchObject({ handled: 0, dispatched: 0 });
    const drained = await drainExternalEffectsOutbox({
      outboxPath,
      namespaceId: "default",
      orgId: "default",
    });
    expect(drained).toMatchObject({ handled: 1, dispatched: 1 });
    expect(createNotification).toHaveBeenCalledTimes(1);
  });

  it("waits a bounded interval for a live external-effects lock holder", async () => {
    const dir = tempDir();
    const outboxPath = join(dir, "external-effects.jsonl");
    const readyPath = join(dir, "holder-ready");
    const holder = spawnExternalEffectsFixture({
      mode: "hold",
      outboxPath,
      artifactPath: readyPath,
    });
    await waitForFile(readyPath);

    const queued = enqueueExternalEffectsOnce(outboxPath, [{
      idempotencyKey: "effect-after-live-holder",
      operation: {
        type: "notification",
        event: "chain-completed",
        chainName: "Build Chain",
        runId: "run-after-live-holder",
      },
    }]);

    expect(await waitForExit(holder)).toBe(0);
    expect(queued).toBe(1);
    expect(readFileSync(outboxPath, "utf8")).toContain("effect-after-live-holder");
  }, 10_000);

  it("persists distinct effects from two concurrent enqueue processes", async () => {
    const dir = tempDir();
    const outboxPath = join(dir, "external-effects.jsonl");
    const gatePath = join(dir, "enqueue-go");
    const firstReady = join(dir, "first-ready");
    const secondReady = join(dir, "second-ready");
    const first = spawnExternalEffectsFixture({
      mode: "enqueue",
      outboxPath,
      artifactPath: firstReady,
      gatePath,
      effectId: "effect-concurrent-a",
    });
    const second = spawnExternalEffectsFixture({
      mode: "enqueue",
      outboxPath,
      artifactPath: secondReady,
      gatePath,
      effectId: "effect-concurrent-b",
    });
    await Promise.all([waitForFile(firstReady), waitForFile(secondReady)]);
    writeFileSync(gatePath, "go\n");

    expect(await Promise.all([waitForExit(first), waitForExit(second)])).toEqual([0, 0]);
    const records = readFileSync(outboxPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { idempotencyKey: string });
    expect(records.map((record) => record.idempotencyKey).sort()).toEqual([
      "effect-concurrent-a",
      "effect-concurrent-b",
    ]);
  }, 10_000);

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
    const orphanPath = `${outboxPath}.claim-999999-1`;
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

  it("does not adopt a legacy orphan claim whose owner probe returns EPERM", async () => {
    const dir = tempDir();
    const outboxPath = join(dir, "external-effects.jsonl");
    const ownerPid = 999_998;
    const claimPath = `${outboxPath}.claim-${ownerPid}-1`;
    writeFileSync(claimPath, JSON.stringify({
      type: "notification",
      status: "queued",
      operation: {
        type: "notification",
        event: "chain-completed",
        chainName: "Build Chain",
        runId: "run-eperm-owner",
      },
    }) + "\n");
    const past = new Date(Date.now() - 10 * 60_000);
    utimesSync(claimPath, past, past);
    const actualKill = process.kill.bind(process);
    const kill = jest.spyOn(process, "kill").mockImplementation((pid, signal) => {
      if (pid === ownerPid) {
        throw Object.assign(new Error("not permitted"), { code: "EPERM" });
      }
      return actualKill(pid, signal);
    });

    try {
      const result = await drainExternalEffectsOutbox({
        outboxPath,
        namespaceId: "default",
        orgId: "default",
      });
      expect(result).toMatchObject({ handled: 0, dispatched: 0 });
      expect(existsSync(claimPath)).toBe(true);
      expect(createNotification).not.toHaveBeenCalled();
    } finally {
      kill.mockRestore();
    }
  });

  it("adopts an identity-bearing claim after same-PID process reuse", async () => {
    const dir = tempDir();
    const outboxPath = join(dir, "external-effects.jsonl");
    const oldIdentityHash = claimProcessIdentityHash("old-process-start-identity");
    const claimPath = `${outboxPath}.claim-${process.pid}-i${oldIdentityHash}-1-old`;
    writeFileSync(claimPath, JSON.stringify({
      type: "notification",
      status: "queued",
      operation: {
        type: "notification",
        event: "chain-completed",
        chainName: "Build Chain",
        runId: "run-reused-pid",
      },
    }) + "\n");
    const past = new Date(Date.now() - 10 * 60_000);
    utimesSync(claimPath, past, past);

    const result = await drainExternalEffectsOutbox({
      outboxPath,
      namespaceId: "default",
      orgId: "default",
    });

    expect(result).toMatchObject({ handled: 1, dispatched: 1 });
    expect(existsSync(claimPath)).toBe(false);
    expect(createNotification).toHaveBeenCalledTimes(1);
  });

  it("skips an already completed stable operation when adopting an orphan claim", async () => {
    const dir = tempDir();
    const outboxPath = join(dir, "external-effects.jsonl");
    const orphanPath = `${outboxPath}.claim-999999-1`;
    const idempotencyKey = "watchdog:run-123:run-stalled:notification:v1";
    writeFileSync(orphanPath, `${JSON.stringify({
      type: "notification",
      idempotencyKey,
      status: "queued",
      operation: {
        type: "notification",
        event: "chain-stalled",
        chainName: "Build Chain",
        runId: "run-123",
        idempotencyKey,
      },
    })}\n`);
    writeFileSync(join(dir, "external-effects.dispatch.jsonl"), `${JSON.stringify({
      type: "notification",
      idempotencyKey,
      status: "dispatched",
      timestamp: new Date().toISOString(),
    })}\n`);
    const past = new Date(Date.now() - 10 * 60_000);
    utimesSync(orphanPath, past, past);

    const result = await drainExternalEffectsOutbox({ outboxPath, namespaceId: "default", orgId: "default" });

    expect(result).toMatchObject({ handled: 1, dispatched: 0, skipped: 1 });
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("lets the task sink reject a stable operation already applied before audit", async () => {
    (taskClaimMetadataKeyIfUnset as jest.Mock).mockReturnValueOnce(false);
    const dir = tempDir();
    const outboxPath = writeOutbox(dir, [{
      type: "task-status",
      idempotencyKey: "watchdog:run-123:task-status:v1",
      status: "queued",
      operation: {
        type: "task-status",
        status: "stopped",
        taskId: "TASK-1",
        runId: "run-123",
        idempotencyKey: "watchdog:run-123:task-status:v1",
      },
    }]);

    const result = await drainExternalEffectsOutbox({ outboxPath, namespaceId: "default", orgId: "default" });

    expect(result).toMatchObject({ handled: 1, dispatched: 0, skipped: 1 });
    expect(taskMergeMeta).not.toHaveBeenCalled();
    expect(taskUpdate).not.toHaveBeenCalled();
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
    expect(dispatchPlugins).toHaveBeenCalledTimes(1);
    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(existsSync(join(stateDir, "external-effects.jsonl"))).toBe(false);
    expect(existsSync(join(runsDir, "run-1", "state", "external-effects.jsonl"))).toBe(false);
    expect(existsSync(join(runsDir, "run-2", "runner-v2-probe", "external-effects.jsonl"))).toBe(true);
  });
});

describe("runner-v2 external effects appendJsonl", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("appends both records across two calls instead of the second clobbering the first", async () => {
    const dir = tempDir();
    const auditPath = join(dir, "external-effects.dispatch.jsonl");
    // content already on disk (e.g. from an earlier process) must survive.
    writeFileSync(auditPath, `${JSON.stringify({ type: "seed", status: "dispatched", timestamp: "seed" })}\n`);

    const firstOutbox = writeOutbox(dir, [
      {
        type: "notification",
        status: "queued",
        operation: { type: "notification", event: "chain-completed", chainName: "Build Chain", runId: "run-1" },
      },
    ]);
    await dispatchExternalEffects({ outboxPath: firstOutbox, auditPath, namespaceId: "default", orgId: "default" });

    const secondDir = tempDir();
    const secondOutbox = writeOutbox(secondDir, [
      {
        type: "notification",
        status: "queued",
        operation: { type: "notification", event: "chain-completed", chainName: "Build Chain", runId: "run-2" },
      },
    ]);
    await dispatchExternalEffects({ outboxPath: secondOutbox, auditPath, namespaceId: "default", orgId: "default" });

    // a read-entire-file -> write -> rename implementation would have the
    // second call's write clobber the first call's appended line; both (plus
    // the pre-existing seed line) must be present with nothing dropped.
    const lines = readFileSync(auditPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0])).toMatchObject({ type: "seed" });
    expect(JSON.parse(lines[1])).toMatchObject({ operation: expect.objectContaining({ runId: "run-1" }) });
    expect(JSON.parse(lines[2])).toMatchObject({ operation: expect.objectContaining({ runId: "run-2" }) });
  });
});
