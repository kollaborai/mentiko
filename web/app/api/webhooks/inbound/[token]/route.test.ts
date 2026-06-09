const startChainRun = jest.fn();
const mintSessionToken = jest.fn();
const findWebhookByToken = jest.fn();
const recordUsage = jest.fn();
const createInboundTrigger = jest.fn();
const updateInboundTrigger = jest.fn();
const findInboundIdempotency = jest.fn();
const claimInboundIdempotency = jest.fn();
const finalizeInboundIdempotency = jest.fn();
const releaseInboundIdempotencyClaim = jest.fn();
const getInboundTriggerById = jest.fn();
const loadChainForInboundWebhook = jest.fn();
const buildInboundRunBody = jest.fn();
const normalizeWebhookHeaders = jest.fn();
const readWebhookPayloadValue = jest.fn();
const loadMembers = jest.fn();

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
  findInboundIdempotency: (...args: unknown[]) => findInboundIdempotency(...args),
  claimInboundIdempotency: (...args: unknown[]) => claimInboundIdempotency(...args),
  finalizeInboundIdempotency: (...args: unknown[]) => finalizeInboundIdempotency(...args),
  releaseInboundIdempotencyClaim: (...args: unknown[]) => releaseInboundIdempotencyClaim(...args),
  getInboundTriggerById: (...args: unknown[]) => getInboundTriggerById(...args),
}));

jest.mock("@/lib/webhooks/webhook-runtime", () => ({
  loadChainForInboundWebhook: (...args: unknown[]) => loadChainForInboundWebhook(...args),
  buildInboundRunBody: (...args: unknown[]) => buildInboundRunBody(...args),
  normalizeWebhookHeaders: (...args: unknown[]) => normalizeWebhookHeaders(...args),
  readWebhookPayloadValue: (...args: unknown[]) => readWebhookPayloadValue(...args),
}));

jest.mock("@/lib/orgs/org-storage", () => ({
  loadMembers: (...args: unknown[]) => loadMembers(...args),
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
    loadMembers.mockResolvedValue([]);
    findInboundIdempotency.mockReturnValue(null);
    claimInboundIdempotency.mockImplementation((_namespaceId, _orgId, input) => ({
      claimed: true,
      record: {
        webhookId: input.webhookId,
        idempotencyKey: input.idempotencyKey,
        triggerId: input.triggerId,
        createdAt: "2026-06-09T00:00:00.000Z",
      },
    }));
    finalizeInboundIdempotency.mockImplementation((_namespaceId, _orgId, input) => ({
      webhookId: input.webhookId,
      idempotencyKey: input.idempotencyKey,
      triggerId: input.triggerId,
      ...(input.runId ? { runId: input.runId } : {}),
      createdAt: "2026-06-09T00:00:01.000Z",
    }));
    getInboundTriggerById.mockReturnValue(null);
    mintSessionToken.mockResolvedValue("signed-session-token");
    startChainRun.mockResolvedValue({
      runId: "run-123",
      chainId: "deploy-chain",
      status: "started",
    });
  });

  it("uses the creator's live org role when membership is available", async () => {
    findWebhookByToken.mockReturnValue({
      id: "hook-1",
      name: "deploy hook",
      chainId: "deploy-chain",
      createdBy: "user-1",
      createdByRole: "owner",
    });
    loadMembers.mockResolvedValue([
      { userId: "user-1", role: "member" },
    ]);

    const { POST } = await import("./route");
    const request = new Request("https://marco.mentiko.com/api/webhooks/inbound/mwh_token?ns=ns&org=org", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ref: "refs/heads/main" }),
    });

    const response = await POST(request as never, {
      params: Promise.resolve({ token: "mwh_token" }),
    });

    expect(response.status).toBe(200);
    expect(mintSessionToken).toHaveBeenCalledWith(expect.objectContaining({
      sub: "user-1",
      role: "member",
    }));
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

  it("fails closed when the creator is no longer an org member", async () => {
    findWebhookByToken.mockReturnValue({
      id: "hook-1",
      name: "removed creator hook",
      chainId: "deploy-chain",
      createdBy: "user-1",
      createdByRole: "owner",
    });
    loadMembers.mockResolvedValue([
      { userId: "user-2", role: "member" },
    ]);

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
    expect(json.error.message).toMatch(/no longer/i);
    expect(mintSessionToken).not.toHaveBeenCalled();
    expect(startChainRun).not.toHaveBeenCalled();
  });

  it("records an idempotency key from the Idempotency-Key header on first delivery", async () => {
    const { POST } = await import("./route");
    const request = new Request("https://marco.mentiko.com/api/webhooks/inbound/mwh_token?ns=ns&org=org", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "evt-1" },
      body: JSON.stringify({ ref: "refs/heads/main" }),
    });

    const response = await POST(request as never, {
      params: Promise.resolve({ token: "mwh_token" }),
    });

    expect(response.status).toBe(200);
    expect(findInboundIdempotency).toHaveBeenCalledWith("ns", "org", "hook-1", "evt-1");
    expect(startChainRun).toHaveBeenCalled();
    expect(claimInboundIdempotency).toHaveBeenCalledWith("ns", "org", expect.objectContaining({
      webhookId: "hook-1",
      idempotencyKey: "evt-1",
    }));
    expect(finalizeInboundIdempotency).toHaveBeenCalledWith("ns", "org", expect.objectContaining({
      webhookId: "hook-1",
      idempotencyKey: "evt-1",
      triggerId: "trig-1",
      runId: "run-123",
    }));
  });

  it("returns the original run for a duplicate idempotency key without re-running", async () => {
    findInboundIdempotency.mockReturnValue({
      webhookId: "hook-1",
      idempotencyKey: "evt-1",
      triggerId: "trig-1",
      runId: "run-123",
    });
    getInboundTriggerById.mockReturnValue({ id: "trig-1", status: "started", runId: "run-123" });

    const { POST } = await import("./route");
    const request = new Request("https://marco.mentiko.com/api/webhooks/inbound/mwh_token?ns=ns&org=org", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "evt-1" },
      body: JSON.stringify({ ref: "refs/heads/main" }),
    });

    const response = await POST(request as never, {
      params: Promise.resolve({ token: "mwh_token" }),
    });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data).toEqual({
      ok: true,
      idempotent: true,
      runId: "run-123",
      triggerId: "trig-1",
      status: "started",
      statusUrl: "/api/webhooks/inbound/triggers/trig-1",
    });
    expect(createInboundTrigger).not.toHaveBeenCalled();
    expect(startChainRun).not.toHaveBeenCalled();
    expect(claimInboundIdempotency).not.toHaveBeenCalled();
    expect(finalizeInboundIdempotency).not.toHaveBeenCalled();
  });

  it("returns the winning trigger when another delivery claimed the idempotency key first", async () => {
    claimInboundIdempotency.mockReturnValueOnce({
      claimed: false,
      record: {
        webhookId: "hook-1",
        idempotencyKey: "evt-1",
        triggerId: "trig-winning",
        createdAt: "2026-06-09T00:00:00.000Z",
      },
    });
    getInboundTriggerById.mockReturnValue({ id: "trig-winning", status: "accepted" });

    const { POST } = await import("./route");
    const request = new Request("https://marco.mentiko.com/api/webhooks/inbound/mwh_token?ns=ns&org=org", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "evt-1" },
      body: JSON.stringify({ ref: "refs/heads/main" }),
    });

    const response = await POST(request as never, {
      params: Promise.resolve({ token: "mwh_token" }),
    });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data).toEqual(expect.objectContaining({
      idempotent: true,
      triggerId: "trig-winning",
      status: "accepted",
    }));
    expect(createInboundTrigger).not.toHaveBeenCalled();
    expect(startChainRun).not.toHaveBeenCalled();
    expect(finalizeInboundIdempotency).not.toHaveBeenCalled();
  });

  it("keeps the idempotency claim when finalization fails after a run starts", async () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    finalizeInboundIdempotency.mockImplementationOnce(() => {
      throw new Error("disk full");
    });

    const { POST } = await import("./route");
    const request = new Request("https://marco.mentiko.com/api/webhooks/inbound/mwh_token?ns=ns&org=org", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "evt-1" },
      body: JSON.stringify({ ref: "refs/heads/main" }),
    });

    const response = await POST(request as never, {
      params: Promise.resolve({ token: "mwh_token" }),
    });

    expect(response.status).toBe(500);
    expect(startChainRun).toHaveBeenCalledTimes(1);
    expect(updateInboundTrigger).toHaveBeenCalledWith("ns", "org", "trig-1", expect.objectContaining({
      status: "started",
      runId: "run-123",
    }));
    expect(updateInboundTrigger).not.toHaveBeenCalledWith("ns", "org", "trig-1", expect.objectContaining({
      status: "failed",
    }));
    expect(releaseInboundIdempotencyClaim).not.toHaveBeenCalled();
    consoleError.mockRestore();
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
      headers: { "content-type": "application/json", "idempotency-key": "sched-delivery" },
      body: JSON.stringify({ ref: "refs/heads/main" }),
    });

    const response = await POST(request as never, {
      params: Promise.resolve({ token: "mwh_token" }),
    });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.runId).toBe("run-sched-1");
    expect(mintSessionToken).toHaveBeenCalledWith(expect.objectContaining({
      sub: "user-1",
      role: "member",
    }));
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/api/schedules/run"), expect.objectContaining({
      headers: expect.objectContaining({
        authorization: "Bearer internal-secret",
      }),
      body: expect.stringContaining("signed-session-token"),
    }));
    expect(finalizeInboundIdempotency).toHaveBeenCalledWith("ns", "org", expect.objectContaining({
      webhookId: "hook-1",
      idempotencyKey: "sched-delivery",
      triggerId: "trig-1",
      runId: "run-sched-1",
    }));
  });
});
