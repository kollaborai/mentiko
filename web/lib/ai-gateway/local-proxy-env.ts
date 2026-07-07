import { getTenantAiGatewayConfig } from "./client";
import { resolveInternalAuthSecret } from "../auth/internal-api-auth";

function localOrigin(origin?: string): string {
  if (origin) {
    try {
      const parsed = new URL(origin);
      if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1") {
        return parsed.origin;
      }
    } catch {
      /* fall back to WEB_PORT */
    }
  }
  return `http://127.0.0.1:${process.env.WEB_PORT || process.env.PORT || "3000"}`;
}

export function buildLocalAiGatewayProxyEnv(origin?: string): Record<string, string> {
  if (!getTenantAiGatewayConfig()) return {};

  return {
    MENTIKO_AI_GATEWAY_LOCAL_PROXY_ENABLED: "true",
    MENTIKO_AI_GATEWAY_LOCAL_BASE_URL: `${localOrigin(origin)}/api/ai-gateway/local/v1`,
    MENTIKO_AI_GATEWAY_LOCAL_TOKEN: resolveInternalAuthSecret("ai-gateway-local-proxy"),
  };
}
