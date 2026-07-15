#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith("--")) continue;
  const key = arg.slice(2);
  const next = process.argv[i + 1];
  if (next && !next.startsWith("--")) {
    args.set(key, next);
    i += 1;
  } else {
    args.set(key, "true");
  }
}

const tenant = args.get("tenant") || "marco";
const tenantBaseUrl = args.get("tenant-url") || `https://${tenant}.mentiko.com`;
const gatewayUrl = args.get("gateway-url") || process.env.MENTIKO_AI_GATEWAY_URL || "";
const tokenId = args.get("token-id") || process.env.MENTIKO_AI_GATEWAY_TOKEN_ID || "";
const token = args.get("token") || process.env.MENTIKO_AI_GATEWAY_TOKEN || "";
const tenantId = args.get("tenant-id") || process.env.TENANT_ID || "";
const model = args.get("model") || process.env.AI_GATEWAY_SMOKE_MODEL || "glm-4.7";
const localProxyToken = args.get("local-proxy-token") || process.env.MENTIKO_AI_GATEWAY_LOCAL_TOKEN || "";
const gatewayAdminUrl = args.get("gateway-admin-url") || process.env.AI_GATEWAY_ADMIN_URL || "";
const gatewayAdminToken = args.get("gateway-admin-token") || process.env.AI_GATEWAY_ADMIN_TOKEN || "";
const runJobRunner = args.get("job-runner") === "true";
const keepTemp = args.get("keep-temp") === "true";

function fail(code, detail) {
  console.error(`status: ✖ ${code}`);
  console.error(`detail: ${detail}`);
  process.exitCode = 1;
}

function proxyHeaders() {
  const headers = { "content-type": "application/json" };
  if (localProxyToken) {
    headers.authorization = `Bearer ${localProxyToken}`;
  }
  return headers;
}

async function readUsageSnapshot() {
  if (!gatewayAdminUrl || !gatewayAdminToken || !tenantId) return null;
  const url = new URL(`/admin/tenants/${tenantId}/usage`, gatewayAdminUrl);
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${gatewayAdminToken}`,
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`usage snapshot failed: ${response.status} ${text.slice(0, 160)}`);
  }
  return JSON.parse(text).usage;
}

async function runLocalProxyChat() {
  const url = new URL("/api/ai-gateway/local/v1/chat/completions", tenantBaseUrl);
  const response = await fetch(url, {
    method: "POST",
    headers: proxyHeaders(),
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Reply with exactly: platform proxy ok" }],
      max_tokens: 16,
      temperature: 0,
    }),
  });
  return {
    url: url.toString(),
    status: response.status,
    text: await response.text(),
  };
}

function mkdirp(path) {
  mkdirSync(path, { recursive: true });
}

function safeRemoveTemp(path) {
  if (!path?.startsWith("/tmp/mentiko-ai-gateway-agent-smoke-")) {
    throw new Error(`refusing unsafe temp cleanup path: ${path}`);
  }
  if (existsSync(path)) rmSync(path, { recursive: true, force: false });
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function runNode(command, commandArgs, options = {}) {
  return new Promise((resolve) => {
    const { timeoutMs, ...spawnOptions } = options;
    const child = spawn(command, commandArgs, {
      ...spawnOptions,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          try {
            child.kill("SIGTERM");
          } catch {}
        }, timeoutMs)
      : null;
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => resolve({ code: 1, stdout, stderr: error.message }));
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({
        code: timedOut ? 124 : code ?? 1,
        stdout,
        stderr: timedOut ? `${stderr}\nprocess timed out` : stderr,
      });
    });
  });
}

function writeProviderlessAgentCli(path) {
  const source = `#!/usr/bin/env node
function readPrompt() {
  return new Promise((resolve) => {
    let prompt = "";
    let done = false;
    let idleTimer = null;
    const maxTimer = setTimeout(() => finish(), 15000);
    function finish() {
      if (done) return;
      done = true;
      clearTimeout(maxTimer);
      if (idleTimer) clearTimeout(idleTimer);
      resolve(prompt);
    }
    function bumpIdle() {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => finish(), 750);
    }
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      prompt += chunk;
      if (chunk.includes("\\n") || chunk.includes("\\r")) {
        finish();
      } else {
        bumpIdle();
      }
    });
    process.stdin.on("end", finish);
    process.stdin.on("error", finish);
  });
}
const prompt = await readPrompt();
if (process.env.MENTIKO_AI_GATEWAY_PROXY !== "local") {
  console.error("MENTIKO_AI_GATEWAY_PROXY was not local");
  process.exit(1);
}
if (!process.env.OPENAI_BASE_URL || !process.env.OPENAI_API_KEY) {
  console.error("OpenAI-compatible local proxy env missing");
  process.exit(1);
}
if (process.env.OPENAI_API_KEY === "server-openai-should-be-stripped") {
  console.error("server provider credential leaked into providerless agent");
  process.exit(1);
}
const response = await fetch(process.env.OPENAI_BASE_URL.replace(/\\/+$/, "") + "/chat/completions", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: "Bearer " + process.env.OPENAI_API_KEY,
  },
  body: JSON.stringify({
    model: process.env.AI_GATEWAY_SMOKE_MODEL || "glm-4.7",
    messages: [{ role: "user", content: prompt.slice(0, 200) || "providerless agent smoke" }],
    max_tokens: 16,
    temperature: 0,
  }),
});
const text = await response.text();
if (!response.ok) {
  console.error("gateway status " + response.status + " " + text.slice(0, 160));
  process.exit(1);
}
console.log(JSON.stringify({
  agent: process.env.AI_GATEWAY_SMOKE_AGENT_LABEL || "providerless-agent",
  proxy: process.env.MENTIKO_AI_GATEWAY_PROXY,
  gateway_status: response.status,
  response_chars: text.length
}));
if (process.env.AI_GATEWAY_SMOKE_PRINT_AGENT_COMPLETE === "true") {
  console.log("AGENT_COMPLETE");
}
`;
  writeFileSync(path, source, { mode: 0o700 });
  try {
    chmodSync(path, 0o700);
  } catch {}
}

async function runProviderlessJobRunner() {
  if (!localProxyToken) {
    throw new Error("local proxy token is required for job-runner smoke");
  }

  const tempRoot = args.get("temp-root") ||
    `/tmp/mentiko-ai-gateway-agent-smoke-${Date.now()}`;
  const namespaceRoot = join(tempRoot, "namespaces", "default");
  const jobsDir = join(namespaceRoot, "jobs");
  const profilesDir = join(namespaceRoot, "agent-profiles");
  const cliPath = join(tempRoot, "providerless-agent-cli.mjs");
  const jobId = `ai-gateway-agent-smoke-${Date.now()}`;
  const jobPath = join(jobsDir, `${jobId}.json`);

  mkdirp(jobsDir);
  mkdirp(profilesDir);
  writeProviderlessAgentCli(cliPath);
  writeJson(join(profilesDir, "default.json"), {
    id: "default",
    name: "Gateway Smoke Providerless Agent",
    isDefault: true,
    cli: process.execPath,
    pipe_flag: cliPath,
    env: {},
  });
  writeJson(jobPath, {
    id: jobId,
    type: "template_test",
    status: "queued",
    input: {
      prompt: "Reply briefly through the Mentiko local AI gateway proxy.",
    },
  });

  try {
    const result = await runNode(
      process.execPath,
      [join(repoRoot, "lib", "runner-job-worker.js"), jobId],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          MENTIKO_GLOBAL_ROOT: tempRoot,
          MENTIKO_PROJECT_ROOT: namespaceRoot,
          MENTIKO_ORG_ROOT: namespaceRoot,
          MENTIKO_NAMESPACE_ROOT: namespaceRoot,
          NAMESPACE_ID: "default",
          ORG_ID: "default",
          WEB_PORT: new URL(tenantBaseUrl).port || "3000",
          BETTER_AUTH_SECRET: localProxyToken,
          MENTIKO_AI_GATEWAY_LOCAL_PROXY_ENABLED: "true",
          MENTIKO_AI_GATEWAY_LOCAL_BASE_URL: `${tenantBaseUrl.replace(/\/+$/, "")}/api/ai-gateway/local/v1`,
          MENTIKO_AI_GATEWAY_LOCAL_TOKEN: localProxyToken,
          AI_GATEWAY_SMOKE_MODEL: model,
          AI_GATEWAY_SMOKE_AGENT_LABEL: "providerless-job-runner",
          AI_GATEWAY_SMOKE_PRINT_AGENT_COMPLETE: "false",
          OPENAI_API_KEY: "server-openai-should-be-stripped",
          GLM_TOKEN: "server-glm-should-be-stripped",
        },
        timeoutMs: 90000,
      },
    );
    const job = JSON.parse(readFileSync(jobPath, "utf8"));
    console.log(`job_runner_exit: ${result.code}`);
    console.log(`job_runner_status: ${job.status}`);
    if (result.code !== 0 || job.status !== "complete") {
      throw new Error((job.error || result.stderr || result.stdout || "job-runner failed").slice(0, 240));
    }
    if (job.result?.parsed?.agent !== "providerless-job-runner") {
      throw new Error("job-runner did not return providerless agent proof");
    }
    console.log(`job_runner_agent: ${job.result.parsed.agent}`);
  } finally {
    if (keepTemp) {
      console.log(`temp_root: ${tempRoot}`);
    } else {
      safeRemoveTemp(tempRoot);
    }
  }
}

async function main() {
  console.log(`tenant: ${tenant}`);
  console.log(`tenant_url: ${tenantBaseUrl}`);

  const missing = [];
  if (!gatewayUrl) missing.push("MENTIKO_AI_GATEWAY_URL");
  if (!tokenId) missing.push("MENTIKO_AI_GATEWAY_TOKEN_ID");
  if (!token) missing.push("MENTIKO_AI_GATEWAY_TOKEN");
  if (!tenantId) missing.push("TENANT_ID");
  if (!localProxyToken) missing.push("MENTIKO_AI_GATEWAY_LOCAL_TOKEN");
  if (missing.length) {
    fail("tenant_gateway_env_missing", `missing ${missing.join(", ")}`);
    return;
  }

  console.log(`gateway_url: ${gatewayUrl}`);
  console.log(`token_id: ${tokenId}`);
  console.log("token: <redacted>");
  console.log(`tenant_id: ${tenantId}`);
  console.log(`model: ${model}`);

  const before = await readUsageSnapshot();
  if (before) {
    console.log(`usage_before: requests=${before.requestsUsed} total=${before.totalTokensUsed}`);
  }

  const proxyProbe = await runLocalProxyChat();
  console.log(`local_proxy_chat: ${proxyProbe.status} ${proxyProbe.url}`);
  if (proxyProbe.status === 404) {
    fail("tenant_proxy_missing", "tenant platform build does not expose the local AI gateway proxy route");
    return;
  }
  if (proxyProbe.status === 401) {
    fail("tenant_proxy_unauthorized", "local proxy token was missing or rejected");
    return;
  }
  if (proxyProbe.status < 200 || proxyProbe.status >= 300) {
    fail("tenant_proxy_chat_failed", proxyProbe.text.slice(0, 240));
    return;
  }

  const after = await readUsageSnapshot();
  if (before && after) {
    const requestDelta = Number(after.requestsUsed) - Number(before.requestsUsed);
    const tokenDelta = Number(after.totalTokensUsed) - Number(before.totalTokensUsed);
    console.log(`usage_after: requests=${after.requestsUsed} total=${after.totalTokensUsed}`);
    console.log(`usage_delta: requests=${requestDelta} total=${tokenDelta}`);
    if (requestDelta < 1 || tokenDelta < 1) {
      fail("gateway_usage_not_incremented", "local proxy returned success but gateway usage did not increase");
      return;
    }
  }

  if (runJobRunner) {
    const jobBefore = await readUsageSnapshot();
    if (jobBefore) {
      console.log(`job_usage_before: requests=${jobBefore.requestsUsed} total=${jobBefore.totalTokensUsed}`);
    }
    await runProviderlessJobRunner();
    const jobAfter = await readUsageSnapshot();
    if (jobBefore && jobAfter) {
      const requestDelta = Number(jobAfter.requestsUsed) - Number(jobBefore.requestsUsed);
      const tokenDelta = Number(jobAfter.totalTokensUsed) - Number(jobBefore.totalTokensUsed);
      console.log(`job_usage_after: requests=${jobAfter.requestsUsed} total=${jobAfter.totalTokensUsed}`);
      console.log(`job_usage_delta: requests=${requestDelta} total=${tokenDelta}`);
      if (requestDelta < 1 || tokenDelta < 1) {
        fail("job_runner_usage_not_incremented", "job-runner succeeded but gateway usage did not increase");
        return;
      }
    }
    console.log("status: ✔ providerless_job_runner_ok");
  }

  console.log("status: ✔ platform_proxy_chat_ok");
}

main().catch((err) => {
  fail("smoke_error", err instanceof Error ? err.message : String(err));
});
