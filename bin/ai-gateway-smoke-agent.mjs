#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isExpectedSmokeContent } from "./ai-gateway-smoke-match.mjs";

const baseUrl = process.env.OPENAI_BASE_URL || process.env.OPENAI_API_BASE;
const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.MENTIKO_AI_GATEWAY_SMOKE_MODEL || "glm-5.1";
const expectedContent = "gateway smoke ok";
const runId = process.env.MENTIKO_RUN_ID || process.env.RUN_ID;
const agentId = process.env.MENTIKO_AGENT_ID || "gateway-smoke";
const eventName = process.env.MENTIKO_AGENT_EMITS || "gateway-smoke-complete";

function writeJsonArtifact(name, data) {
  const artifactsDir = process.env.ARTIFACTS_DIR
    || join(process.env.TMPDIR || "/tmp", "mentiko-ai-gateway-smoke");
  mkdirSync(artifactsDir, { recursive: true });
  const artifactPath = join(artifactsDir, name);
  writeFileSync(artifactPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return artifactPath;
}

function writeEvent() {
  const emitterPath = join(process.env.MENTIKO_CODE_ROOT, "lib", "runner-event-emitter.js");
  const result = spawnSync(
    process.execPath,
    [
      emitterPath,
      "emit",
      "--scope", "run",
      "--event", eventName,
      "--source", agentId,
      "--run-id", runId,
      "--data", "",
      "--output", "json",
    ],
    { env: process.env, encoding: "utf8" },
  );
  if (result.error || result.status !== 0) {
    fail("typed runner event emission failed", {
      error: result.error?.message,
      stderr: result.stderr?.trim(),
    });
  }
  try {
    return JSON.parse(result.stdout).path;
  } catch {
    fail("typed runner event emitter returned an invalid result", { stdout: result.stdout });
  }
}

function fail(message, details = {}) {
  const artifactPath = writeJsonArtifact("ai-gateway-smoke-response.json", {
    ok: false,
    message,
    runId,
    model,
    ...details,
  });
  console.error(`gateway smoke failed: ${message}`);
  console.error(`artifact: ${artifactPath}`);
  process.exit(1);
}

if (!baseUrl) {
  fail("OPENAI_BASE_URL or OPENAI_API_BASE is missing");
}

if (!apiKey) {
  fail("OPENAI_API_KEY is missing");
}

if (!runId) {
  fail("MENTIKO_RUN_ID or RUN_ID is missing");
}

if (!process.env.EVENTS_DIR) {
  fail("EVENTS_DIR is missing");
}

if (!process.env.MENTIKO_CODE_ROOT) {
  fail("MENTIKO_CODE_ROOT is missing");
}

const endpoint = new URL(
  "chat/completions",
  baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
);

const requestBody = {
  model,
  messages: [
    {
      role: "user",
      content: "Reply with exactly: gateway smoke ok",
    },
  ],
  max_tokens: 512,
  temperature: 0,
};

let response;
let responseText;
try {
  response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });
  responseText = await response.text();
} catch (error) {
  fail("gateway request threw", { error: error instanceof Error ? error.message : String(error) });
}

let responseJson = null;
try {
  responseJson = responseText ? JSON.parse(responseText) : null;
} catch {
  responseJson = { raw: responseText.slice(0, 2000) };
}

const usage = responseJson?.usage || null;
const content = responseJson?.choices?.[0]?.message?.content || "";
const contentMatched = isExpectedSmokeContent(content, expectedContent);
const artifactPath = writeJsonArtifact("ai-gateway-smoke-response.json", {
  ok: response.ok && contentMatched,
  status: response.status,
  runId,
  model,
  usage,
  content,
  expectedContent,
  contentMatched,
});

if (!response.ok) {
  fail("gateway returned non-2xx", {
    status: response.status,
    response: responseJson,
    artifactPath,
  });
}

if (!contentMatched) {
  fail("gateway returned unexpected content", {
    status: response.status,
    content,
    expectedContent,
    artifactPath,
  });
}

const eventPath = writeEvent();

console.log("SUMMARY:");
console.log("- gateway request succeeded via tenant local proxy");
console.log("ARTIFACTS:");
console.log(`- ${artifactPath}`);
if (eventPath) console.log(`- ${eventPath}`);
console.log("NEXT:");
console.log("- none");
console.log("AGENT_COMPLETE");
