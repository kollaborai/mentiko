import { createHash } from "crypto";
import { access, cp as copyDir, mkdir, readdir, readFile, writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { NextRequest, NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { codePath } from "@/lib/config";
import { getKollabMentikoMcpServerEnv } from "@/lib/kollabor-mcp-server-env";

export const dynamic = "force-dynamic";

/** Shipped agent bundle (repo root `kollab/agent-bundles/mentiko`, copied into prod images). */
const SOURCE_DIR = codePath("kollab", "agent-bundles", "mentiko");
const TARGET_DIR = join(homedir(), ".kollab", "agents", "mentiko");
const MCP_SETTINGS_PATH = join(homedir(), ".kollab", "mcp", "mcp_settings.json");

type McpSettings = {
  servers?: Record<string, unknown>;
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
};

type AgentSetupResult = {
  source: string;
  target: string;
  normalizedTarget: string;
  fingerprint: string;
  previousFingerprint: string | null;
  updated: boolean;
};

type McpSetupResult = {
  path: string;
  normalizedPath: string;
  directory: string;
  normalizedDirectory: string;
  serverName: string;
  command: string;
  createdFile: boolean;
  updated: boolean;
  preservedServerCount: number;
};

const MCP_DIR = join(homedir(), ".kollab", "mcp");
const MCP_SERVER_NAME = "mentiko";
const MCP_COMMAND = codePath("bin", "mentiko-mcp");
const NORMALIZED_AGENT_TARGET = "~/.kollab/agents/mentiko";
const NORMALIZED_MCP_DIR = "~/.kollab/mcp";
const NORMALIZED_MCP_SETTINGS_PATH = "~/.kollab/mcp/mcp_settings.json";

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function syncAgentBundle(sourceFingerprint: string): Promise<AgentSetupResult> {
  if (!(await pathExists(SOURCE_DIR))) {
    throw new Error(`mentiko source bundle missing in repo: ${SOURCE_DIR}`);
  }

  const targetExists = await pathExists(TARGET_DIR);
  const previousFingerprint = targetExists ? await hashBundle(TARGET_DIR) : null;
  const updated = previousFingerprint !== sourceFingerprint;

  await mkdir(join(homedir(), ".kollab", "agents"), { recursive: true });
  if (updated) {
    await copyDir(SOURCE_DIR, TARGET_DIR, { recursive: true, force: true });
  }

  return {
    source: SOURCE_DIR,
    target: TARGET_DIR,
    normalizedTarget: NORMALIZED_AGENT_TARGET,
    fingerprint: sourceFingerprint,
    previousFingerprint,
    updated,
  };
}

async function hashBundle(root: string): Promise<string> {
  const hash = createHash("sha256");

  async function walk(dir: string, prefix = ""): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (entry.name === ".DS_Store") continue;
      const absolute = join(dir, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        await walk(absolute, relative);
      } else if (entry.isFile()) {
        hash.update(`file:${relative}\0`);
        hash.update(await readFile(absolute));
        hash.update("\0");
      }
    }
  }

  await walk(root);
  return hash.digest("hex");
}

async function readMcpSettings(): Promise<{ existed: boolean; settings: McpSettings }> {
  if (!(await pathExists(MCP_SETTINGS_PATH))) {
    return { existed: false, settings: {} };
  }

  try {
    const parsed = JSON.parse(await readFile(MCP_SETTINGS_PATH, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("expected a JSON object");
    }
    return { existed: true, settings: parsed as McpSettings };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid MCP settings JSON at ${MCP_SETTINGS_PATH}: ${message}`);
  }
}

function assertServerMap(value: unknown, key: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`invalid MCP settings JSON at ${MCP_SETTINGS_PATH}: ${key} must be an object`);
  }
  return value as Record<string, unknown>;
}

function mentikoMcpServerConfig(): Record<string, unknown> {
  return {
    type: "stdio",
    command: MCP_COMMAND,
    args: [],
    env: getKollabMentikoMcpServerEnv(),
    enabled: true,
  };
}

async function ensureMcpSettings(): Promise<McpSetupResult> {
  await mkdir(MCP_DIR, { recursive: true });

  const { existed, settings } = await readMcpSettings();
  const legacyServers = assertServerMap(settings.mcpServers, "mcpServers");
  const canonicalServers = assertServerMap(settings.servers, "servers");
  const existingServers = {
    ...legacyServers,
    ...canonicalServers,
  };
  const preservedServerCount = Object.keys(existingServers)
    .filter((name) => name !== MCP_SERVER_NAME)
    .length;

  settings.servers = {
    ...existingServers,
    [MCP_SERVER_NAME]: mentikoMcpServerConfig(),
  };
  delete settings.mcpServers;

  const nextJson = `${JSON.stringify(settings, null, 2)}\n`;
  const currentJson = existed ? await readFile(MCP_SETTINGS_PATH, "utf8") : null;
  const updated = currentJson !== nextJson;
  if (updated) {
    await writeFile(MCP_SETTINGS_PATH, nextJson, "utf8");
  }

  return {
    path: MCP_SETTINGS_PATH,
    normalizedPath: NORMALIZED_MCP_SETTINGS_PATH,
    directory: MCP_DIR,
    normalizedDirectory: NORMALIZED_MCP_DIR,
    serverName: MCP_SERVER_NAME,
    command: MCP_COMMAND,
    createdFile: !existed,
    updated,
    preservedServerCount,
  };
}

export async function POST(request: NextRequest) {
  if (!(await checkAuth(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    if (!(await pathExists(SOURCE_DIR))) {
      const mcp = await ensureMcpSettings();
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: `mentiko kollab agent bundle not found at ${SOURCE_DIR} (image build must copy kollab/agent-bundles/mentiko)`,
        synced: mcp.updated,
        agentSynced: false,
        mcpSynced: mcp.updated,
        mcp,
        mcpSettings: MCP_SETTINGS_PATH,
      });
    }

    const agentFingerprint = await hashBundle(SOURCE_DIR);
    const agent = await syncAgentBundle(agentFingerprint);
    const mcp = await ensureMcpSettings();
    return NextResponse.json(
      {
        ok: true,
        agent,
        mcp,
        synced: agent.updated || mcp.updated,
        agentSynced: agent.updated,
        mcpSynced: mcp.updated,
        agentFingerprint: agent.fingerprint,
        agentTarget: agent.target,
        mcpSettings: MCP_SETTINGS_PATH,
      },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `failed to bootstrap mentiko kollab runtime: ${message}` },
      { status: 500 },
    );
  }
}
