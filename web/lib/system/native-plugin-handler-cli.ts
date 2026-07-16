#!/usr/bin/env node

const HANDLERS = new Set(["pagerduty", "github-pr", "linear", "custom-webhook", "email-digest", "notify-email"]);

/**
 * Typed built-in plugin boundary. Provider implementations land behind this
 * command one at a time; unknown or not-yet-migrated handlers fail closed.
 */
export function runNativePluginHandlerCli(argv: string[]): Promise<void> {
  if (argv[0] !== "dispatch" || argv[1] !== "--handler" || argv.length !== 3 || !HANDLERS.has(argv[2])) {
    throw new Error("usage: runner-native-plugin dispatch --handler <builtin-handler>");
  }
  if (argv[2] !== "pagerduty") throw new Error(`native plugin handler is not implemented: ${argv[2]}`);
  return dispatchPagerDuty(process.env);
}

export async function dispatchPagerDuty(env: NodeJS.ProcessEnv, post: (payload: string) => Promise<{ statusCode: number; dedupKey?: string; message?: string }> = postPagerDuty): Promise<void> {
  const routingKey = env.PLUGIN_ROUTING_KEY || "";
  if (!routingKey) throw new Error("[pagerduty] PLUGIN_ROUTING_KEY not set");
  if (env.PLUGIN_EVENT_TYPE !== "chain-stopped") return;
  const chainId = env.PLUGIN_CHAIN_ID || "unknown";
  const runId = env.PLUGIN_RUN_ID || "";
  const payload = JSON.stringify({ routing_key: routingKey, event_action: "trigger", dedup_key: `mentiko-${chainId}`, payload: { summary: `Chain '${chainId}' failed${runId ? ` (run: ${runId})` : ""}`, severity: env.PLUGIN_SEVERITY || "error", source: "mentiko" } });
  const response = await post(payload);
  if (response.statusCode !== 202) throw new Error(`[pagerduty] error (HTTP ${response.statusCode}): ${response.message || "unknown error"}`);
  console.log(`[pagerduty] incident triggered: ${response.dedupKey || ""}`);
}

export function postPagerDuty(payload: string): Promise<{ statusCode: number; dedupKey?: string; message?: string }> {
  return new Promise((resolve, reject) => {
    const req = request("https://events.pagerduty.com/v2/enqueue", { method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } }, (res) => {
      let body = ""; res.setEncoding("utf8"); res.on("data", (chunk) => { body += chunk; }); res.on("end", () => { let json: Record<string, unknown> = {}; try { json = JSON.parse(body); } catch {} resolve({ statusCode: res.statusCode || 0, dedupKey: typeof json.dedup_key === "string" ? json.dedup_key : undefined, message: typeof json.message === "string" ? json.message : undefined }); });
    });
    req.on("error", reject); req.end(payload);
  });
}

if (require.main === module) {
  runNativePluginHandlerCli(process.argv.slice(2)).catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
import { request } from "node:https";
