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
  dispatchCustomWebhook: () => dispatchCustomWebhook,
  dispatchEmailDigest: () => dispatchEmailDigest,
  dispatchGithubPr: () => dispatchGithubPr,
  dispatchLinear: () => dispatchLinear,
  dispatchNotifyEmail: () => dispatchNotifyEmail,
  dispatchPagerDuty: () => dispatchPagerDuty,
  postCustomWebhook: () => postCustomWebhook,
  postEmail: () => postEmail,
  postJson: () => postJson,
  postPagerDuty: () => postPagerDuty,
  runNativePluginHandlerCli: () => runNativePluginHandlerCli
});
module.exports = __toCommonJS(native_plugin_handler_cli_exports);
var import_node_http = require("node:http");
var import_node_https = require("node:https");
var import_node_child_process = require("node:child_process");
var import_promises = require("node:fs/promises");
var import_node_path = require("node:path");
var import_node_util = require("node:util");
var import_node_crypto = require("node:crypto");
var HANDLERS = /* @__PURE__ */ new Set(["pagerduty", "github-pr", "linear", "custom-webhook", "email-digest", "notify-email"]);
var execFileAsync = (0, import_node_util.promisify)(import_node_child_process.execFile);
function runNativePluginHandlerCli(argv) {
  if (argv[0] !== "dispatch" || argv[1] !== "--handler" || argv.length !== 3 || !HANDLERS.has(argv[2])) {
    throw new Error("usage: runner-native-plugin dispatch --handler <builtin-handler>");
  }
  if (argv[2] === "pagerduty") return dispatchPagerDuty(process.env);
  if (argv[2] === "custom-webhook") return dispatchCustomWebhook(process.env);
  if (argv[2] === "github-pr") return dispatchGithubPr(process.env);
  if (argv[2] === "linear") return dispatchLinear(process.env);
  if (argv[2] === "email-digest") return dispatchEmailDigest(process.env);
  return dispatchNotifyEmail(process.env);
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
  console.error(`[pagerduty] incident triggered: ${response.dedupKey || ""}`);
}
function postPagerDuty(payload) {
  return new Promise((resolve2, reject) => {
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
        resolve2({ statusCode: res.statusCode || 0, dedupKey: typeof json.dedup_key === "string" ? json.dedup_key : void 0, message: typeof json.message === "string" ? json.message : void 0 });
      });
    });
    req.on("error", reject);
    req.end(payload);
  });
}
async function dispatchCustomWebhook(env, post = postCustomWebhook, now = () => /* @__PURE__ */ new Date()) {
  const eventType = env.PLUGIN_EVENT_TYPE || "unknown";
  const events = env.PLUGIN_EVENTS || "all";
  if (events !== "all" && events !== eventType) return;
  const url = env.PLUGIN_URL || "";
  if (!url) throw new Error("[custom-webhook] error: PLUGIN_URL not set");
  const payload = JSON.stringify({
    event_type: eventType,
    chain_id: env.PLUGIN_CHAIN_ID || "unknown",
    run_id: env.PLUGIN_RUN_ID || "",
    timestamp: now().toISOString().replace(/\.\d{3}Z$/, "Z")
  });
  await post(url, payload, env.PLUGIN_SECRET || "");
}
function postCustomWebhook(url, payload, secret) {
  const target = new URL(url);
  if (target.protocol !== "http:" && target.protocol !== "https:") return Promise.reject(new Error(`[custom-webhook] unsupported URL protocol: ${target.protocol}`));
  const request = target.protocol === "https:" ? import_node_https.request : import_node_http.request;
  return new Promise((resolve2, reject) => {
    const req = request(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        ...secret ? { "X-Webhook-Signature": secret } : {}
      }
    }, (res) => {
      res.resume();
      res.once("end", () => resolve2({ statusCode: res.statusCode || 0 }));
      res.once("aborted", () => reject(new Error("[custom-webhook] response aborted")));
    });
    req.once("error", reject);
    req.end(payload);
  });
}
function stringAt(value, path) {
  let cursor = value;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return void 0;
    cursor = cursor[key];
  }
  return typeof cursor === "string" ? cursor : void 0;
}
function arrayAt(value, path) {
  let cursor = value;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return [];
    cursor = cursor[key];
  }
  return Array.isArray(cursor) ? cursor : [];
}
function postJson(url, options) {
  const target = new URL(url);
  if (target.protocol !== "http:" && target.protocol !== "https:") return Promise.reject(new Error(`unsupported URL protocol: ${target.protocol}`));
  const payload = options.body === void 0 ? void 0 : JSON.stringify(options.body);
  const request = target.protocol === "https:" ? import_node_https.request : import_node_http.request;
  return new Promise((resolveResponse, reject) => {
    const req = request(target, {
      method: options.method,
      headers: {
        accept: "application/json",
        ...payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {},
        ...options.headers ?? {}
      }
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.once("end", () => {
        let parsed = body;
        if (body) {
          try {
            parsed = JSON.parse(body);
          } catch {
          }
        }
        resolveResponse({ statusCode: res.statusCode ?? 0, body: parsed });
      });
    });
    req.once("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}
async function runGit(args) {
  const { stdout } = await execFileAsync("git", args, { encoding: "utf8" });
  return stdout.trim();
}
async function dispatchGithubPr(env, request = postJson, git = runGit) {
  if (env.PLUGIN_EVENT_TYPE !== "chain-completed") return;
  const token = env.PLUGIN_TOKEN || "";
  const owner = env.PLUGIN_OWNER || "";
  const repo = env.PLUGIN_REPO || "";
  if (!token || !owner || !repo) throw new Error("[github-pr] PLUGIN_TOKEN, PLUGIN_OWNER, and PLUGIN_REPO are required");
  const base = env.PLUGIN_BASE_BRANCH || "main";
  const head = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!head || head === "HEAD" || head === base) return;
  const ahead = Number(await git(["rev-list", "--count", `${base}..${head}`]));
  if (!Number.isSafeInteger(ahead) || ahead <= 0) return;
  const api = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`;
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28"
  };
  const existing = await request(`${api}?head=${encodeURIComponent(`${owner}:${head}`)}&state=open`, { method: "GET", headers });
  if (existing.statusCode < 200 || existing.statusCode >= 300) throw new Error(`[github-pr] list failed (HTTP ${existing.statusCode}): ${stringAt(existing.body, ["message"]) || "unknown error"}`);
  if (Array.isArray(existing.body) && existing.body.length > 0) return;
  const chainId = env.PLUGIN_CHAIN_ID || "unknown";
  const runId = env.PLUGIN_RUN_ID || "";
  const response = await request(api, {
    method: "POST",
    headers,
    body: {
      title: `[mentiko] Chain '${chainId}' output \u2014 ${head}`,
      body: `This PR was automatically created by the Mentiko github-pr plugin after chain ${chainId} completed.

Branch: ${head} \u2192 ${base}${runId ? `
Run ID: ${runId}` : ""}`,
      head,
      base,
      draft: env.PLUGIN_DRAFT === "true"
    }
  });
  if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(`[github-pr] create failed (HTTP ${response.statusCode}): ${stringAt(response.body, ["message"]) || "unknown error"}`);
  if (!stringAt(response.body, ["html_url"])) throw new Error("[github-pr] create response omitted html_url");
}
function linearSummary(env) {
  const event = env.PLUGIN_EVENT_TYPE || "unknown";
  const chainId = env.PLUGIN_CHAIN_ID || "unknown";
  const runId = env.PLUGIN_RUN_ID || "";
  const agentId = env.PLUGIN_AGENT_ID || "";
  const run = runId ? `

Run ID: ${runId}` : "";
  if (event === "chain-completed") return { title: `[mentiko] Chain '${chainId}' completed`, description: `Chain ${chainId} completed successfully.${run}`, stateName: "Done" };
  if (event === "chain-stopped") return { title: `[mentiko] Chain '${chainId}' failed`, description: `Chain ${chainId} stopped unexpectedly.${run}${agentId ? `
Last agent: ${agentId}` : ""}`, stateName: "Cancelled" };
  if (event === "agent-completed") return { title: `[mentiko] Agent '${agentId || "unknown"}' completed in '${chainId}'`, description: `Agent ${agentId || "unknown"} completed in chain ${chainId}.${run}`, stateName: "Done" };
  return null;
}
var LINEAR_API = "https://api.linear.app/graphql";
async function dispatchLinear(env, request = postJson) {
  const apiKey = env.PLUGIN_API_KEY || "";
  if (!apiKey) throw new Error("[linear] PLUGIN_API_KEY not set");
  const summary = linearSummary(env);
  if (!summary) return;
  const headers = { authorization: apiKey };
  let teamId = env.PLUGIN_TEAM_ID || "";
  if (!teamId) {
    const teams = await request(LINEAR_API, { method: "POST", headers, body: { query: "{ teams { nodes { id } } }" } });
    teamId = stringAt(teams.body, ["data", "teams", "nodes", "0", "id"]) || "";
    if (!teamId) {
      const first = arrayAt(teams.body, ["data", "teams", "nodes"])[0];
      teamId = stringAt(first, ["id"]) || "";
    }
    if (!teamId) throw new Error(`[linear] could not resolve team ID: ${stringAt(teams.body, ["errors", "0", "message"]) || "set PLUGIN_TEAM_ID"}`);
  }
  const state = await request(LINEAR_API, { method: "POST", headers, body: {
    query: "query($teamId:String!,$name:String!){workflowStates(filter:{team:{id:{eq:$teamId}},name:{eq:$name}}){nodes{id}}}",
    variables: { teamId, name: summary.stateName }
  } });
  const stateId = stringAt(arrayAt(state.body, ["data", "workflowStates", "nodes"])[0], ["id"]);
  const input = { title: summary.title, teamId, description: summary.description };
  if (stateId) input.stateId = stateId;
  const created = await request(LINEAR_API, { method: "POST", headers, body: {
    query: "mutation($input:IssueCreateInput!){issueCreate(input:$input){success issue{id identifier url}}}",
    variables: { input }
  } });
  if (created.statusCode < 200 || created.statusCode >= 300 || stringAt(created.body, ["data", "issueCreate", "success"]) === "false" || created.body?.data?.issueCreate?.success !== true) {
    throw new Error(`[linear] create failed (HTTP ${created.statusCode}): ${stringAt(created.body, ["errors", "0", "message"]) || "unknown error"}`);
  }
}
function emailUrl(env) {
  const base = env.BETTER_AUTH_URL || env.MENTIKO_WEB_URL || `http://localhost:${env.WEB_PORT || env.PORT || "3000"}`;
  return `${base.replace(/\/$/, "")}/api/email/send`;
}
async function postEmail(url, payload) {
  return postJson(url, { method: "POST", body: payload });
}
function notificationMessage(env) {
  const to = env.PLUGIN_TO || "";
  if (!to) throw new Error("[notify-email] PLUGIN_TO not set");
  const event = env.PLUGIN_EVENT_TYPE || "unknown";
  const chain = env.PLUGIN_CHAIN_ID || "unknown";
  const run = env.PLUGIN_RUN_ID ? `

Run ID: ${env.PLUGIN_RUN_ID}` : "";
  if (event === "chain-completed") return { to, subject: `[mentiko] Chain '${chain}' completed`, text: `Your Mentiko chain '${chain}' completed successfully.${run}` };
  if (event === "chain-stopped") return { to, subject: `[mentiko] Chain '${chain}' stopped`, text: `Your Mentiko chain '${chain}' has stopped.${run}` };
  return { to, subject: `[mentiko] Event: ${event}`, text: `Chain '${chain}' triggered event: ${event}` };
}
async function dispatchNotifyEmail(env, post = postEmail) {
  const filter = env.PLUGIN_NOTIFY_ON || "all";
  if (filter !== "all" && filter !== (env.PLUGIN_EVENT_TYPE || "unknown")) return;
  const response = await post(emailUrl(env), notificationMessage(env));
  if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(`[notify-email] delivery failed (HTTP ${response.statusCode})`);
}
function digestPath(env) {
  const candidate = env.PLUGIN_DIGEST_FILE || "/tmp/mentiko-digest.jsonl";
  if (!candidate.startsWith("/")) throw new Error("[email-digest] PLUGIN_DIGEST_FILE must be absolute");
  return (0, import_node_path.resolve)(candidate);
}
async function acquireDigestLock(path) {
  const lock = `${path}.lock`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const handle = await (0, import_promises.open)(lock, "wx", 384);
      await handle.close();
      return lock;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
    }
  }
  throw new Error("[email-digest] timed out waiting for digest lock");
}
function digestLine(env, now) {
  return `${JSON.stringify({ event: env.PLUGIN_EVENT_TYPE || "unknown", chain: env.PLUGIN_CHAIN_ID || "unknown", run: env.PLUGIN_RUN_ID || "", ts: now().toISOString() })}
`;
}
async function dispatchEmailDigest(env, post = postEmail, now = () => /* @__PURE__ */ new Date()) {
  const to = env.PLUGIN_TO || "";
  if (!to) throw new Error("[email-digest] PLUGIN_TO not set");
  const rawThreshold = env.PLUGIN_SEND_AFTER_EVENTS || "10";
  const threshold = Number(rawThreshold);
  if (!Number.isSafeInteger(threshold) || threshold < 0) throw new Error("[email-digest] PLUGIN_SEND_AFTER_EVENTS must be a non-negative integer");
  const path = digestPath(env);
  await (0, import_promises.mkdir)((0, import_node_path.dirname)(path), { recursive: true, mode: 448 });
  const lock = await acquireDigestLock(path);
  let claimed;
  try {
    await (0, import_promises.appendFile)(path, digestLine(env, now), { encoding: "utf8", mode: 384 });
    const lines = (await (0, import_promises.readFile)(path, "utf8")).split("\n").filter(Boolean).map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error("[email-digest] buffer contains invalid JSONL");
      }
    });
    if (threshold === 0 || lines.length < threshold) return;
    claimed = `${path}.dispatch-${(0, import_node_crypto.randomUUID)()}.jsonl`;
    await (0, import_promises.rename)(path, claimed);
    const text = lines.map((entry) => `  \u2022 [${typeof entry.ts === "string" ? entry.ts : "?"}] ${typeof entry.chain === "string" ? entry.chain : "?"} \u2014 ${typeof entry.event === "string" ? entry.event : "?"}`).join("\n");
    const response = await post(emailUrl(env), { to, subject: `[mentiko] Chain digest \u2014 ${lines.length} events`, text: `Mentiko chain activity digest:

${text}

---
Generated by Mentiko email-digest plugin` });
    if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(`[email-digest] delivery failed (HTTP ${response.statusCode})`);
    await (0, import_promises.unlink)(claimed);
    claimed = void 0;
  } finally {
    if (claimed) {
      try {
        await (0, import_promises.rename)(claimed, path);
      } catch {
      }
    }
    await (0, import_promises.rm)(lock, { force: true });
  }
}
if (require.main === module) {
  runNativePluginHandlerCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  dispatchCustomWebhook,
  dispatchEmailDigest,
  dispatchGithubPr,
  dispatchLinear,
  dispatchNotifyEmail,
  dispatchPagerDuty,
  postCustomWebhook,
  postEmail,
  postJson,
  postPagerDuty,
  runNativePluginHandlerCli
});
