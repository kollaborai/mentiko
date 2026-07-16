import { dispatchCustomWebhook, dispatchPagerDuty } from "@/lib/system/native-plugin-handler-cli";

describe("typed PagerDuty native handler", () => {
  it("preserves the trigger payload and accepts PagerDuty 202", async () => {
    const post = jest.fn().mockResolvedValue({ statusCode: 202, dedupKey: "pd-1" });
    const stdout = jest.spyOn(console, "log").mockImplementation();
    const stderr = jest.spyOn(console, "error").mockImplementation();
    try {
      await dispatchPagerDuty({ PLUGIN_ROUTING_KEY: "key", PLUGIN_EVENT_TYPE: "chain-stopped", PLUGIN_CHAIN_ID: "chain", PLUGIN_RUN_ID: "run", PLUGIN_SEVERITY: "critical" }, post);
      expect(JSON.parse(post.mock.calls[0][0])).toEqual(expect.objectContaining({ routing_key: "key", event_action: "trigger", dedup_key: "mentiko-chain", payload: expect.objectContaining({ summary: "Chain 'chain' failed (run: run)", severity: "critical", source: "mentiko" }) }));
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).toHaveBeenCalledWith("[pagerduty] incident triggered: pd-1");
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });
  it("surfaces the PagerDuty error message for non-202 responses", async () => {
    await expect(dispatchPagerDuty({ PLUGIN_ROUTING_KEY: "key", PLUGIN_EVENT_TYPE: "chain-stopped", PLUGIN_CHAIN_ID: "chain" }, async () => ({ statusCode: 400, message: "bad key" }))).rejects.toThrow("HTTP 400): bad key");
  });
});

describe("typed custom-webhook native handler", () => {
  it("preserves the filtered outbound POST payload and accepts non-2xx responses", async () => {
    const post = jest.fn().mockResolvedValue({ statusCode: 500 });
    const stdout = jest.spyOn(console, "log").mockImplementation();
    const stderr = jest.spyOn(console, "error").mockImplementation();
    try {
      await expect(dispatchCustomWebhook({ PLUGIN_URL: "https://example.test/hook", PLUGIN_SECRET: "secret", PLUGIN_EVENTS: "chain-stopped", PLUGIN_EVENT_TYPE: "chain-stopped", PLUGIN_CHAIN_ID: "chain", PLUGIN_RUN_ID: "run" }, post, () => new Date("2026-07-16T12:34:56.789Z"))).resolves.toBeUndefined();
      expect(post).toHaveBeenCalledWith("https://example.test/hook", JSON.stringify({ event_type: "chain-stopped", chain_id: "chain", run_id: "run", timestamp: "2026-07-16T12:34:56Z" }), "secret");
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).not.toHaveBeenCalled();
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });

  it("skips filtered events before requiring a URL and propagates delivery errors", async () => {
    const post = jest.fn().mockRejectedValue(new Error("connection refused"));
    await expect(dispatchCustomWebhook({ PLUGIN_EVENTS: "chain-stopped", PLUGIN_EVENT_TYPE: "chain-completed" }, post)).resolves.toBeUndefined();
    expect(post).not.toHaveBeenCalled();
    await expect(dispatchCustomWebhook({ PLUGIN_URL: "https://example.test/hook", PLUGIN_EVENT_TYPE: "chain-stopped" }, post)).rejects.toThrow("connection refused");
  });
});
