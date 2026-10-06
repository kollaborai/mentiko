import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Environment for the stdio `mentiko` MCP server in `~/.kollab/mcp/mcp_settings.json`.
 * Kollabor-engine reads this file and spawns MCP with this env merged with
 * per-session variables (e.g. MENTIKO_SESSION_TOKEN, MENTIKO_SESSION_ID).
 */

export interface KollabMcpServerEnvParams {
  webUrl?: string;
  port?: string;
  mcpToolScope?: string;
  mcpTrust?: string;
  kollaborEngineUrl?: string;
  inboxKey?: string;
  namespaceId?: string;
  orgId?: string;
}

/**
 * File-backed trust flag — same store family as ~/.kollab/mcp/mcp_settings.json.
 * The bridge reads this file at gate time (see isMcpTrustEnabled in
 * lib/mentiko-mcp/server.ts), so trust survives bridge restarts, app
 * relaunches, and machine reboots regardless of spawning env.
 */
function persistMcpTrustFlag(enabled: boolean): void {
  try {
    const trustPath = join(
      homedir(),
      ".kollab",
      "mcp",
      "trust",
    );
    mkdirSync(dirname(trustPath), { recursive: true });
    if (enabled) {
      writeFileSync(trustPath, "1\n", "utf8");
    } else if (existsSync(trustPath)) {
      writeFileSync(trustPath, "0\n", "utf8");
    }
  } catch {
    // best-effort persistence; env var still works for this process
  }
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

  // Trust flag: forward MENTIKO_MCP_TRUST to the bridge when the host (or a
  // workspace setting) opts in — tier-B tools skip portal per-call approval
  // (see lib/mentiko-mcp/server.ts checkPermission). Also persists to the
  // file-backed setting (~/.kollab/mcp/trust) so trust survives bridge
  // restarts and reboots even when spawned without this env. Default: unset
  // = gated. Set MENTIKO_MCP_TRUST=0 to explicitly disable + unpersist.
  const trust =
    params?.mcpTrust?.trim() ||
    (process.env.MENTIKO_MCP_TRUST && process.env.MENTIKO_MCP_TRUST.trim());
  if (trust === "1") {
    env.MENTIKO_MCP_TRUST = "1";
    persistMcpTrustFlag(true);
  } else if (trust === "0") {
    persistMcpTrustFlag(false);
  }

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
