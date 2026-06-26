import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { dispatchExternalEffects } from "@/lib/runner-v2/external-effects";
import { fireWebhooks } from "@/lib/webhooks/webhook-utils";
import { createNotification } from "@/lib/notifications/notification-server";

jest.mock("@/lib/webhooks/webhook-utils", () => ({
  fireWebhooks: jest.fn(() => Promise.resolve()),
}));

jest.mock("@/lib/notifications/notification-server", () => ({
  createNotification: jest.fn(),
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
        operation: { type: "metadata-webhooks", event: "completed", chainName: "Build Chain", runId: "run-123" },
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
    expect(fireWebhooks).toHaveBeenCalledWith("default", "default", "Build Chain", "completed", { runId: "run-123" });
    expect(result).toMatchObject({ handled: 2, dispatched: 2, skipped: 0, failed: 0 });
    expect(readFileSync(join(dir, "external-effects.dispatch.jsonl"), "utf8")).toContain("\"status\":\"dispatched\"");
  });

  it("marks unsupported records skipped without dropping audit evidence", async () => {
    const dir = tempDir();
    const outboxPath = writeOutbox(dir, [
      {
        type: "plugin",
        status: "queued",
        operation: { type: "plugin", event: "chain-completed", chainName: "Build Chain", runId: "run-123" },
      },
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
    });

    expect(result).toMatchObject({ handled: 2, dispatched: 0, skipped: 2, failed: 0 });
    const audit = readFileSync(join(dir, "external-effects.dispatch.jsonl"), "utf8");
    expect(audit).toContain("\"status\":\"skipped\"");
    expect(audit).toContain("no typed plugin executor yet");
    expect(audit).toContain("legacy webhook dispatch requires explicit network opt-in");
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
});
