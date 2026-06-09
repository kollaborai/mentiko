const startChainRun = jest.fn();
const mintSessionToken = jest.fn();
const findWebhookByToken = jest.fn();
const recordUsage = jest.fn();
const createInboundTrigger = jest.fn();
const updateInboundTrigger = jest.fn();
const loadChainForInboundWebhook = jest.fn();
const buildInboundRunBody = jest.fn();
const normalizeWebhookHeaders = jest.fn();

jest.mock("@/lib/runs/chain-run-service", () => ({
  startChainRun: (...args: unknown[]) => startChainRun(...args),
}));

jest.mock("@/lib/auth/session-token", () => ({
  mintSessionToken: (...args: unknown[]) => mintSessionToken(...args),
}));

jest.mock("@/lib/webhooks/inbound-webhook-storage", () => ({
  findWebhookByToken: (...args: unknown[]) => findWebhookByToken(...args),
  recordUsage: (...args: unknown[]) => recordUsage(...args),
  createInboundTrigger: (...args: unknown[]) => createInboundTrigger(...args),
  updateInboundTrigger: (...args: unknown[]) => updateInboundTrigger(...args),
}));

jest.mock("@/lib/webhooks/webhook-runtime", () => ({
  loadChainForInboundWebhook: (...args: unknown[]) => loadChainForInboundWebhook(...args),
  buildInboundRunBody: (...args: unknown[]) => buildInboundRunBody(...args),
  normalizeWebhookHeaders: (...args: unknown[]) => normalizeWebhookHeaders(...args),
}));

jest.mock("@/lib/system/system-logger", () => ({
  writeLog: jest.fn(),
}));

describe("POST /api/webhooks/inbound/[token]", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (global as unknown as { fetch: jest.Mock }).fetch = jest.fn();

    findWebhookByToken.mockReturnValue({
      id: "hook-1",
      name: "deploy hook",
      chainId: "deploy-chain",
      createdBy: "user-1",
      createdByRole: "member",
      runDefaults: {
        goal: "Deploy {{payload.ref}}",
        workspaceId: "mentiko",
        agentProfileId: "kollab-cli",
        executor: "kollab",
        payloadMode: "metadata",
      },
    });
    createInboundTrigger.mockReturnValue({
      trigger: { id: "trig-1", status: "accepted" },
      statusToken: "mws_status_token",
    });
    loadChainForInboundWebhook.mockReturnValue({
      id: "deploy-chain",
      name: "Deploy Chain",
      agents: [{ id: "agent-1", name: "Agent", prompt: "{TASK}" }],
    });
    normalizeWebhookHeaders.mockReturnValue({ "x-github-event": "push" });
    buildInboundRunBody.mockReturnValue({
      chain: {
        id: "deploy-chain",
        name: "Deploy Chain",
        agents: [{ id: "agent-1", name: "Agent", prompt: "{TASK}" }],
      },
      chainId: "deploy-chain",
      userPrompt: "Deploy refs/heads/main",
      workspaceId: "mentiko",
      agentProfileId: "kollab-cli",
      executor: "kollab",
      metadata: {
        triggeredBy: "inbound-webhook",
        inboundWebhookId: "hook-1",
        inboundTriggerId: "trig-1",
      },
    });
    mintSessionToken.mockResolvedValue("signed-session-token");
    startChainRun.mockResolvedValue({
      runId: "run-123",
      chainId: "deploy-chain",
      status: "started",
    });
  });

  it("starts the saved chain directly and returns a status lookup token", async () => {
    const { POST } = await import("./route");
    const request = new Request("https://marco.mentiko.com/api/webhooks/inbound/mwh_token?ns=ns&org=org", {
      method: "POST",
      headers: { "content-type": "application/json", "x-github-event": "push" },
      body: JSON.stringify({ ref: "refs/heads/main" }),
    });

    const response = await POST(request as never, {
      params: Promise.resolve({ token: "mwh_token" }),
    });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data).toEqual({
      ok: true,
      runId: "run-123",
      triggerId: "trig-1",
      statusToken: "mws_status_token",
      statusUrl: "/api/webhooks/inbound/triggers/trig-1",
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mintSessionToken).toHaveBeenCalledWith(expect.objectContaining({
      sub: "user-1",
      role: "member",
      ns: "ns",
      org: "org",
      scopes: ["ops:*"],
    }));
    expect(startChainRun).toHaveBeenCalledWith(expect.objectContaining({
      namespaceId: "ns",
      orgId: "org",
      body: expect.objectContaining({
        chainId: "deploy-chain",
        userPrompt: "Deploy refs/heads/main",
        workspaceId: "mentiko",
        agentProfileId: "kollab-cli",
        executor: "kollab",
      }),
    }));
    expect(updateInboundTrigger).toHaveBeenCalledWith("ns", "org", "trig-1", expect.objectContaining({
      status: "started",
      runId: "run-123",
    }));
    expect(recordUsage).toHaveBeenCalledWith("ns", "org", "hook-1");
  });

  it("fails closed when a webhook has no persisted creator actor", async () => {
    findWebhookByToken.mockReturnValue({
      id: "hook-1",
      name: "legacy hook",
      chainId: "deploy-chain",
    });

    const { POST } = await import("./route");
    const request = new Request("https://marco.mentiko.com/api/webhooks/inbound/mwh_token?ns=ns&org=org", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ref: "refs/heads/main" }),
    });

    const response = await POST(request as never, {
      params: Promise.resolve({ token: "mwh_token" }),
    });
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.error.message).toMatch(/creator/i);
    expect(mintSessionToken).not.toHaveBeenCalled();
    expect(startChainRun).not.toHaveBeenCalled();
    expect(updateInboundTrigger).toHaveBeenCalledWith("ns", "org", "trig-1", expect.objectContaining({
      status: "failed",
    }));
  });

  it("uses internal service auth when triggering a saved schedule", async () => {
    process.env.BETTER_AUTH_SECRET = "internal-secret";
    findWebhookByToken.mockReturnValue({
      id: "hook-1",
      name: "daily hook",
      scheduleId: "sched-1",
      createdBy: "user-1",
      createdByRole: "member",
    });
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { runId: "run-sched-1" } }),
    });

    const { POST } = await import("./route");
    const request = new Request("https://marco.mentiko.com/api/webhooks/inbound/mwh_token?ns=ns&org=org", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ref: "refs/heads/main" }),
    });

    const response = await POST(request as never, {
      params: Promise.resolve({ token: "mwh_token" }),
    });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.runId).toBe("run-sched-1");
    expect(mintSessionToken).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/api/schedules/run"), expect.objectContaining({
      headers: expect.objectContaining({
        authorization: "Bearer internal-secret",
      }),
    }));
  });
});
