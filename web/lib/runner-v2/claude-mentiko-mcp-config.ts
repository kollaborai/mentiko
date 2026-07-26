import { chmodSync, existsSync, mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const CONTEXT_DIR_PREFIX = "mentiko-claude-mcp-";
const CONFIG_FILE_NAME = "mcp.json";

export interface ClaudeMentikoMcpConfigReceipt {
  dir: string;
  path: string;
}

type RuntimeEnv = NodeJS.ProcessEnv | Record<string, string | undefined>;

/**
 * Materialize the Mentiko MCP server as a private, run-scoped Claude config.
 *
 * Claude's user config can carry an old MENTIKO_WEB_URL and session token. A
 * runner must never inherit that stale capability for a task run. The config
 * is intentionally one-shot: the token exists only in a 0600 temp file and is
 * removed after the provider exits.
 */
export function createClaudeMentikoMcpConfig(
  env: RuntimeEnv,
  options: { serverPath?: string; tempRoot?: string } = {},
): ClaudeMentikoMcpConfigReceipt | undefined {
  const webUrl = value(env.MENTIKO_WEB_URL);
  const sessionId = value(env.MENTIKO_SESSION_ID);
  const sessionToken = value(env.MENTIKO_SESSION_TOKEN);
  const contextValues = [webUrl, sessionId, sessionToken];

  if (contextValues.every((entry) => !entry)) {
    throw new Error("Claude Mentiko MCP context requires MENTIKO_WEB_URL, MENTIKO_SESSION_ID, and MENTIKO_SESSION_TOKEN but all were absent/empty");
  }
  if (contextValues.some((entry) => !entry)) {
    throw new Error("Claude Mentiko MCP context requires MENTIKO_WEB_URL, MENTIKO_SESSION_ID, and MENTIKO_SESSION_TOKEN");
  }

  const serverPath = options.serverPath || resolveMentikoMcpServer(env);
  if (!existsSync(serverPath)) {
    throw new Error(`Claude Mentiko MCP server is missing: ${serverPath}`);
  }

  const dir = mkdtempSync(join(options.tempRoot || tmpdir(), CONTEXT_DIR_PREFIX));
  chmodSync(dir, 0o700);
  const path = join(dir, CONFIG_FILE_NAME);
  const config = {
    mcpServers: {
      mentiko: {
        command: "node",
        args: [serverPath],
        env: {
          MENTIKO_WEB_URL: webUrl,
          MENTIKO_SESSION_ID: sessionId,
          MENTIKO_SESSION_TOKEN: sessionToken,
          // A Claude runner may be launched by a process that also hosts the
          // interactive app/bar bridge. Explicitly neutralize that bridge's
          // approval credential so an unattended chain cannot inherit its
          // user-prompt mode.
          MENTIKO_INBOX_KEY: "",
          MENTIKO_MCP_TOOL_SCOPE: "runner",
        },
      },
    },
  };
  writeFileSync(path, `${JSON.stringify(config)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  chmodSync(path, 0o600);
  return { dir, path };
}

/** Keep the private config alive for the interactive provider, then preserve its exit code. */
export function withClaudeMentikoMcpCleanup(command: string, receipt: ClaudeMentikoMcpConfigReceipt | undefined): string {
  if (!receipt) return command;
  return `${command}; mentiko_mcp_status=$?; rm -f ${shellQuote(receipt.path)}; rmdir ${shellQuote(receipt.dir)} 2>/dev/null || true; (exit $mentiko_mcp_status)`;
}

export function cleanupClaudeMentikoMcpConfig(receipt: ClaudeMentikoMcpConfigReceipt | undefined): void {
  if (!receipt) return;
  try {
    unlinkSync(receipt.path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    rmdirSync(receipt.dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function resolveMentikoMcpServer(env: RuntimeEnv): string {
  const codeRoot = value(env.MENTIKO_CODE_ROOT);
  if (!codeRoot) throw new Error("Claude Mentiko MCP context requires MENTIKO_CODE_ROOT");
  return join(codeRoot, "lib", "mentiko-mcp", "dist", "server.js");
}

function value(input: string | undefined): string {
  return typeof input === "string" ? input.trim() : "";
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `"'"'`)}'`;
}
