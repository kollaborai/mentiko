import { dispatchPagerDuty } from "@/lib/system/native-plugin-handler-cli";

describe("typed PagerDuty native handler", () => {
  it("preserves the trigger payload and accepts PagerDuty 202", async () => {
    const post = jest.fn().mockResolvedValue({ statusCode: 202, dedupKey: "pd-1" });
    await dispatchPagerDuty({ PLUGIN_ROUTING_KEY: "key", PLUGIN_EVENT_TYPE: "chain-stopped", PLUGIN_CHAIN_ID: "chain", PLUGIN_RUN_ID: "run", PLUGIN_SEVERITY: "critical" }, post);
    expect(JSON.parse(post.mock.calls[0][0])).toEqual(expect.objectContaining({ routing_key: "key", event_action: "trigger", dedup_key: "mentiko-chain", payload: expect.objectContaining({ summary: "Chain 'chain' failed (run: run)", severity: "critical", source: "mentiko" }) }));
  });
  it("surfaces the PagerDuty error message for non-202 responses", async () => {
    await expect(dispatchPagerDuty({ PLUGIN_ROUTING_KEY: "key", PLUGIN_EVENT_TYPE: "chain-stopped", PLUGIN_CHAIN_ID: "chain" }, async () => ({ statusCode: 400, message: "bad key" }))).rejects.toThrow("HTTP 400): bad key");
  });
});
