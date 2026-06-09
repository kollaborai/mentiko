import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const rootDir = mkdtempSync(path.join(tmpdir(), "mentiko-outbound-webhooks-"));
const postOutboundWebhook = jest.fn();

jest.mock("@/lib/config", () => ({
  orgPath: (namespaceId: string, orgId: string, ...segments: string[]) =>
    path.join(rootDir, namespaceId, orgId, ...segments),
}));

jest.mock("./outbound-webhook-delivery", () => ({
  postOutboundWebhook: (...args: unknown[]) => postOutboundWebhook(...args),
}));

describe("outbound webhook runtime storage", () => {
  beforeEach(() => {
    jest.resetModules();
    postOutboundWebhook.mockReset();
    postOutboundWebhook.mockResolvedValue({ statusCode: 202 });
    process.env.BETTER_AUTH_SECRET = "test-secret-for-outbound-webhooks";
  });

  it("encrypts signing secrets and returns safe client configs", async () => {
    const storage = await import("./outbound-webhook-storage");

    const config = storage.createOutboundWebhook("ns", "org", {
      name: "ops",
      url: "https://example.com/hook",
      events: ["chain_complete", "run_failed"],
      secret: "super-secret",
      active: true,
    });

    expect(config.secretEncrypted).toMatch(/^v1:/);
    expect(JSON.stringify(config)).not.toContain("super-secret");
    expect(storage.getOutboundWebhookSecret(config)).toBe("super-secret");

    const client = storage.toOutboundClientConfig(config);
    expect(client.hasSecret).toBe(true);
    expect(JSON.stringify(client)).not.toContain("super-secret");
    expect(JSON.stringify(client)).not.toContain(config.secretEncrypted);
  });

  it("rejects loopback and private outbound targets", async () => {
    const storage = await import("./outbound-webhook-storage");
    const base = {
      name: "ops",
      events: ["started"],
      active: true,
    };

    expect(() => storage.createOutboundWebhook("ns", "org", {
      ...base,
      url: "http://127.0.0.1:3000/hook",
    })).toThrow(/url/i);
    expect(() => storage.createOutboundWebhook("ns", "org", {
      ...base,
      url: "http://10.0.0.5/hook",
    })).toThrow(/url/i);
    expect(() => storage.createOutboundWebhook("ns", "org", {
      ...base,
      url: "http://169.254.169.254/latest/meta-data",
    })).toThrow(/url/i);
    expect(() => storage.createOutboundWebhook("ns", "org", {
      ...base,
      url: "http://[::ffff:127.0.0.1]/hook",
    })).toThrow(/url/i);
  });

  it("sends outbound webhook deliveries and records delivery status", async () => {
    const storage = await import("./outbound-webhook-storage");
    const runtime = await import("./webhook-utils");
    const config = storage.createOutboundWebhook("ns", "org", {
      name: "ops",
      url: "https://example.com/hook",
      events: ["started"],
      secret: "sign-me",
      active: true,
    });

    const result = await runtime.fireOutboundWebhook("ns", "org", config, {
      event: "started",
      chainId: "deploy",
      runId: "run-1",
      timestamp: "2026-06-09T00:00:00.000Z",
      chain: { name: "Deploy" },
    });

    expect(result).toEqual({ ok: true, httpCode: 202 });
    expect(postOutboundWebhook).toHaveBeenCalledWith("https://example.com/hook", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({
        "X-Webhook-Signature": expect.stringMatching(/^sha256=/),
      }),
    }));
    const deliveries = storage.listOutboundDeliveries("ns", "org", config.id);
    expect(deliveries[0]).toEqual(expect.objectContaining({
      webhookId: config.id,
      status: "delivered",
      httpCode: 202,
      chainId: "deploy",
      runId: "run-1",
    }));
  });

  it("scopes outbound webhooks to selected chains and defaults to all chains", async () => {
    const storage = await import("./outbound-webhook-storage");

    const scoped = storage.createOutboundWebhook("scope", "org", {
      name: "deploy-only",
      url: "https://example.com/deploy",
      events: ["completed"],
      scope: { type: "chains", chainIds: ["deploy", "deploy"] },
      active: true,
    });
    const all = storage.createOutboundWebhook("scope", "org", {
      name: "everything",
      url: "https://example.com/all",
      events: ["completed"],
      active: true,
    });

    // scoped config normalizes + dedupes chainIds; default is all-chains
    expect(scoped.scope).toEqual({ type: "chains", chainIds: ["deploy"] });
    expect(all.scope).toEqual({ type: "all" });
    expect(storage.toOutboundClientConfig(scoped).scope).toEqual({ type: "chains", chainIds: ["deploy"] });

    // event filter honors the chain scope
    const forDeploy = storage.listOutboundWebhooksForEvent("scope", "org", "completed", "deploy").map((c) => c.id);
    expect(forDeploy).toEqual(expect.arrayContaining([scoped.id, all.id]));

    const forOther = storage.listOutboundWebhooksForEvent("scope", "org", "completed", "other").map((c) => c.id);
    expect(forOther).toContain(all.id);
    expect(forOther).not.toContain(scoped.id);

    // an empty selected-chains list is rejected (fail closed), not silently
    // widened to all chains
    expect(() => storage.createOutboundWebhook("scope", "org", {
      name: "empty-scope",
      url: "https://example.com/empty",
      events: ["completed"],
      scope: { type: "chains", chainIds: [] },
      active: true,
    })).toThrow(/chain id/i);

    // a chains-scoped webhook fires for nothing when asked about no/other chain
    const noChainMatch = storage.listOutboundWebhooksForEvent("scope", "org", "completed").map((c) => c.id);
    expect(noChainMatch).not.toContain(scoped.id);
  });
});
