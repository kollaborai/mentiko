#!/usr/bin/env node
// GENERATED FROM web/lib/runner-v2/notification-dispatcher-cli.ts - DO NOT EDIT. Rebuild: node scripts/build-runner-bundles.mjs
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

// lib/runner-v2/notification-dispatcher-cli.ts
var notification_dispatcher_cli_exports = {};
__export(notification_dispatcher_cli_exports, {
  runNotificationDispatcherCli: () => runNotificationDispatcherCli
});
module.exports = __toCommonJS(notification_dispatcher_cli_exports);

// lib/runner-v2/notification-dispatcher.ts
function stringValue(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}
function buildDispatchPayload(input) {
  const payload = {
    event: input.eventType,
    chainId: input.chainId,
    runId: input.runId,
    agentId: input.agentId,
    message: input.message,
    namespaceId: input.namespaceId
  };
  return JSON.stringify(payload);
}
function parseRawDispatchResponse(body) {
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error(`notification dispatch returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function validateDispatchResponse(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("notification dispatch response must be a JSON object");
  }
  const dispatched = value.dispatched;
  if (!Array.isArray(dispatched) || dispatched.some((item) => typeof item !== "string")) {
    throw new Error("notification dispatch response is missing dispatched channels");
  }
  return { dispatchedCount: dispatched.length };
}
function parseDispatchResponse(body) {
  return validateDispatchResponse(parseRawDispatchResponse(body));
}
function resolveDispatchEndpoint(env) {
  const explicit = stringValue(env.MENTIKO_DISPATCH_ENDPOINT);
  if (explicit) return explicit;
  const baseUrl = stringValue(env.BETTER_AUTH_URL) || stringValue(env.MENTIKO_WEB_URL) || `http://localhost:${stringValue(env.WEB_PORT) || stringValue(env.PORT) || "3000"}`;
  return `${baseUrl}/api/notifications/dispatch`;
}
function resolveSecret(env) {
  return stringValue(env.MENTIKO_DISPATCH_SECRET) || stringValue(env.BETTER_AUTH_SECRET);
}
function defaultMessage(event) {
  switch (event) {
    case "chain-failed":
      return "Chain stopped due to an error";
    case "agent-failed":
      return "Agent stopped due to an error";
    case "chain-stalled":
      return "Chain appears to be stalled (watchdog)";
    default:
      return "";
  }
}
async function dispatchNotification(input, deps = {}) {
  const env = deps.env ?? process.env;
  if ((stringValue(env.MENTIKO_NOTIFICATIONS_ENABLED) || "true") !== "true") {
    return { ok: true, httpCode: 0, message: `notification: ${input.eventType} skipped (disabled)` };
  }
  const endpoint = input.endpoint || resolveDispatchEndpoint(env);
  const payload = buildDispatchPayload({
    ...input,
    message: input.message || defaultMessage(input.eventType),
    namespaceId: input.namespaceId || stringValue(env.NAMESPACE_ID) || "default"
  });
  const headers = { "Content-Type": "application/json" };
  const secret = resolveSecret(env);
  if (secret) headers.Authorization = `Bearer ${secret}`;
  const fetchFn = deps.fetch ?? globalThis.fetch;
  let status = 0;
  let body = "";
  try {
    const response = await fetchFn(endpoint, { method: "POST", headers, body: payload });
    status = response.status;
    body = await response.text();
  } catch (error) {
    return {
      ok: false,
      httpCode: 0,
      message: `notification: failed to dispatch ${input.eventType} (${error instanceof Error ? error.message : "network error"})`
    };
  }
  const ok = status >= 200 && status < 300;
  if (!ok) return { ok: false, httpCode: status, message: `notification: failed to dispatch ${input.eventType} (HTTP ${status})` };
  try {
    const { dispatchedCount } = parseDispatchResponse(body);
    return { ok: true, httpCode: status, message: `notification: ${input.eventType} dispatched to ${dispatchedCount} channels` };
  } catch (error) {
    return {
      ok: false,
      httpCode: status,
      message: `notification: invalid dispatch response for ${input.eventType} (${error instanceof Error ? error.message : String(error)})`
    };
  }
}
function parseFlags(argv) {
  const values = /* @__PURE__ */ new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === void 0 || values.has(flag)) {
      throw new Error("Invalid runner notification-dispatcher argument list.");
    }
    values.set(flag, value);
  }
  return values;
}
async function runNotificationDispatcherCli(argv) {
  const command = argv[0];
  if (command !== "dispatch") {
    throw new Error("usage: runner-notification-dispatcher dispatch --event <type> --chain <id> --run <id> [--agent <id>] [--message <text>] [--endpoint <url>]");
  }
  const values = parseFlags(argv.slice(1));
  for (const flag of values.keys()) {
    if (!["--event", "--chain", "--run", "--agent", "--message", "--endpoint"].includes(flag)) {
      throw new Error(`${flag} is not valid for runner-notification-dispatcher.`);
    }
  }
  const event = values.get("--event");
  if (!event) throw new Error("--event is required.");
  if (![
    "chain-started",
    "chain-completed",
    "chain-stopped",
    "chain-failed",
    "chain-stalled",
    "agent-completed",
    "agent-failed",
    "approval-requested",
    "budget-threshold"
  ].includes(event)) throw new Error(`Unsupported notification event: ${event}`);
  const outcome = await dispatchNotification({
    eventType: event,
    chainId: values.get("--chain") ?? "",
    runId: values.get("--run") ?? "",
    agentId: values.get("--agent") ?? "",
    message: values.get("--message") ?? "",
    namespaceId: "",
    endpoint: values.get("--endpoint")
  });
  console.log(`  ${outcome.message}`);
  return 0;
}
if (require.main === module) {
  runNotificationDispatcherCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(`runner notification-dispatcher failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 0;
  });
}

// lib/runner-v2/notification-dispatcher-cli.ts
if (require.main === module) {
  runNotificationDispatcherCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(`runner notification-dispatcher failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 0;
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  runNotificationDispatcherCli
});
