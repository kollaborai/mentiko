/**
 * Typed durable credentials and short-lived device-flow sidecars for the MCP bridge.
 *
 * The files live outside the static MCP client config so reconnect can update
 * credentials without client restart. Every path is derived from one root,
 * JSON is validated before consumers observe it, and writes publish by rename.
 */

import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export const WEB_URL = process.env.MENTIKO_WEB_URL || `http://127.0.0.1:${process.env.WEB_PORT || process.env.PORT || 3000}`;

export interface McpSessionPaths {
  directory: string;
  session: string;
  pendingDevice: string;
  uiControl: string;
  pendingUi: string;
}

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

export interface UiControlGrant {
  signaling_token: string;
  session_id: string;
  updatedAt?: number;
}

export interface PendingUi {
  device_code: string;
  user_code: string;
  verification_url: string;
}

export function resolveMcpSessionPaths(): McpSessionPaths {
  const globalRoot = process.env.MENTIKO_GLOBAL_ROOT
    ? resolve(process.env.MENTIKO_GLOBAL_ROOT)
    : join(homedir(), ".mentiko");
  const directory = join(globalRoot, "mcp");
  return {
    directory,
    session: join(directory, "session.json"),
    pendingDevice: join(directory, "pending-device.json"),
    uiControl: join(directory, "ui-control.json"),
    pendingUi: join(directory, "pending-ui.json"),
  };
}

export function readSidecar(): SidecarSession | null {
  return readTyped(resolveMcpSessionPaths().session, parseSidecar, "MCP session sidecar");
}

/** Invalid on-disk credentials are never trusted; callers may safely continue with another auth source. */
export function readSidecarForAuth(): SidecarSession | null {
  try {
    return readSidecar();
  } catch {
    return null;
  }
}

/** Preserve an existing refresh token when a caller only rotates session_token. */
export function writeSidecar(update: SidecarSession): SidecarSession {
  const paths = resolveMcpSessionPaths();
  const existing = readTyped(paths.session, parseSidecar, "MCP session sidecar") ?? {};
  const value = parseSidecar({ ...existing, ...update, updatedAt: Date.now() });
  writeTyped(paths.session, value);
  return value;
}

export function readPending(): PendingDevice | null {
  return readTyped(resolveMcpSessionPaths().pendingDevice, parsePending, "MCP pending device authorization");
}

export function writePending(value: PendingDevice): void {
  writeTyped(resolveMcpSessionPaths().pendingDevice, parsePending(value));
}

export function clearPending(): void {
  removeTyped(resolveMcpSessionPaths().pendingDevice);
}

export function readUiControl(): UiControlGrant | null {
  return readTyped(resolveMcpSessionPaths().uiControl, parseUiControl, "MCP UI-control grant");
}

export function writeUiControl(update: UiControlGrant): UiControlGrant {
  const paths = resolveMcpSessionPaths();
  const existing = readTyped(paths.uiControl, parseUiControl, "MCP UI-control grant") ?? {};
  const value = parseUiControl({ ...existing, ...update, updatedAt: Date.now() });
  writeTyped(paths.uiControl, value);
  return value;
}

export function clearUiControl(): void {
  removeTyped(resolveMcpSessionPaths().uiControl);
}

export function readPendingUi(): PendingUi | null {
  return readTyped(resolveMcpSessionPaths().pendingUi, parsePending, "MCP pending UI-control authorization");
}

export function writePendingUi(value: PendingUi): void {
  writeTyped(resolveMcpSessionPaths().pendingUi, parsePending(value));
}

export function clearPendingUi(): void {
  removeTyped(resolveMcpSessionPaths().pendingUi);
}

function readTyped<T>(path: string, parse: (value: unknown) => T, label: string): T | null {
  if (!fileExists(path)) return null;
  assertRegularFile(path, label);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`Invalid ${label}: ${path}`);
  }
  try {
    return parse(parsed);
  } catch {
    throw new Error(`Invalid ${label}: ${path}`);
  }
}

function writeTyped(path: string, value: object): void {
  const paths = resolveMcpSessionPaths();
  mkdirSync(paths.directory, { recursive: true, mode: 0o700 });
  chmodSync(paths.directory, 0o700);
  if (fileExists(path)) assertRegularFile(path, "MCP session sidecar");
  const temp = join(paths.directory, `.${path.split("/").pop()}.${process.pid}.${randomUUID()}.tmp`);
  writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  renameSync(temp, path);
  chmodSync(path, 0o600);
}

function removeTyped(path: string): void {
  if (!fileExists(path)) return;
  assertRegularFile(path, "MCP session sidecar");
  rmSync(path);
}

function assertRegularFile(path: string, label: string): void {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular file: ${path}`);
}

function fileExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function parseSidecar(value: unknown): SidecarSession {
  const record = objectRecord(value);
  const refreshToken = optionalSecret(record, "refresh_token");
  const sessionToken = optionalSecret(record, "session_token");
  if (!refreshToken && !sessionToken) throw new Error("sidecar must contain refresh_token or session_token");
  const updatedAt = optionalTimestamp(record, "updatedAt");
  return { ...(refreshToken ? { refresh_token: refreshToken } : {}), ...(sessionToken ? { session_token: sessionToken } : {}), ...(updatedAt ? { updatedAt } : {}) };
}

function parsePending(value: unknown): PendingDevice {
  const record = objectRecord(value);
  return {
    device_code: requiredString(record, "device_code"),
    user_code: requiredString(record, "user_code"),
    verification_url: requiredUrl(record, "verification_url"),
  };
}

function parseUiControl(value: unknown): UiControlGrant {
  const record = objectRecord(value);
  const updatedAt = optionalTimestamp(record, "updatedAt");
  return {
    signaling_token: requiredString(record, "signaling_token"),
    session_id: requiredString(record, "session_id"),
    ...(updatedAt ? { updatedAt } : {}),
  };
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected object");
  return value as Record<string, unknown>;
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const candidate = value[key];
  if (typeof candidate !== "string" || !candidate.trim()) throw new Error(`${key} is required`);
  return candidate;
}

function optionalSecret(value: Record<string, unknown>, key: string): string | undefined {
  const candidate = value[key];
  if (candidate === undefined) return undefined;
  return requiredString(value, key);
}

function optionalTimestamp(value: Record<string, unknown>, key: string): number | undefined {
  const candidate = value[key];
  if (candidate === undefined) return undefined;
  if (typeof candidate !== "number" || !Number.isSafeInteger(candidate) || candidate <= 0) throw new Error(`${key} must be a positive integer`);
  return candidate;
}

function requiredUrl(value: Record<string, unknown>, key: string): string {
  const raw = requiredString(value, key);
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("unsupported protocol");
    return raw;
  } catch {
    throw new Error(`${key} must be an http(s) URL`);
  }
}
