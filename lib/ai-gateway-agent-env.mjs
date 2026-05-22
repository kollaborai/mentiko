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
