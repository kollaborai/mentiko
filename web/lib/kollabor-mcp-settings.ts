import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { getKollabMentikoMcpServerEnv } from "./kollabor-mcp-server-env";

export interface KollabMcpSettings {
  servers?: Record<string, unknown>;
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RegisterKollabMentikoMcpServerInput {
  command: string;
  homeDir?: string;
}

export interface RegisterKollabMentikoMcpServerResult {
  path: string;
  created: boolean;
  updated: boolean;
  preservedServerCount: number;
}

function serverMap(value: unknown, key: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${key} must be an object`);
  }
  return value as Record<string, unknown>;
}

function readSettings(path: string): { existed: boolean; settings: KollabMcpSettings; raw: string | null } {
  if (!existsSync(path)) return { existed: false, settings: {}, raw: null };
  const raw = readFileSync(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`invalid MCP settings JSON at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`invalid MCP settings JSON at ${path}: expected a JSON object`);
  }
  return { existed: true, settings: parsed as KollabMcpSettings, raw };
}

/**
 * Canonical typed owner of ~/.kollab/mcp/mcp_settings.json. It preserves both
 * historical map spellings on read, publishes only `servers`, and atomically
 * replaces the file so a shell entrypoint never parses or mutates this JSON.
 */
export function registerKollabMentikoMcpServer(
  input: RegisterKollabMentikoMcpServerInput,
): RegisterKollabMentikoMcpServerResult {
  if (!input.command.trim()) throw new Error("MCP command is required");
  const path = join(input.homeDir ?? homedir(), ".kollab", "mcp", "mcp_settings.json");
  mkdirSync(dirname(path), { recursive: true });
  const { existed, settings, raw } = readSettings(path);
  const servers = {
    ...serverMap(settings.mcpServers, "mcpServers"),
    ...serverMap(settings.servers, "servers"),
    mentiko: {
      type: "stdio",
      command: input.command,
      args: [],
      env: getKollabMentikoMcpServerEnv(),
      enabled: true,
    },
  };
  const next: KollabMcpSettings = { ...settings, servers };
  delete next.mcpServers;
  const nextRaw = `${JSON.stringify(next, null, 2)}\n`;
  const updated = raw !== nextRaw;
  if (updated) {
    const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(temporary, nextRaw, "utf8");
    renameSync(temporary, path);
  }
  return {
    path,
    created: !existed,
    updated,
    preservedServerCount: Object.keys(servers).filter((name) => name !== "mentiko").length,
  };
}
