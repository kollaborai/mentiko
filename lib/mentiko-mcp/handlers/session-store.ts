/**
 * session-store: durable, runtime-readable credential storage for the bridge.
 *
 * The MCP session token used to be baked into the static MCP env config
 * (MENTIKO_SESSION_TOKEN in ~/.claude.json), which meant a re-auth required
 * hand-editing that file + a client restart. Instead we keep the credential in
 * a sidecar file the bridge reads at runtime and the reconnect flow rewrites:
 *
 *   ~/.mentiko/mcp/session.json        { refresh_token, session_token, updatedAt }
 *   ~/.mentiko/mcp/pending-device.json { device_code, user_code, verification_url }
 *
 * Precedence for the active access token: sidecar.session_token → env
 * MENTIKO_SESSION_TOKEN. After one device-flow reconnect the sidecar is the
 * source of truth, so the static config only needs MENTIKO_WEB_URL + SESSION_ID.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export const WEB_URL = process.env.MENTIKO_WEB_URL || `http://127.0.0.1:${process.env.WEB_PORT || process.env.PORT || 3000}`;

function mcpDir(): string {
  const root = process.env.MENTIKO_GLOBAL_ROOT || join(homedir(), ".mentiko");
  return join(root, "mcp");
}

const SESSION_FILE = () => join(mcpDir(), "session.json");
const PENDING_FILE = () => join(mcpDir(), "pending-device.json");

export interface SidecarSession {
  refresh_token?: string;
  session_token?: string;
  updatedAt?: number;
}

export interface PendingDevice {
  device_code: string;
  user_code: string;
  verification_url: string;
}

function readJson<T>(path: string): T | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(mcpDir(), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), { mode: 0o600 });
}

export function readSidecar(): SidecarSession | null {
  return readJson<SidecarSession>(SESSION_FILE());
}

export function writeSidecar(session: SidecarSession): void {
  writeJson(SESSION_FILE(), { ...session, updatedAt: nowMs() });
}

export function readPending(): PendingDevice | null {
  return readJson<PendingDevice>(PENDING_FILE());
}

export function writePending(p: PendingDevice): void {
  writeJson(PENDING_FILE(), p);
}

export function clearPending(): void {
  try {
    rmSync(PENDING_FILE(), { force: true });
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// UI-control grant (scoped signaling token + bound window sessionId), written
// by the request_ui_control flow and read at runtime by dispatch.ts.
//   ~/.mentiko/mcp/ui-control.json   { signaling_token, session_id, updatedAt }
//   ~/.mentiko/mcp/pending-ui.json   { device_code, user_code, verification_url }
// ---------------------------------------------------------------------------

const UI_CONTROL_FILE = () => join(mcpDir(), "ui-control.json");
const PENDING_UI_FILE = () => join(mcpDir(), "pending-ui.json");

export interface UiControlGrant {
  signaling_token?: string;
  session_id?: string;
  updatedAt?: number;
}

export interface PendingUi {
  device_code: string;
  user_code: string;
  verification_url: string;
}

export function readUiControl(): UiControlGrant | null {
  return readJson<UiControlGrant>(UI_CONTROL_FILE());
}

export function writeUiControl(grant: UiControlGrant): void {
  writeJson(UI_CONTROL_FILE(), { ...grant, updatedAt: nowMs() });
}

export function clearUiControl(): void {
  try {
    rmSync(UI_CONTROL_FILE(), { force: true });
  } catch {
    // ignore
  }
}

export function readPendingUi(): PendingUi | null {
  return readJson<PendingUi>(PENDING_UI_FILE());
}

export function writePendingUi(p: PendingUi): void {
  writeJson(PENDING_UI_FILE(), p);
}

export function clearPendingUi(): void {
  try {
    rmSync(PENDING_UI_FILE(), { force: true });
  } catch {
    // ignore
  }
}

// Date.now via an indirection so the rest of the bridge can stay testable.
function nowMs(): number {
  return Date.now();
}
