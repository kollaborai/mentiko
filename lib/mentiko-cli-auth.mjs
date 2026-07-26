#!/usr/bin/env node

/**
 * mentiko auth — device-authorization credential for the CLI.
 *
 * Shares one credential with the MCP bridge: both read and write
 * $MENTIKO_GLOBAL_ROOT/mcp/session.json (default ~/.mentiko/mcp/session.json).
 * The file format is the contract — see lib/mentiko-mcp/handlers/session-store.ts
 * (parseSidecar / writeTyped). Keep the shape, mode and atomic-rename identical
 * or the bridge will reject what this writes.
 *
 * ponytail: the sidecar read/write is duplicated from session-store.ts because
 * that lives inside the @mentiko/mentiko-mcp package and is bundled to dist.
 * Phase 1 of the CLI/ops convergence extracts one shared module; until then the
 * on-disk format is the only shared surface, so it is asserted by a test.
 *
 *   mentiko auth              start the flow, wait for approval, save
 *   mentiko auth status       show the current credential (no network)
 *   mentiko auth token        print a valid access token to stdout
 *   mentiko auth logout       remove the stored credential
 */

import { chmodSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

const args = process.argv.slice(2);
const sub = args[0] && !args[0].startsWith("--") ? args[0] : "login";

function flag(name, fallback) {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
}

// Resolved per call, not frozen at import: a long-lived process (and any test)
// must be able to see an updated MENTIKO_WEB_URL.
function webUrl() {
  return (
    flag("--web-url") ||
    process.env.MENTIKO_WEB_URL ||
    `http://127.0.0.1:${process.env.WEB_PORT || process.env.PORT || 3000}`
  ).replace(/\/+$/, "");
}

function die(message, code = 1) {
  console.error(`  error: ${message}`);
  process.exit(code);
}

// ---------------------------------------------------------------- sidecar

function paths() {
  const globalRoot = process.env.MENTIKO_GLOBAL_ROOT
    ? resolve(process.env.MENTIKO_GLOBAL_ROOT)
    : join(homedir(), ".mentiko");
  const directory = join(globalRoot, "mcp");
  return {
    directory,
    session: join(directory, "session.json"),
    pendingDevice: join(directory, "pending-device.json"),
  };
}

function assertRegularFile(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`must be a regular file: ${path}`);
}

function readJson(path) {
  try {
    assertRegularFile(path);
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    return null; // invalid on-disk credentials are never trusted
  }
}

// Mirrors session-store.ts writeTyped: 0700 dir, 0600 file, publish by rename.
function writeJson(path, value) {
  const p = paths();
  mkdirSync(p.directory, { recursive: true, mode: 0o700 });
  chmodSync(p.directory, 0o700);
  const temp = join(p.directory, `.${path.split("/").pop()}.${process.pid}.${randomUUID()}.tmp`);
  writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  renameSync(temp, path);
  chmodSync(path, 0o600);
}

function saveSession(update) {
  const p = paths();
  const existing = readJson(p.session) ?? {};
  const merged = { ...existing, ...update, updatedAt: Date.now() };
  if (!merged.refresh_token && !merged.session_token) {
    throw new Error("sidecar must contain refresh_token or session_token");
  }
  writeJson(p.session, merged);
  return merged;
}

// ---------------------------------------------------------------- claims

function claims(token) {
  try {
    const part = token.split(".")[1];
    return JSON.parse(Buffer.from(part + "=".repeat((4 - (part.length % 4)) % 4), "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function expired(token) {
  const c = claims(token);
  return !c?.exp || c.exp * 1000 <= Date.now();
}

// ---------------------------------------------------------------- network

async function post(path, body) {
  let res;
  try {
    res = await fetch(`${webUrl()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    die(`cannot reach ${webUrl()} — is the web process running?\n         ${error.message}`, 4);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  return { ok: res.ok, status: res.status, data };
}

async function pollOnce(deviceCode) {
  const res = await fetch(`${webUrl()}/api/mentiko-mcp/auth/device/poll?device_code=${encodeURIComponent(deviceCode)}`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- commands

async function login() {
  const start = await post("/api/mentiko-mcp/auth/device/start", { client_label: "mentiko CLI" });
  if (!start.ok) die(`device/start failed: ${start.status} ${JSON.stringify(start.data)}`, 4);

  const { device_code, user_code, verification_url, interval, expires_in } = start.data;
  writeJson(paths().pendingDevice, { device_code, user_code, verification_url });

  console.log("");
  console.log("  Authorize this CLI in the Mentiko app:");
  console.log("");
  console.log(`    ${verification_url}`);
  console.log("");
  console.log(`  Confirm the code shown there matches:  ${user_code}`);
  console.log("");
  process.stdout.write("  waiting for approval");

  const deadline = Date.now() + (expires_in || 600) * 1000;
  const every = Math.max(1, interval || 3) * 1000;
  while (Date.now() < deadline) {
    await sleep(every);
    process.stdout.write(".");
    const result = await pollOnce(device_code);
    if (result.status === "approved") {
      saveSession({ refresh_token: result.refresh_token, session_token: result.session_token });
      try { rmSync(paths().pendingDevice); } catch { /* already gone */ }
      const c = claims(result.session_token);
      console.log("\n");
      console.log(`  Connected. namespace=${c?.ns ?? "?"} org=${c?.org ?? "?"}`);
      console.log(`  Credential: ${paths().session} (0600)`);
      return;
    }
    if (result.status === "denied")  { console.log(""); die("authorization denied", 5); }
    if (result.status === "expired") { console.log(""); die("code expired — run `mentiko auth` again", 5); }
  }
  console.log("");
  die("timed out waiting for approval — run `mentiko auth` again", 5);
}

async function token() {
  const sc = readJson(paths().session);
  if (!sc) die("not authenticated — run `mentiko auth`", 3);

  if (sc.session_token && !expired(sc.session_token)) {
    console.log(sc.session_token);
    return;
  }
  if (!sc.refresh_token) die("access token expired and no refresh token — run `mentiko auth`", 3);

  const res = await post("/api/mentiko-mcp/auth/token", { refresh_token: sc.refresh_token });
  if (!res.ok || !res.data.session_token) {
    die("refresh rejected — run `mentiko auth` to re-authorize", 3);
  }
  saveSession({ session_token: res.data.session_token });
  console.log(res.data.session_token);
}

function status() {
  const p = paths();
  const sc = readJson(p.session);
  if (!sc) {
    console.log("  not authenticated");
    console.log(`  run: mentiko auth   (web url: ${webUrl()})`);
    process.exit(3);
  }
  const c = sc.session_token ? claims(sc.session_token) : null;
  console.log(`  credential:   ${p.session}`);
  console.log(`  web url:      ${webUrl()}`);
  console.log(`  subject:      ${c?.sub ?? "unknown"}`);
  console.log(`  namespace:    ${c?.ns ?? "unknown"}   org: ${c?.org ?? "unknown"}`);
  if (c?.scopes?.length) console.log(`  scopes:       ${c.scopes.join(", ")}`);
  if (c?.exp) {
    const left = c.exp * 1000 - Date.now();
    console.log(
      left > 0
        ? `  access token: valid ${(left / 3600000).toFixed(1)}h`
        : `  access token: EXPIRED ${(-left / 3600000).toFixed(1)}h ago${sc.refresh_token ? " (will refresh on use)" : ""}`,
    );
  }
  console.log(`  refresh:      ${sc.refresh_token ? "present" : "absent"}`);
}

function logout() {
  const p = paths();
  let removed = 0;
  for (const target of [p.session, p.pendingDevice]) {
    try { assertRegularFile(target); rmSync(target); removed++; } catch { /* absent */ }
  }
  console.log(removed ? "  credential removed" : "  nothing to remove");
}

// ---------------------------------------------------------------- shared

/**
 * The credential precedence every CLI entrypoint must use, matching
 * lib/mentiko-mcp/handlers/ops-client.ts:27 — an explicitly injected token wins
 * (agent runs, CI), then the stored credential, refreshed on the spot if the
 * access token has expired. Returns "" when there is no usable credential; the
 * caller decides how to fail.
 */
export async function resolveToken() {
  const injected = (process.env.MENTIKO_SESSION_TOKEN || "").trim();
  if (injected) return injected;

  const sc = readJson(paths().session);
  if (!sc) return "";
  if (sc.session_token && !expired(sc.session_token)) return sc.session_token;
  if (!sc.refresh_token) return "";

  const res = await post("/api/mentiko-mcp/auth/token", { refresh_token: sc.refresh_token });
  if (!res.ok || !res.data.session_token) return "";
  saveSession({ session_token: res.data.session_token });
  return res.data.session_token;
}

/**
 * Force a new access token from the stored refresh token, ignoring the cached
 * one's expiry. A 401 on a token that has not expired means the server rejected
 * it anyway (revoked, secret rotated), so the expiry check in resolveToken
 * cannot recover it — only a forced exchange can.
 */
async function refreshAccessToken() {
  const sc = readJson(paths().session);
  if (!sc?.refresh_token) return "";
  const res = await post("/api/mentiko-mcp/auth/token", { refresh_token: sc.refresh_token });
  if (!res.ok || !res.data.session_token) return "";
  saveSession({ session_token: res.data.session_token });
  return res.data.session_token;
}

export class OpsError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = "OpsError";
    this.status = status;
    this.body = body;
  }
}

/**
 * The one HTTP boundary for CLI commands that talk to /api/mentiko-mcp/ops/*.
 * Mirrors lib/mentiko-mcp/handlers/ops-client.ts: bearer auth, a bounded
 * timeout, and exactly one forced-refresh retry on 401. Callers get parsed JSON
 * or an OpsError — never a bare fetch failure.
 *
 * ponytail: this duplicates ops-client.ts because that file lives inside the
 * @mentiko/mentiko-mcp package and is bundled to dist. Phase 1b of
 * docs/specs/CLI_OPS_CONVERGENCE.md merges them once the package boundary moves.
 */
export async function opsRequest(method, path, { body, query, timeoutMs = 15000 } = {}) {
  let token = await resolveToken();
  if (!token) throw new OpsError("not authenticated - run `mentiko auth`", { status: 401 });

  const url = new URL(`${webUrl()}${path}`);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  const send = async (bearer) => {
    try {
      return await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bearer}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error?.name === "TimeoutError" || error?.name === "AbortError") {
        throw new OpsError(`${method} ${path} timed out after ${timeoutMs}ms`);
      }
      throw new OpsError(`cannot reach ${webUrl()} — is the web process running? (${error.message})`);
    }
  };

  let res = await send(token);
  if (res.status === 401) {
    const fresh = await refreshAccessToken();
    // Only retry with a genuinely different token; retrying the same one just
    // burns a second round trip to get the same 401.
    if (fresh && fresh !== token) {
      token = fresh;
      res = await send(token);
    }
  }

  const text = await res.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new OpsError(`${method} ${path} returned non-JSON (${res.status})`, { status: res.status, body: text });
    }
  }
  if (!res.ok) {
    throw new OpsError(`${method} ${path} failed: ${res.status} ${text}`, { status: res.status, body: data });
  }
  return data;
}

export { webUrl };

// ---------------------------------------------------------------- dispatch

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const commands = { login, token, status, logout };
  if (!commands[sub]) {
    console.error("usage: mentiko auth [status|token|logout] [--web-url <url>]");
    process.exit(2);
  }
  await commands[sub]();
}
