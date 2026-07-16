#!/usr/bin/env node

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const HANDLERS = new Set(["pagerduty", "github-pr", "linear", "custom-webhook", "email-digest", "notify-email"]);

type PagerDutyPost = (payload: string) => Promise<{ statusCode: number; dedupKey?: string; message?: string }>;
type WebhookPost = (url: string, payload: string, secret: string) => Promise<{ statusCode: number }>;
type PluginEnvironment = Record<string, string | undefined>;

/**
 * Typed built-in plugin boundary. Provider implementations land behind this
 * command one at a time; unknown or not-yet-migrated handlers fail closed.
 */
export function runNativePluginHandlerCli(argv: string[]): Promise<void> {
  if (argv[0] !== "dispatch" || argv[1] !== "--handler" || argv.length !== 3 || !HANDLERS.has(argv[2])) {
    throw new Error("usage: runner-native-plugin dispatch --handler <builtin-handler>");
  }
  if (argv[2] === "pagerduty") return dispatchPagerDuty(process.env);
  if (argv[2] === "custom-webhook") return dispatchCustomWebhook(process.env);
  throw new Error(`native plugin handler is not implemented: ${argv[2]}`);
}

export async function dispatchPagerDuty(env: PluginEnvironment, post: PagerDutyPost = postPagerDuty): Promise<void> {
  const routingKey = env.PLUGIN_ROUTING_KEY || "";
  if (!routingKey) throw new Error("[pagerduty] PLUGIN_ROUTING_KEY not set");
  if (env.PLUGIN_EVENT_TYPE !== "chain-stopped") return;
  const chainId = env.PLUGIN_CHAIN_ID || "unknown";
  const runId = env.PLUGIN_RUN_ID || "";
  const payload = JSON.stringify({ routing_key: routingKey, event_action: "trigger", dedup_key: `mentiko-${chainId}`, payload: { summary: `Chain '${chainId}' failed${runId ? ` (run: ${runId})` : ""}`, severity: env.PLUGIN_SEVERITY || "error", source: "mentiko" } });
  const response = await post(payload);
  if (response.statusCode !== 202) throw new Error(`[pagerduty] error (HTTP ${response.statusCode}): ${response.message || "unknown error"}`);
  console.error(`[pagerduty] incident triggered: ${response.dedupKey || ""}`);
}

export function postPagerDuty(payload: string): Promise<{ statusCode: number; dedupKey?: string; message?: string }> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest("https://events.pagerduty.com/v2/enqueue", { method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } }, (res) => {
      let body = ""; res.setEncoding("utf8"); res.on("data", (chunk) => { body += chunk; }); res.on("end", () => { let json: Record<string, unknown> = {}; try { json = JSON.parse(body); } catch {} resolve({ statusCode: res.statusCode || 0, dedupKey: typeof json.dedup_key === "string" ? json.dedup_key : undefined, message: typeof json.message === "string" ? json.message : undefined }); });
    });
    req.on("error", reject); req.end(payload);
  });
}

export async function dispatchCustomWebhook(env: PluginEnvironment, post: WebhookPost = postCustomWebhook, now: () => Date = () => new Date()): Promise<void> {
  const eventType = env.PLUGIN_EVENT_TYPE || "unknown";
  const events = env.PLUGIN_EVENTS || "all";
  if (events !== "all" && events !== eventType) return;
  const url = env.PLUGIN_URL || "";
  if (!url) throw new Error("[custom-webhook] error: PLUGIN_URL not set");
  const payload = JSON.stringify({
    event_type: eventType,
    chain_id: env.PLUGIN_CHAIN_ID || "unknown",
    run_id: env.PLUGIN_RUN_ID || "",
    timestamp: now().toISOString().replace(/\.\d{3}Z$/, "Z"),
  });
  await post(url, payload, env.PLUGIN_SECRET || "");
}

export function postCustomWebhook(url: string, payload: string, secret: string): Promise<{ statusCode: number }> {
  const target = new URL(url);
  if (target.protocol !== "http:" && target.protocol !== "https:") return Promise.reject(new Error(`[custom-webhook] unsupported URL protocol: ${target.protocol}`));
  const request = target.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = request(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        ...(secret ? { "X-Webhook-Signature": secret } : {}),
      },
    }, (res) => {
      res.resume();
      res.once("end", () => resolve({ statusCode: res.statusCode || 0 }));
      res.once("aborted", () => reject(new Error("[custom-webhook] response aborted")));
    });
    req.once("error", reject);
    req.end(payload);
  });
}

if (require.main === module) {
  runNativePluginHandlerCli(process.argv.slice(2)).catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
import { request } from "node:https";
