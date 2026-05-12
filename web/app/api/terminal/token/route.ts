import { NextRequest } from "next/server";
import { join } from "path";
import { createConnection } from "net";
import { randomBytes } from "crypto";
import { writeFileSync, readFileSync, mkdirSync, renameSync, existsSync, unlinkSync } from "fs";
import { homedir } from "os";
import config from "@/lib/config";
import { getSessionUser } from "@/lib/auth-bridge";
import { Unauthorized, ServiceUnavailable } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

const WS_PORT = parseInt(process.env.WS_TERMINAL_PORT || "3099", 10);
const WS_HOST = process.env.WS_TERMINAL_HOST || "127.0.0.1";
const PTY_DIR = config.ptyManagerDir || join(homedir(), ".pty-manager");
const STATIC_TOKEN_PATH = join(PTY_DIR, "ws-token");

function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const conn = createConnection({ port, host: WS_HOST });
    conn.setTimeout(500);
    conn.on("connect", () => { conn.destroy(); resolve(true); });
    conn.on("error", () => resolve(false));
    conn.on("timeout", () => { conn.destroy(); resolve(false); });
  });
}

/**
 * fallback: read the static ws-token file written by old ws-terminal.
 * returns the token string or null if the file doesn't exist / is empty.
 */
function readStaticToken(): string | null {
  try {
    if (!existsSync(STATIC_TOKEN_PATH)) return null;
    const raw = readFileSync(STATIC_TOKEN_PATH, "utf-8").trim();
    return raw || null;
  } catch {
    return null;
  }
}

/**
 * try per-user token registration (new ws-terminal with scanner).
 * returns the token string on success, null if scanner didn't respond.
 */
async function tryPerUserRegistration(userId: string): Promise<string | null> {
  const token = randomBytes(32).toString("hex");

  const registerFileName = `ws-token-register-${token.slice(0, 16)}.json`;
  const registerPath = join(PTY_DIR, registerFileName);
  const tempFileName = `.tmp-${randomBytes(8).toString("hex")}.json`;
  const tempPath = join(PTY_DIR, tempFileName);

  try {
    mkdirSync(PTY_DIR, { recursive: true, mode: 0o700 });

    // write to temp file first (scanner ignores .tmp-* files)
    writeFileSync(tempPath, JSON.stringify({ userId, token }), { mode: 0o600 });

    // atomic rename - scanner will see and process it
    renameSync(tempPath, registerPath);

    // verify scanner processed the token (file deletion = success signal)
    const MAX_WAIT_MS = 500;
    const CHECK_INTERVAL_MS = 100;
    const checks = Math.ceil(MAX_WAIT_MS / CHECK_INTERVAL_MS);

    for (let i = 0; i < checks; i++) {
      await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL_MS));

      if (!existsSync(registerPath)) {
        return token;
      }
    }

    // scanner didn't pick it up - clean up orphaned file
    try { unlinkSync(registerPath); } catch {}
    return null;

  } catch {
    // clean up temp file if rename failed
    try { if (existsSync(tempPath)) unlinkSync(tempPath); } catch {}
    return null;
  }
}

export const GET = withErrorHandling(async (req: NextRequest) => {
  const user = await getSessionUser(req);
  if (!user) {
    throw new Unauthorized();
  }

  // check if ws-terminal is running
  const alive = await checkPort(WS_PORT);
  if (!alive) {
    throw new ServiceUnavailable("ws-terminal not running");
  }

  // 1. try new per-user token registration (scanner-based)
  const perUserToken = await tryPerUserRegistration(user.id);
  if (perUserToken) {
    return apiSuccess({ token: perUserToken });
  }

  // 2. fallback: read static ws-token file (old ws-terminal compat)
  const staticToken = readStaticToken();
  if (staticToken) {
    return apiSuccess({ token: staticToken });
  }

  throw new ServiceUnavailable(
    "ws-terminal token registration failed and no static ws-token file found"
  );
});
