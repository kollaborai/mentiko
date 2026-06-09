import { mkdtempSync } from "fs";
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
});
