import { createHash, createHmac, randomUUID } from "node:crypto";

export interface TenantAiGatewayConfig {
  gatewayUrl: string;
  token: string;
  tokenId: string;
  tenantId: string;
}

export interface TenantAiGatewayRequest {
  url: string;
  body: string;
  headers: Record<string, string>;
}

interface GatewaySignatureInput {
  method: string;
  path: string;
  tenantId: string;
  tokenId: string;
  timestamp: string;
  nonce: string;
  body: string;
}

function cleanEnvValue(value: string | undefined): string {
  return value?.trim() ?? "";
}

function allowedGatewayOrigins(env: Record<string, string | undefined>): Set<string> {
  const origins = new Set<string>();
  for (const raw of [
    env.MENTIKO_AI_GATEWAY_ALLOWED_ORIGIN,
    env.BETTER_AUTH_URL,
    env.NEXT_PUBLIC_BETTER_AUTH_URL,
  ]) {
    if (!raw) continue;
    for (const value of raw.split(",")) {
      const trimmed = value.trim();
      if (!trimmed) continue;
      try {
        origins.add(new URL(trimmed).origin);
      } catch {
        /* ignore malformed optional allowlist entries */
      }
    }
  }
  return origins;
}

function isValidGatewayUrl(value: string, env: Record<string, string | undefined>): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (env.NODE_ENV === "production" && parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password) return false;
  if (parsed.search || parsed.hash) return false;
  if (parsed.pathname.replace(/\/$/, "") !== "/v1") return false;

  const allowed = allowedGatewayOrigins(env);
  return allowed.size === 0 || allowed.has(parsed.origin);
}

export function getTenantAiGatewayConfig(
  env: Record<string, string | undefined> = process.env,
): TenantAiGatewayConfig | null {
  if (env.MENTIKO_AI_GATEWAY_ENABLED !== "true") return null;

  const gatewayUrl = cleanEnvValue(env.MENTIKO_AI_GATEWAY_URL);
  const token = cleanEnvValue(env.MENTIKO_AI_GATEWAY_TOKEN);
  const tokenId = cleanEnvValue(env.MENTIKO_AI_GATEWAY_TOKEN_ID);
  const tenantId = cleanEnvValue(env.TENANT_ID);

  if (!gatewayUrl || !token || !tokenId || !tenantId) return null;
  if (!isValidGatewayUrl(gatewayUrl, env)) return null;
  if (!token.startsWith("mtk_ai_")) return null;
  if (!tokenId.startsWith("tok_")) return null;

  return {
    gatewayUrl,
    token,
    tokenId,
    tenantId,
  };
}

function bodyHash(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

export function canonicalizeTenantAiGatewayRequest(input: GatewaySignatureInput): string {
  return [
    input.method.toUpperCase(),
    input.path,
    input.timestamp,
    input.nonce,
    input.tenantId,
    input.tokenId,
    bodyHash(input.body),
  ].join("\n");
}

export function signTenantAiGatewayRequest(
  input: GatewaySignatureInput,
  token: string,
): string {
  return createHmac("sha256", token)
    .update(canonicalizeTenantAiGatewayRequest(input), "utf8")
    .digest("hex");
}

export function buildTenantAiGatewayRequest(options: {
  endpoint: "chat/completions";
  body: string | Record<string, unknown>;
  config?: TenantAiGatewayConfig | null;
  now?: Date;
  nonce?: string;
}): TenantAiGatewayRequest {
  const config = options.config ?? getTenantAiGatewayConfig();
  if (!config) {
    throw new Error("Tenant AI gateway is not configured");
  }

  const gatewayBase = config.gatewayUrl.endsWith("/")
    ? config.gatewayUrl
    : `${config.gatewayUrl}/`;
  const target = new URL(options.endpoint, gatewayBase);
  const body = typeof options.body === "string"
    ? options.body
    : JSON.stringify(options.body);
  const timestamp = (options.now ?? new Date()).toISOString();
  const nonce = options.nonce ?? randomUUID();
  const path = `${target.pathname}${target.search}`;
  const signature = signTenantAiGatewayRequest({
    method: "POST",
    path,
    tenantId: config.tenantId,
    tokenId: config.tokenId,
    timestamp,
    nonce,
    body,
  }, config.token);

  return {
    url: target.toString(),
    body,
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
      "x-mentiko-ai-tenant-id": config.tenantId,
      "x-mentiko-ai-token-id": config.tokenId,
      "x-mentiko-ai-timestamp": timestamp,
      "x-mentiko-ai-nonce": nonce,
      "x-mentiko-ai-signature": signature,
    },
  };
}

export async function invokeTenantAiGatewayChatCompletions(
  body: Record<string, unknown>,
  options: {
    fetchImpl?: typeof fetch;
    config?: TenantAiGatewayConfig | null;
  } = {},
): Promise<Response> {
  const request = buildTenantAiGatewayRequest({
    endpoint: "chat/completions",
    body,
    config: options.config,
  });
  const fetchImpl = options.fetchImpl ?? fetch;
  return fetchImpl(request.url, {
    method: "POST",
    headers: request.headers,
    body: request.body,
  });
}
