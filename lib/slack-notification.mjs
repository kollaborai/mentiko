// Typed owner of the Slack chain-notification contract.
//
// This module owns every Slack data shape that lib/slack-integration.sh used to
// build by hand: reading `.config.slack` from the chain file, the enabled /
// subscription gate, and the Slack attachment payload. The shell boundary now
// forwards an event name, the chain-file path, and primitive `key=value` data
// items and parses no JSON. There is no shell fallback: a missing node or an
// unreadable chain file fails the notification without aborting orchestration.
//
// The payload is built with JSON.stringify, which fixes a latent shell bug where
// a chain name or error containing a quote produced invalid JSON.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const STATUS_EMOJI = {
  chain_start: "rocket",
  chain_complete: "white_check_mark",
  chain_error: "x",
  agent_error: "warning",
  agent_timeout: "hourglass",
};

const STATUS_COLOR = {
  chain_start: "#36a64f",
  chain_complete: "#36a64f",
  chain_error: "#dc3545",
  agent_error: "#ffc107",
  agent_timeout: "#fd7e14",
};

export function readChainConfig(chainFile) {
  const raw = readFileSync(chainFile, "utf8");
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === "object" ? parsed : {};
}

export function resolveWebhook(chain, env = process.env) {
  if (env.SLACK_WEBHOOK_URL) return env.SLACK_WEBHOOK_URL;
  const url = chain?.config?.slack?.webhook_url;
  return url && url !== "null" ? url : "";
}

export function slackEnabled(chain, env = process.env) {
  return chain?.config?.slack?.enabled === true || Boolean(env.SLACK_WEBHOOK_URL);
}

/**
 * Returns true when the event should be delivered. A configured `events` list
 * restricts delivery to its members; an empty/absent list allows all.
 */
export function eventSubscribed(chain, event) {
  const events = chain?.config?.slack?.events;
  if (!Array.isArray(events) || events.length === 0) return true;
  return events.includes(event);
}

function parseDataItems(items) {
  const values = {};
  for (const item of items) {
    const match = /^([a-zA-Z_][a-zA-Z0-9_]*)=(.*)$/s.exec(item);
    if (!match) continue;
    values[match[1]] = match[2];
  }
  return values;
}

export function buildSlackPayload(event, chain, data = {}, env = process.env) {
  const chainName = typeof chain?.name === "string" ? chain.name : "";
  const runId = env.MENTIKO_RUN_ID || env.RUN_ID || "";
  const emoji = STATUS_EMOJI[event] || "rocket";
  const color = STATUS_COLOR[event] || "#36a64f";

  const fields = [
    { title: `:${emoji}: ${event}`, short: false },
    { title: "Chain", value: chainName, short: true },
  ];
  if (runId) fields.push({ title: "Run ID", value: `\`${runId}\``, short: true });

  const agentName = data.agent_name;
  if (agentName) fields.push({ title: "Agent", value: agentName, short: true });

  let errorMsg = data.error ?? data.error_msg;
  if (errorMsg && /_error$/.test(event)) {
    if (errorMsg.length > 300) errorMsg = `${errorMsg.slice(0, 300)}...`;
    fields.push({ title: "Error", value: errorMsg, short: false });
  }

  const webUrl = chain?.config?.slack?.web_url || chain?.config?.web_url;
  if (webUrl && webUrl !== "null") {
    const link = runId ? `${webUrl}/run/${runId}` : webUrl;
    fields.push({ title: "View", value: `<${link}|Open Web UI>`, short: false });
  }

  return JSON.stringify({
    username: "Agent Chain",
    icon_emoji: ":robot_face:",
    attachments: [
      { color, footer: "mentiko", ts: Math.floor(Date.now() / 1000), fields },
    ],
  });
}

async function postWebhook(url, body, fetchFn = fetch) {
  const response = await fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  return response.status;
}

function parseCliArgs(argv) {
  const values = { data: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--data") {
      values.data.push(argv[index + 1] ?? "");
      index += 1;
    } else if (token.startsWith("--")) {
      values[token.slice(2)] = argv[index + 1] ?? "";
      index += 1;
    }
  }
  return values;
}

export async function runSlackNotificationCli(argv, env = process.env, fetchFn = fetch) {
  const [command, ...rest] = argv;
  const args = parseCliArgs(rest);

  if (command === "webhook") {
    let chain;
    try {
      chain = readChainConfig(args["chain-file"]);
    } catch {
      chain = {};
    }
    const url = resolveWebhook(chain, env);
    return url ? { code: 0, stdout: `${url}\n` } : { code: 1, stdout: "" };
  }

  if (command === "format" || command === "send") {
    let chain;
    try {
      chain = readChainConfig(args["chain-file"]);
    } catch {
      return { code: 1, stdout: "", stderr: "  error: chain file not found" };
    }
    const event = args.event ?? "";
    const data = parseDataItems(args.data);
    const payload = buildSlackPayload(event, chain, data, env);

    if (command === "format") return { code: 0, stdout: `${payload}\n` };

    // send: gate exactly as the shell did — enabled, webhook, subscription.
    if (!slackEnabled(chain, env)) return { code: 0, stdout: "" };
    const url = resolveWebhook(chain, env);
    if (!url) {
      return { code: 1, stdout: "  slack: no webhook configured (set SLACK_WEBHOOK_URL or config.slack.webhook_url)\n" };
    }
    if (!eventSubscribed(chain, event)) return { code: 0, stdout: "" };

    let status;
    try {
      status = await postWebhook(url, payload, fetchFn);
    } catch {
      status = 0;
    }
    if (status >= 200 && status < 300) {
      return { code: 0, stdout: `  slack: sent ${event} notification\n` };
    }
    return { code: 1, stdout: `  slack: failed to send (http ${status})\n` };
  }

  return { code: 2, stdout: "", stderr: `unknown command: ${command ?? ""}` };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runSlackNotificationCli(process.argv.slice(2)).then((result) => {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(`${result.stderr}\n`);
    process.exit(result.code);
  });
}
