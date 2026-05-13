#!/usr/bin/env npx tsx
/**
 * ws-terminal.ts - WebSocket bridge between browser and pty-manager daemon
 *
 * Standalone process (NOT inside Next.js) because Next.js API routes
 * can't hold persistent WebSocket connections.
 *
 * Protocol:
 *   Browser connects via WebSocket to ws://localhost:3099
 *   Sends JSON messages:
 *     { type: "attach", session: "agent-name" }   - attach to a PTY session
 *     { type: "input",  data: "keystroke" }        - forward input to PTY
 *     { type: "resize", cols: 120, rows: 40 }      - resize terminal
 *     { type: "detach" }                            - detach from session
 *
 *   Receives JSON messages:
 *     { type: "attached", cols: 200, rows: 50 }    - attach confirmed
 *     { type: "data", data: "terminal output..." }  - PTY output chunk
 *     { type: "activity", data: {...} }              - activity event (active|idle)
 *     { type: "exit" }                                - session exited
 *     { type: "error", message: "..." }             - error
 *
 * Usage:
 *   npx tsx web/server/ws-terminal.ts
 *   # or add to package.json scripts:
 *   #   "ws:terminal": "tsx server/ws-terminal.ts"
 */

import { WebSocketServer, WebSocket } from "ws";
import { createConnection, Socket } from "net";
import { homedir } from "os";
import { join } from "path";
import { createServer, IncomingMessage } from "http";
import { randomBytes } from "crypto";
import { writeFileSync, mkdirSync, unlinkSync, readFileSync, readdirSync, statSync } from "fs";

const WS_PORT = parseInt(process.env.WS_TERMINAL_PORT || "3099", 10);
const DAEMON_NAME = process.env.PTY_DAEMON || "default";
const SOCKET_PATH = join(homedir(), ".pty-manager", `${DAEMON_NAME}.sock`);
const TOKEN_PATH = join(homedir(), ".pty-manager", "ws-token");

// localhost defaults cover `npm run dev` directly. Anything else (including
// docker with remapped host ports) gets added below from BETTER_AUTH_URL.
const ALLOWED_ORIGINS = new Set<string>([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  `http://localhost:${WS_PORT}`,
  `http://127.0.0.1:${WS_PORT}`,
]);

// Auto-allow the operator's public URL. BETTER_AUTH_URL is required
// configuration anyway (cookie domain), so this avoids forcing operators
// to also set WS_ALLOWED_ORIGINS just to whitelist their own public host.
try {
  const u = new URL(process.env.BETTER_AUTH_URL || "");
  if (u.origin) ALLOWED_ORIGINS.add(u.origin);
} catch {}

// extra origins for self-hosted deployments:
//   WS_ALLOWED_ORIGINS="https://app.example.com,https://*.example.com"
// each entry is either an exact origin or a wildcard host pattern (one leading *).
const EXTRA_ALLOWED = (process.env.WS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const IS_PRODUCTION = process.env.NODE_ENV === "production";

function matchesPattern(originUrl: URL, pattern: string): boolean {
  try {
    if (pattern.includes("://")) {
      // protocol-qualified pattern; pattern may contain a wildcard host like
      // https://*.example.com — URL() can't parse that, so split protocol off.
      const sep = pattern.indexOf("://");
      const proto = pattern.slice(0, sep + 1);
      const rest = pattern.slice(sep + 3);
      if (originUrl.protocol !== proto) return false;
      return hostMatches(originUrl.hostname, rest);
    }
    return hostMatches(originUrl.hostname, pattern);
  } catch {
    return false;
  }
}

function hostMatches(hostname: string, pattern: string): boolean {
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(1); // ".example.com"
    return (
      hostname === suffix.slice(1) || hostname.endsWith(suffix)
    );
  }
  return hostname === pattern;
}

// Token auth (single-use, short TTL) is the primary security control.
// Origin checks add defense-in-depth against CSRF-style attacks that
// reuse a leaked token from a browser context.
//
//   * empty Origin: allowed in dev (curl, server-to-server), rejected in prod
//   * exact match in ALLOWED_ORIGINS: allowed
//   * matches one of WS_ALLOWED_ORIGINS (env): allowed
function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return !IS_PRODUCTION;
  }
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const url = new URL(origin);
    for (const pattern of EXTRA_ALLOWED) {
      if (matchesPattern(url, pattern)) return true;
    }
  } catch {}
  return false;
}

// per-user connection tokens (single-use, short TTL)
// Map<token, { userId, expiresAt }>
const pendingTokens = new Map<string, { userId: string; expiresAt: number }>();
const USER_TOKEN_TTL_MS = 60 * 1000; // 60 seconds - single-use, consumed on connect

// check if per-user token is valid (single-use, consumed immediately)
function verifyAndConsumeUserToken(token: string): { userId: string } | null {
  const data = pendingTokens.get(token);
  if (!data) {
    console.log(`[ws-terminal] token verification failed: token not found in pendingTokens (${pendingTokens.size} pending)`);
    return null; // token not found
  }

  // check expiration
  if (Date.now() > data.expiresAt) {
    pendingTokens.delete(token);
    console.log(`[ws-terminal] token verification failed: expired for user ${data.userId}`);
    return null; // token expired
  }

  // consume token immediately - single use only
  pendingTokens.delete(token);
  console.log(`[ws-terminal] token consumed: ${token.slice(0, 8)}...`);

  return { userId: data.userId };
}

// register a new per-user token (called by Next.js via IPC)
function registerUserToken(userId: string, token: string): void {
  pendingTokens.set(token, {
    userId,
    expiresAt: Date.now() + USER_TOKEN_TTL_MS,
  });
}

// cleanup expired tokens periodically
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of pendingTokens.entries()) {
    if (now > data.expiresAt) {
      pendingTokens.delete(token);
    }
  }
}, 60 * 1000); // every minute

// watch for pending token registration files from Next.js
// Next.js writes token files to ~/.pty-manager/ws-token-register-{random}.json
// format: { userId, token }
// uses rename-after-write: temp .tmp-* files ignored, only complete files scanned
const TOKEN_REGISTER_DIR = join(homedir(), ".pty-manager");
const TOKEN_REGISTER_PATTERN = /^ws-token-register-.+\.json$/;
const TOKEN_TEMP_PATTERN = /^\.tmp-.+\.json$/; // ignore temp files (rename-after-write)

function scanTokenRegistrations() {
  try {
    const files = readdirSync(TOKEN_REGISTER_DIR);
    const now = Date.now();

    for (const file of files) {
      // skip temp files (rename-after-write pattern) and non-matching files
      if (!TOKEN_REGISTER_PATTERN.test(file) || TOKEN_TEMP_PATTERN.test(file)) continue;

      const filePath = join(TOKEN_REGISTER_DIR, file);
      try {
        // check file age - skip files created < 50ms ago (write might not be flushed)
        const stats = statSync(filePath);
        if (now - stats.mtimeMs < 50) {
          continue; // too new, wait for next scan
        }

        const content = readFileSync(filePath, "utf-8");
        const data = JSON.parse(content) as { userId: string; token: string };
        if (data.userId && data.token) {
          registerUserToken(data.userId, data.token);
          console.log(`[ws-terminal] registered token for user ${data.userId}`);
        }
        unlinkSync(filePath); // delete after processing
      } catch (err) {
        // failed to read or parse - skip and retry on next scan
        // only log if it's not a "too new" file (ENOENT on stat is fine, means it's being written)
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          console.error(`[ws-terminal] failed to process token file ${file}:`, err);
        }
      }
    }
  } catch {
    // dir doesn't exist or can't read, ignore
  }
}

// scan for new tokens every 200ms
setInterval(() => {
  const beforeCount = pendingTokens.size;
  scanTokenRegistrations();
  if (pendingTokens.size !== beforeCount) {
    console.log(`[ws-terminal] tokens: ${beforeCount} -> ${pendingTokens.size}`);
  }
}, 200);

// initial scan on startup
scanTokenRegistrations();

// server auth token - used for internal API communication only
const SERVER_AUTH_TOKEN = process.env.WS_TERMINAL_TOKEN || randomBytes(32).toString("hex");

// rate limiting: max messages per second per connection
const RATE_LIMIT = 120; // ~2 per frame at 60fps, generous for typing
const RATE_WINDOW_MS = 1000;

// input size limit (single message)
const MAX_INPUT_SIZE = 4096;

// max concurrent connections
const MAX_CONNECTIONS = 20;

// session name validation
const SESSION_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9\-_]{0,99}$/;

interface AttachState {
  session: string;
  daemonConn: Socket;
}

interface RateState {
  count: number;
  windowStart: number;
}

function checkRate(state: RateState): boolean {
  const now = Date.now();
  if (now - state.windowStart > RATE_WINDOW_MS) {
    state.count = 1;
    state.windowStart = now;
    return true;
  }
  state.count++;
  return state.count <= RATE_LIMIT;
}

function createBridge() {
  // In containers, 127.0.0.1 is unreachable via podman/docker port mapping
  // (port mapping connects to the container's veth, not loopback).
  // Use 0.0.0.0 so port forwarding works. Token auth protects the endpoint.
  const BIND_HOST = process.env.WS_TERMINAL_BIND || "0.0.0.0";
  const httpServer = createServer();
  httpServer.listen(WS_PORT, BIND_HOST);

  const wss = new WebSocketServer({
    server: httpServer,
    verifyClient: ({ origin, req }: { origin?: string; req: IncomingMessage }) => {
      // origin check
      if (!isAllowedOrigin(origin)) {
        console.log(`[ws-terminal] rejected: invalid origin "${origin}"`);
        return false;
      }

      // token check via query param (per-user single-use token OR server auth token)
      const url = new URL(req.url || "/", `http://localhost:${WS_PORT}`);
      const token = url.searchParams.get("token");
      if (!token) {
        console.log(`[ws-terminal] rejected: missing token`);
        return false;
      }

      // check if it's a server auth token (internal API communication)
      if (token === SERVER_AUTH_TOKEN) {
        return true;
      }

      // check if it's a per-user token
      const userToken = verifyAndConsumeUserToken(token);
      if (!userToken) {
        console.log(`[ws-terminal] rejected: invalid or expired user token`);
        return false;
      }

      // attach userId to request for later use in connection handler
      (req as unknown as Record<string, unknown>).userId = userToken.userId;

      // connection limit
      if (wss.clients.size >= MAX_CONNECTIONS) {
        console.log(`[ws-terminal] rejected: max connections (${MAX_CONNECTIONS}) reached`);
        return false;
      }

      return true;
    },
  });

  httpServer.on("listening", () => {
    // write server auth token file for internal API communication
    try {
      mkdirSync(join(homedir(), ".pty-manager"), { recursive: true, mode: 0o700 });
      writeFileSync(TOKEN_PATH, SERVER_AUTH_TOKEN, { mode: 0o600 });
    } catch {}
    console.log(`ws-terminal bridge listening on ws://${BIND_HOST}:${WS_PORT}`);
    console.log(`server auth token written to ${TOKEN_PATH} (for internal API only)`);
    console.log(`pty-manager socket: ${SOCKET_PATH}`);
    console.log(`per-user tokens: single-use, ${USER_TOKEN_TTL_MS / 1000}s TTL`);
  });

  // ping all clients every 2min to keep connections alive through NAT/firewalls/app nap
  const PING_INTERVAL_MS = 120_000;
  const pingInterval = setInterval(() => {
    for (const client of wss.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      const alive = (client as WebSocket & { _wsAlive?: boolean })._wsAlive;
      if (alive === false) {
        // missed last pong, terminate
        client.terminate();
        continue;
      }
      (client as WebSocket & { _wsAlive?: boolean })._wsAlive = false;
      client.ping();
    }
  }, PING_INTERVAL_MS);

  wss.on("close", () => clearInterval(pingInterval));

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const clientIp = req.socket.remoteAddress;
    const userId = (req as unknown as Record<string, unknown>).userId as string | undefined;
    const timestamp = new Date().toISOString();
    console.log(`[ws-terminal] connected: ${clientIp} (user: ${userId || "server"}) at ${timestamp} (total: ${wss.clients.size})`);

    // mark alive for ping/pong keepalive
    (ws as WebSocket & { _wsAlive?: boolean })._wsAlive = true;
    ws.on("pong", () => { (ws as WebSocket & { _wsAlive?: boolean })._wsAlive = true; });

    let attach: AttachState | null = null;
    const rate: RateState = { count: 0, windowStart: Date.now() };

    ws.on("message", (raw: Buffer | string) => {
      // rate limiting
      if (!checkRate(rate)) {
        ws.send(JSON.stringify({ type: "error", message: "rate limit exceeded" }));
        return;
      }

      const rawStr = raw.toString();
      // message size limit
      if (rawStr.length > MAX_INPUT_SIZE) {
        ws.send(JSON.stringify({ type: "error", message: "message too large" }));
        return;
      }

      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(rawStr);
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "invalid json" }));
        return;
      }

      switch (msg.type) {
        case "attach": {
          const sessionName = String(msg.session || "");
          if (!SESSION_NAME_RE.test(sessionName)) {
            ws.send(JSON.stringify({ type: "error", message: "invalid session name" }));
            return;
          }
          const cols = typeof msg.cols === "number" ? msg.cols : undefined;
          const rows = typeof msg.rows === "number" ? msg.rows : undefined;
          const doAttach = () => {
            handleAttach(ws, sessionName, (state) => {
              attach = state;
            });
          };
          // resize PTY before attach so initial capture matches browser size
          if (cols && rows) {
            sendDaemonCommand(
              { cmd: "resize", name: sessionName, args: { cols, rows } },
              doAttach
            );
          } else {
            doAttach();
          }
          break;
        }

        case "input":
          if (attach && typeof msg.data === "string" && msg.data.length <= MAX_INPUT_SIZE) {
            try {
              attach.daemonConn.write(msg.data);
            } catch {
              // connection may have closed
            }
          }
          break;

        case "resize":
          if (
            attach &&
            typeof msg.cols === "number" &&
            typeof msg.rows === "number"
          ) {
            sendDaemonCommand({
              cmd: "resize",
              name: attach.session,
              args: { cols: msg.cols, rows: msg.rows },
            });
          }
          break;

        case "detach":
          if (attach) {
            attach.daemonConn.destroy();
            attach = null;
            ws.send(JSON.stringify({ type: "detached" }));
          }
          break;

        default:
          ws.send(
            JSON.stringify({ type: "error", message: "unknown message type" })
          );
      }
    });

    ws.on("close", () => {
      const timestamp = new Date().toISOString();
      console.log(`[ws-terminal] disconnected at ${timestamp} (remaining: ${wss.clients.size - 1})`);
      if (attach) {
        attach.daemonConn.destroy();
        attach = null;
      }
    });

    ws.on("error", () => {
      if (attach) {
        attach.daemonConn.destroy();
        attach = null;
      }
    });
  });

  return { wss, http: httpServer };
}

/** send a command to the daemon via ephemeral socket */
function sendDaemonCommand(
  cmd: Record<string, unknown>,
  callback?: () => void
) {
  const conn = createConnection(SOCKET_PATH);
  conn.on("connect", () => {
    conn.write(JSON.stringify(cmd) + "\n");
  });
  conn.on("data", () => {
    conn.destroy();
    callback?.();
  });
  conn.on("error", () => {
    callback?.();
  });
  conn.setTimeout(5000, () => {
    conn.destroy();
    callback?.();
  });
}

function handleAttach(
  ws: WebSocket,
  session: string,
  onAttach: (state: AttachState) => void
) {
  if (!session) {
    ws.send(JSON.stringify({ type: "error", message: "session name required" }));
    return;
  }

  const conn = createConnection(SOCKET_PATH);
  let gotAck = false;
  let headerBuf = "";

  conn.on("error", (err: NodeJS.ErrnoException) => {
    const message =
      err.code === "ENOENT" || err.code === "ECONNREFUSED"
        ? "pty-manager daemon not running"
        : err.message;
    ws.send(JSON.stringify({ type: "error", message }));
  });

  conn.on("connect", () => {
    // send attach request to daemon
    conn.write(JSON.stringify({ cmd: "attach", name: session }) + "\n");
  });

  conn.on("data", (data: Buffer) => {
    if (!gotAck) {
      // first message is JSON ack with terminal size, terminated by \n
      headerBuf += data.toString();
      const nl = headerBuf.indexOf("\n");
      if (nl === -1) return; // wait for full ack

      const ackLine = headerBuf.slice(0, nl);
      const remainder = headerBuf.slice(nl + 1);

      try {
        const ack = JSON.parse(ackLine);
        if (!ack.ok) {
          ws.send(
            JSON.stringify({
              type: "error",
              message: ack.error || "attach failed",
            })
          );
          conn.destroy();
          return;
        }

        gotAck = true;
        onAttach({ session, daemonConn: conn });

        // tell browser we're attached, with terminal dimensions
        ws.send(
          JSON.stringify({
            type: "attached",
            cols: ack.cols || 200,
            rows: ack.rows || 50,
          })
        );

        // forward any remaining data after the ack line
        // initial capture is plain text (\n only), convert to \r\n for xterm
        if (remainder.length > 0) {
          if (ws.readyState === WebSocket.OPEN) {
            const captureData = remainder.replace(/(?<!\r)\n/g, "\r\n");
            ws.send(JSON.stringify({ type: "data", data: captureData }));
          }
        }
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "invalid ack from daemon" }));
        conn.destroy();
      }
      return;
    }

    // streaming mode: split out ACTIVITY: messages from PTY data
    // PTY output already has proper \r\n - don't convert (corrupts ANSI escapes)
    const str = data.toString("utf-8");

    // ACTIVITY: messages are newline-delimited: "ACTIVITY:{json}\n"
    // split chunks on that boundary, forward PTY data and activity separately
    let remaining = str;
    while (remaining.length > 0) {
      const actIdx = remaining.indexOf("ACTIVITY:");
      if (actIdx === -1) {
        // no more activity messages, rest is PTY output
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "data", data: remaining }));
        }
        break;
      }

      // send any PTY data before the activity marker
      if (actIdx > 0) {
        const ptyData = remaining.slice(0, actIdx);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "data", data: ptyData }));
        }
      }

      // find end of activity JSON (newline-terminated)
      const afterMarker = remaining.slice(actIdx + 9);
      const nlIdx = afterMarker.indexOf("\n");
      const activityStr = nlIdx !== -1 ? afterMarker.slice(0, nlIdx) : afterMarker;

      try {
        const activity = JSON.parse(activityStr);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "activity", data: activity }));
        }
      } catch {
        // malformed activity, forward as data
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "data", data: `ACTIVITY:${activityStr}` }));
        }
      }

      remaining = nlIdx !== -1 ? afterMarker.slice(nlIdx + 1) : "";
    }
  });

  conn.on("close", () => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "exit" }));
    }
  });

  conn.on("end", () => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "exit" }));
    }
  });
}

// --- main ---

const { wss, http } = createBridge();

// graceful shutdown
const shutdown = () => {
  console.log("\nshutting down ws-terminal bridge...");
  wss.clients.forEach((c: WebSocket) => c.close());
  wss.close();
  http.close();
  try { unlinkSync(TOKEN_PATH); } catch {}
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
