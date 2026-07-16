#!/usr/bin/env node
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// lib/system/native-plugin-handler-cli.ts
var native_plugin_handler_cli_exports = {};
__export(native_plugin_handler_cli_exports, {
  dispatchPagerDuty: () => dispatchPagerDuty,
  postPagerDuty: () => postPagerDuty,
  runNativePluginHandlerCli: () => runNativePluginHandlerCli
});
module.exports = __toCommonJS(native_plugin_handler_cli_exports);
var import_node_https = require("node:https");
var HANDLERS = /* @__PURE__ */ new Set(["pagerduty", "github-pr", "linear", "custom-webhook", "email-digest", "notify-email"]);
function runNativePluginHandlerCli(argv) {
  if (argv[0] !== "dispatch" || argv[1] !== "--handler" || argv.length !== 3 || !HANDLERS.has(argv[2])) {
    throw new Error("usage: runner-native-plugin dispatch --handler <builtin-handler>");
  }
  if (argv[2] !== "pagerduty") throw new Error(`native plugin handler is not implemented: ${argv[2]}`);
  return dispatchPagerDuty(process.env);
}
async function dispatchPagerDuty(env, post = postPagerDuty) {
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
function postPagerDuty(payload) {
  return new Promise((resolve, reject) => {
    const req = (0, import_node_https.request)("https://events.pagerduty.com/v2/enqueue", { method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        let json = {};
        try {
          json = JSON.parse(body);
        } catch {
        }
        resolve({ statusCode: res.statusCode || 0, dedupKey: typeof json.dedup_key === "string" ? json.dedup_key : void 0, message: typeof json.message === "string" ? json.message : void 0 });
      });
    });
    req.on("error", reject);
    req.end(payload);
  });
}
if (require.main === module) {
  runNativePluginHandlerCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  dispatchPagerDuty,
  postPagerDuty,
  runNativePluginHandlerCli
});
