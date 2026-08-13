// pty-client.ts - Typed client for pty-manager daemon
//
// Communicates over unix socket with JSON-newline protocol.
// Sole session management interface for all web API routes.
//
// Usage:
//   import { pty, getLiveSessions } from "@/lib/pty-client";
//   const output = await pty.capture("agent-1", 500);
//   const sessions = await getLiveSessions();

import { createConnection } from "net";
import { config, ptyDaemonEnv } from "../config";
import { join, dirname } from "path";
import { existsSync } from "fs";
import { spawn as cpSpawn } from "child_process";

const DAEMON_NAME = config.ptyDaemonName;
const getSocketPath = (): string => {
  if (config.ptySocketPath) return config.ptySocketPath;
  return join(config.ptyManagerDir, `${DAEMON_NAME}.sock`);
};
const SOCKET_PATH = getSocketPath();

interface ResolvePtyMgrPathOptions {
  codeRoot: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  exists?: (path: string) => boolean;
}

export function resolvePtyMgrPath({
  codeRoot,
  cwd = process.cwd(),
  env = process.env,
  exists = existsSync,
}: ResolvePtyMgrPathOptions): string {
  const libPath = join(codeRoot, "lib", "pty-manager.mjs");
  const candidates = [
    env.PTY_MGR_BIN,
    env.MENTIKO_PTY_MGR_BIN,
    join(codeRoot, "node_modules", ".bin", "pty-mgr"),
    join(codeRoot, "web", "node_modules", ".bin", "pty-mgr"),
    "/usr/local/bin/pty-mgr",
    join(codeRoot, "bin", "pty-mgr"),
    libPath,
  ].filter((path): path is string => Boolean(path));

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (exists(candidate)) return candidate;
  }

  let dir = cwd;
  for (let i = 0; i < 5; i++) {
    const binCandidate = join(dir, "bin", "pty-mgr");
    const libCandidate = join(dir, "lib", "pty-manager.mjs");
    if (!seen.has(binCandidate) && exists(binCandidate)) return binCandidate;
    if (!seen.has(libCandidate) && exists(libCandidate)) return libCandidate;

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return libPath;
}

// find pty-manager for auto-start if the configured daemon is not running.
function findPtyMgr(): string {
  return resolvePtyMgrPath({ codeRoot: config.codeRoot });
}

const PTY_MGR_PATH = findPtyMgr();

interface DaemonResponse {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

interface SessionInfo {
  name: string;
  pid: number | null;
  bridgePid: number;
  childPid: number | null;
  cmd: string;
  cwd: string;
  alive: boolean;
  exitCode: number | null;
  createdAt: string;
  exitedAt: string | null;
  terminalSize: string;
  outputBytes: number;
  logging: { path: string; format: string } | null;
}

interface DaemonStatus {
  name: string;
  pid: number;
  socket: string;
  startedAt: string;
  uptimeMs: number;
  uptime: string;
  sessions: { total: number; alive: number; dead: number };
  config: Record<string, unknown>;
}

// send a command to the daemon over unix socket
function sendCommand(req: Record<string, unknown>): Promise<DaemonResponse> {
  return new Promise((resolve, reject) => {
    const conn = createConnection(SOCKET_PATH);
    let buf = "";

    conn.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT" || err.code === "ECONNREFUSED") {
        reject(new Error("daemon not running"));
      } else {
        reject(err);
      }
    });

    conn.on("connect", () => {
      conn.write(JSON.stringify(req) + "\n");
    });

    conn.on("data", (data) => {
      buf += data.toString();
      const nl = buf.indexOf("\n");
      if (nl !== -1) {
        const res = JSON.parse(buf.slice(0, nl));
        conn.end();
        resolve(res);
      }
    });

    // timeout: 10s for most commands
    const timeout = setTimeout(() => {
      conn.destroy();
      reject(new Error("daemon command timed out"));
    }, 10000);

    conn.on("close", () => clearTimeout(timeout));
  });
}

// try to auto-start the daemon if not running
export async function ensurePtyDaemon(): Promise<void> {
  try {
    await sendCommand({ cmd: "status" });
    return; // already running
  } catch {
    // not running, try to start
  }

  return new Promise((resolve, reject) => {
    let child;
    try {
      const isMjs = PTY_MGR_PATH.endsWith(".mjs");
      const cmd = isMjs ? "node" : PTY_MGR_PATH;
      const args = isMjs ? [PTY_MGR_PATH, "daemon"] : ["daemon"];
      child = cpSpawn(cmd, args, {
        detached: true,
        stdio: ["ignore", "ignore", "ignore"],
        env: {
          ...process.env,
          MENTIKO_GLOBAL_ROOT: config.globalRoot,
          MENTIKO_CODE_ROOT: config.codeRoot,
          MENTIKO_PROJECT_ROOT: config.projectRoot,
          MENTIKO_ORG_ROOT: config.orgRoot,
          MENTIKO_NAMESPACE_ROOT: config.namespaceRoot,
          NAMESPACE_ID: config.namespaceId,
          ORG_ID: config.orgId,
          ...ptyDaemonEnv(),
        },
      });
    } catch {
      return reject(new Error(`pty-manager binary not found at ${PTY_MGR_PATH}`));
    }
    child.on("error", () => {
      // binary not found or not executable - swallow to prevent uncaught exception
    });
    child.unref();

    // poll until daemon is ready
    let retries = 0;
    const check = setInterval(async () => {
      retries++;
      try {
        await sendCommand({ cmd: "status" });
        clearInterval(check);
        resolve();
      } catch {
        if (retries >= 20) {
          clearInterval(check);
          reject(new Error("failed to start pty-manager daemon"));
        }
      }
    }, 250);
  });
}

class PtyClient {
  // spawn a new session
  async spawn(
    name: string,
    cmd?: string,
    args?: string[],
    opts?: { cwd?: string; env?: Record<string, string> }
  ): Promise<{ name: string; pid: number }> {
    await ensurePtyDaemon();
    const res = await sendCommand({
      cmd: "spawn",
      name,
      args: { cmd: cmd || "zsh", args: args || [], ...opts },
    });
    if (!res.ok) throw new Error(res.error || "spawn failed");
    return { name: res.name as string, pid: res.pid as number };
  }

  // send text + enter to a session. Include the return in the payload rather
  // than relying only on the daemon's newer `enter` flag: existing local
  // daemons can be older than this client and silently ignore that flag. The
  // explicit frame keeps agent instructions, completion commands, and monitor
  // nudges submit-capable during a rolling daemon upgrade.
  async sendKeys(name: string, text: string): Promise<void> {
    const submittedText = /[\r\n]$/.test(text) ? text : `${text}\r`;
    const res = await sendCommand({
      cmd: "send",
      name,
      args: { text: submittedText, raw: true },
    });
    if (!res.ok) throw new Error(res.error || "send failed");
  }

  // send raw text (no enter)
  async sendRaw(name: string, text: string): Promise<void> {
    const res = await sendCommand({
      cmd: "send",
      name,
      args: { text, raw: true },
    });
    if (!res.ok) throw new Error(res.error || "send failed");
  }

  // capture session output
  async capture(name: string, lines?: number): Promise<string> {
    const res = await sendCommand({
      cmd: "capture",
      name,
      args: lines ? { lines } : undefined,
    });
    if (!res.ok) throw new Error(res.error || "capture failed");
    return (res.output as string) || "";
  }

  // check if session exists and is alive
  async alive(name: string): Promise<boolean> {
    try {
      const res = await sendCommand({ cmd: "alive", name });
      return res.ok && res.alive === true;
    } catch {
      return false;
    }
  }

  // check if session exists (alive or dead)
  async has(name: string): Promise<boolean> {
    try {
      const res = await sendCommand({ cmd: "has", name });
      return res.ok && res.exists === true;
    } catch {
      return false;
    }
  }

  // kill a session (keeps it in manager as "dead")
  async kill(name: string): Promise<void> {
    try {
      await sendCommand({ cmd: "kill", name });
    } catch {
      // session might not exist
    }
  }

  // remove a session (kill + delete from manager)
  async remove(name: string): Promise<void> {
    try {
      await sendCommand({ cmd: "remove", name });
    } catch {
      // session might not exist
    }
  }

  // list all sessions
  async list(): Promise<SessionInfo[]> {
    await ensurePtyDaemon();
    const res = await sendCommand({ cmd: "list" });
    if (!res.ok) return [];
    return (res.sessions as SessionInfo[]) || [];
  }

  // get session info
  async info(name: string): Promise<SessionInfo | null> {
    try {
      const res = await sendCommand({ cmd: "info", name });
      if (!res.ok) return null;
      return res.info as SessionInfo;
    } catch {
      return null;
    }
  }

  // get child process pid
  async pid(name: string): Promise<number | null> {
    try {
      const res = await sendCommand({ cmd: "pid", name });
      if (!res.ok) return null;
      return res.pid as number;
    } catch {
      return null;
    }
  }

  // get daemon status
  async status(): Promise<DaemonStatus | null> {
    try {
      const res = await sendCommand({ cmd: "status" });
      if (!res.ok) return null;
      return res.status as DaemonStatus;
    } catch {
      return null;
    }
  }
}

// singleton
export const pty = new PtyClient();

// cached live sessions
let cachedSessions: Set<string> | null = null;
let cacheTime = 0;
const CACHE_TTL = 3000;

export async function getLiveSessions(): Promise<Set<string>> {
  const now = Date.now();
  if (cachedSessions && now - cacheTime < CACHE_TTL) {
    return cachedSessions;
  }

  try {
    const sessions = await pty.list();
    cachedSessions = new Set(
      sessions.filter((s) => s.alive).map((s) => s.name)
    );
  } catch {
    cachedSessions = new Set();
  }
  cacheTime = now;
  return cachedSessions;
}

// helper: list session names (string array, alive only)
export async function listSessionNames(): Promise<string[]> {
  const sessions = await getLiveSessions();
  return Array.from(sessions);
}

export type { SessionInfo, DaemonStatus };
