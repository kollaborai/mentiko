import { mkdtempSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const rootDir = mkdtempSync(path.join(tmpdir(), "mentiko-inbound-webhooks-"));

jest.mock("../config", () => ({
  orgPath: (namespaceId: string, orgId: string, ...segments: string[]) =>
    path.join(rootDir, namespaceId, orgId, ...segments),
}));

describe("inbound webhook storage", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("stores run defaults and never stores raw webhook tokens", async () => {
    const storage = await import("./inbound-webhook-storage");

    const created = storage.createInboundWebhook("ns", "org", {
      name: "github deploy",
      chainId: "deploy-chain",
      createdBy: "user-1",
      runDefaults: {
        goal: "Deploy {{payload.ref}}",
        workspaceId: "mentiko",
        agentProfileId: "kollab-cli",
        executor: "kollab",
        payloadMode: "metadata",
      },
      allowedOverrides: {
        goal: true,
        workspace: false,
        profile: false,
        executor: false,
        metadata: true,
      },
    });

    expect(created.token).toMatch(/^mwh_[a-f0-9]+$/);
    expect(created.webhook.tokenHash).toHaveLength(64);
    expect(created.webhook.tokenPreview).toMatch(/^mwh_/);
    expect(JSON.stringify(created.webhook)).not.toContain(created.token);
    expect(created.webhook.runDefaults).toEqual({
      goal: "Deploy {{payload.ref}}",
      workspaceId: "mentiko",
      agentProfileId: "kollab-cli",
      executor: "kollab",
      payloadMode: "metadata",
    });

    const found = storage.findWebhookByToken("ns", "org", created.token);
    expect(found?.id).toBe(created.webhook.id);
  });

  it("creates one-time status tokens and updates trigger status by id", async () => {
    const storage = await import("./inbound-webhook-storage");
    const created = storage.createInboundWebhook("ns", "org", {
      name: "ci",
      chainId: "test-chain",
      createdBy: "user-1",
    });

    const triggerResult = storage.createInboundTrigger("ns", "org", {
      webhookId: created.webhook.id,
      chainId: "test-chain",
      status: "accepted",
      payload: { ref: "main", secret: "dont-store-full-payload" },
      headers: { "x-github-event": "push" },
    });

    expect(triggerResult.statusToken).toMatch(/^mws_[a-f0-9]+$/);
    expect(JSON.stringify(triggerResult.trigger)).not.toContain(triggerResult.statusToken);
    expect(triggerResult.trigger.payloadPreview).toContain("\"ref\":\"main\"");

    storage.updateInboundTrigger("ns", "org", triggerResult.trigger.id, {
      status: "started",
      runId: "run-123",
    });

    const byStatusToken = storage.findInboundTriggerByStatusToken(
      "ns",
      "org",
      triggerResult.trigger.id,
      triggerResult.statusToken
    );

    expect(byStatusToken?.status).toBe("started");
    expect(byStatusToken?.runId).toBe("run-123");
  });

  it("writes the trigger ledger append-only and reconstructs latest state", async () => {
    const storage = await import("./inbound-webhook-storage");
    const { trigger } = storage.createInboundTrigger("led", "org", {
      webhookId: "hook-1",
      chainId: "c",
      status: "accepted",
    });
    storage.updateInboundTrigger("led", "org", trigger.id, { status: "started", runId: "run-1" });
    storage.updateInboundTrigger("led", "org", trigger.id, { status: "failed", error: "boom" });

    // ledger is JSONL and append-only: one line per write (create + 2 updates)
    const jsonlPath = path.join(rootDir, "led", "org", "inbound-webhook-triggers.jsonl");
    expect(existsSync(jsonlPath)).toBe(true);
    const lines = readFileSync(jsonlPath, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBe(3);

    // reconstructed state folds to the latest snapshot, and keeps the first
    // acceptedAt/startedAt timestamps across updates
    const latest = storage.getInboundTriggerById("led", "org", trigger.id);
    expect(latest?.status).toBe("failed");
    expect(latest?.runId).toBe("run-1");
    expect(latest?.error).toBe("boom");
    expect(latest?.startedAt).toBeTruthy();
    expect(storage.listInboundTriggers("led", "org")).toHaveLength(1);
  });

  it("dedupes idempotency keys per webhook and ignores unknown keys", async () => {
    const storage = await import("./inbound-webhook-storage");
    storage.recordInboundIdempotency("idem", "org", {
      webhookId: "hook-1",
      idempotencyKey: "delivery-42",
      triggerId: "trig-1",
      runId: "run-9",
    });

    const hit = storage.findInboundIdempotency("idem", "org", "hook-1", "delivery-42");
    expect(hit?.triggerId).toBe("trig-1");
    expect(hit?.runId).toBe("run-9");

    // different key, or same key under a different webhook, is not a match
    expect(storage.findInboundIdempotency("idem", "org", "hook-1", "delivery-99")).toBeNull();
    expect(storage.findInboundIdempotency("idem", "org", "hook-2", "delivery-42")).toBeNull();
  });
});
