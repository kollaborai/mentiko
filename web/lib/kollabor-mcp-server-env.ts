/**
 * Environment for the stdio `mentiko` MCP server in `~/.kollab/mcp/mcp_settings.json`.
 * Kollabor-engine reads this file and spawns MCP with this env merged with
 * per-session variables (e.g. MENTIKO_SESSION_TOKEN, MENTIKO_SESSION_ID).
 */

export interface KollabMcpServerEnvParams {
  webUrl?: string;
  port?: string;
  mcpToolScope?: string;
  kollaborEngineUrl?: string;
  inboxKey?: string;
  namespaceId?: string;
  orgId?: string;
}

export function getKollabMentikoMcpServerEnv(
  params?: KollabMcpServerEnvParams,
): Record<string, string> {
  const port =
    params?.port ||
    process.env.WEB_PORT ||
    process.env.PORT ||
    "3000";
  const webUrl =
    params?.webUrl?.trim() ||
    (process.env.MENTIKO_WEB_URL && process.env.MENTIKO_WEB_URL.trim()) ||
    `http://127.0.0.1:${port}`;

  const env: Record<string, string> = {
    MENTIKO_MCP_TOOL_SCOPE:
      params?.mcpToolScope?.trim() ||
      (process.env.MENTIKO_MCP_TOOL_SCOPE || "bar").trim(),
    MENTIKO_WEB_URL: webUrl,
    KOLLABOR_ENGINE_URL:
      params?.kollaborEngineUrl?.trim() ||
      (process.env.KOLLABOR_ENGINE_URL && process.env.KOLLABOR_ENGINE_URL.trim()) ||
      "http://127.0.0.1:7433",
  };

  const inbox = params?.inboxKey?.trim() || process.env.MENTIKO_INBOX_KEY?.trim();
  if (inbox) {
    env.MENTIKO_INBOX_KEY = inbox;
  }

  const ns =
    params?.namespaceId?.trim() ||
    process.env.MENTIKO_NAMESPACE_ID?.trim() ||
    process.env.NAMESPACE_ID?.trim();
  if (ns) {
    env.MENTIKO_NAMESPACE_ID = ns;
  }

  const org =
    params?.orgId?.trim() ||
    process.env.MENTIKO_ORG_ID?.trim() ||
    process.env.ORG_ID?.trim();
  if (org) {
    env.MENTIKO_ORG_ID = org;
  }

  return env;
}
