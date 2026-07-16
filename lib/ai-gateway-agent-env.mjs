export const PROVIDER_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_API_BASE",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "MISTRAL_API_KEY",
  "GROQ_API_KEY",
  "OPENROUTER_API_KEY",
  "FEATHERLESS_API_KEY",
  "GLM_TOKEN",
];

export const LOCAL_PROXY_CONTROL_KEYS = [
  "MENTIKO_AI_GATEWAY_LOCAL_PROXY_ENABLED",
  "MENTIKO_AI_GATEWAY_LOCAL_BASE_URL",
  "MENTIKO_AI_GATEWAY_LOCAL_TOKEN",
];

export function profileHasProviderCredential(profileEnv = {}) {
  return PROVIDER_ENV_KEYS.some((key) => Boolean(profileEnv[key]));
}

function stripInheritedProviderCredentials(childEnv, profileEnv) {
  for (const key of PROVIDER_ENV_KEYS) {
    if (!profileEnv[key]) {
      delete childEnv[key];
    }
  }
}

function stripLocalProxyControlEnv(childEnv) {
  for (const key of LOCAL_PROXY_CONTROL_KEYS) {
    delete childEnv[key];
  }
}

function applyLocalAiGatewayProxyEnv(childEnv, profileEnv, sourceEnv) {
  if (sourceEnv.MENTIKO_AI_GATEWAY_LOCAL_PROXY_ENABLED !== "true") return;
  if (profileHasProviderCredential(profileEnv)) return;

  const baseUrl = sourceEnv.MENTIKO_AI_GATEWAY_LOCAL_BASE_URL;
  const token = sourceEnv.MENTIKO_AI_GATEWAY_LOCAL_TOKEN;
  if (!baseUrl || !token) return;

  if (!profileEnv.OPENAI_BASE_URL) childEnv.OPENAI_BASE_URL = baseUrl;
  if (!profileEnv.OPENAI_API_BASE) childEnv.OPENAI_API_BASE = baseUrl;
  if (!profileEnv.OPENAI_API_KEY) childEnv.OPENAI_API_KEY = token;
  childEnv.MENTIKO_AI_GATEWAY_PROXY = "local";
}

export function buildAiGatewayAgentEnv(baseEnv = {}, profileEnv = {}, sourceEnv = process.env) {
  const childEnv = { ...baseEnv, ...profileEnv };
  delete childEnv.CLAUDECODE;
  stripInheritedProviderCredentials(childEnv, profileEnv);
  stripLocalProxyControlEnv(childEnv);
  applyLocalAiGatewayProxyEnv(childEnv, profileEnv, sourceEnv);
  return childEnv;
}

export function buildPtyAiGatewayAgentEnv(baseEnv = {}, profileEnv = {}, sourceEnv = process.env) {
  const childEnv = buildAiGatewayAgentEnv(baseEnv, profileEnv, sourceEnv);

  // PtyManager merges opts.env over its own process.env, so blank keys that must
  // not leak from the daemon environment.
  for (const key of PROVIDER_ENV_KEYS) {
    if (!profileEnv[key] && childEnv[key] === undefined) {
      childEnv[key] = "";
    }
  }
  for (const key of LOCAL_PROXY_CONTROL_KEYS) {
    childEnv[key] = "";
  }

  return childEnv;
}

// -------------------------------------------------------------------
// Typed ownership of the agent-profile `.env` provider-credential contract
// and the local AI-gateway proxy injection policy. The shell boundary
// (lib/ai-gateway-agent-env.sh) forwards a profile file path plus primitive
// workspace/env arguments and owns no JSON parsing or policy decision.
// -------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Read an agent profile file and return its `.env` object. A missing or
 * unreadable profile is treated as "no declared credentials" (empty object),
 * matching the shell's fail-open-to-proxy behavior without exposing values.
 */
export function readProfileEnv(profileFile) {
  if (!profileFile) return {};
  let raw;
  try {
    raw = readFileSync(profileFile, "utf8");
  } catch {
    return {};
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  const env = parsed && typeof parsed === "object" ? parsed.env : undefined;
  return env && typeof env === "object" ? env : {};
}

/**
 * Detect a provider credential in an existing `KEY=VALUE`-per-line gateway env
 * blob. Only the key is significant, matching the shell reader it replaces.
 */
export function linesHaveProviderCredential(lines) {
  if (!lines) return false;
  for (const line of String(lines).split("\n")) {
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (value && PROVIDER_ENV_KEYS.includes(key)) return true;
  }
  return false;
}

/**
 * The typed twin of the shell `ai_gateway_local_proxy_env_lines`. Emits the
 * OpenAI-compatible local-proxy env lines only when: workspace is local, the
 * proxy is enabled with a base URL and token, and neither the profile nor the
 * already-resolved gateway env already carries a provider credential.
 */
export function localProxyEnvLines(profileEnv, existingGatewayEnv, workspaceType, sourceEnv = process.env) {
  if ((workspaceType || "local") !== "local") return [];
  if (sourceEnv.MENTIKO_AI_GATEWAY_LOCAL_PROXY_ENABLED !== "true") return [];
  const baseUrl = sourceEnv.MENTIKO_AI_GATEWAY_LOCAL_BASE_URL;
  const token = sourceEnv.MENTIKO_AI_GATEWAY_LOCAL_TOKEN;
  if (!baseUrl || !token) return [];
  if (profileHasProviderCredential(profileEnv)) return [];
  if (linesHaveProviderCredential(existingGatewayEnv)) return [];
  return [
    `OPENAI_BASE_URL=${baseUrl}`,
    `OPENAI_API_BASE=${baseUrl}`,
    `OPENAI_API_KEY=${token}`,
    "MENTIKO_AI_GATEWAY_PROXY=local",
  ];
}

function parseCliArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token.startsWith("--")) {
      values[token.slice(2)] = argv[index + 1] ?? "";
      index += 1;
    }
  }
  return values;
}

export function runAiGatewayAgentEnvCli(argv, sourceEnv = process.env) {
  const [command, ...rest] = argv;
  const args = parseCliArgs(rest);
  switch (command) {
    case "profile-has-provider-credential": {
      const env = readProfileEnv(args["profile-file"]);
      return { code: profileHasProviderCredential(env) ? 0 : 1, stdout: "" };
    }
    case "local-proxy-env-lines": {
      const env = readProfileEnv(args["profile-file"]);
      const lines = localProxyEnvLines(env, args["existing-gateway-env"] ?? "", args["workspace-type"] ?? "local", sourceEnv);
      return { code: 0, stdout: lines.length ? `${lines.join("\n")}\n` : "" };
    }
    default:
      return { code: 2, stdout: "", stderr: `unknown command: ${command ?? ""}` };
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = runAiGatewayAgentEnvCli(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(`${result.stderr}\n`);
  process.exit(result.code);
}
