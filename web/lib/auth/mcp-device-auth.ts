/**
 * mcp-device-auth: device-authorization flow + long-lived refresh tokens for
 * standalone MCP clients (e.g. Claude Code wired as the `mentiko` MCP server).
 *
 * Why this exists: a standalone MCP client holds only an access JWT
 * (MENTIKO_SESSION_TOKEN). When it expires (24h) or is invalidated (secret
 * rotation), there is no engine to refresh against, so the 401 is terminal.
 * This module lets the client (a) bootstrap a revocable refresh token via a
 * browser-approved device flow, then (b) silently exchange it for fresh 24h
 * access tokens — closing the gap the kollab-engine refresh path leaves open.
 *
 * Storage: two SQLite tables in the shared auth db (getDb()), created on demand
 * like refresh-rate-limiter. Only hashes of secrets are stored. The device row
 * holds the issued tokens in a single-use pickup slot, cleared on first poll.
 *
 * See docs/specs/MCP_AUTH_RECOVERY.md.
 */

import { randomBytes, createHash } from "crypto";
import { getDb } from "@/lib/auth/auth-server";
import { mintSessionToken } from "@/lib/auth/session-token";
import type { OrgRole } from "@/lib/orgs/org-types";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export const DEVICE_CODE_TTL_MS = 10 * 60 * 1000; // 10 min
export const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90d (D4)
export const ACCESS_TTL_SECONDS = 86400; // 24h — matches mintSessionToken
export const POLL_INTERVAL_SECONDS = 3;
export const DEFAULT_SCOPES = ["ops:*"]; // D2 — surfaced on the approve page

// Crockford-ish base32 without ambiguous chars (no I/L/O/U/0/1).
const USER_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

let tablesCreated = false;

function ensureTables(db: Db): void {
  if (tablesCreated) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_device_code (
      device_code_hash TEXT PRIMARY KEY,
      user_code        TEXT NOT NULL UNIQUE,
      status           TEXT NOT NULL,          -- pending | approved | denied | consumed
      client_label     TEXT,
      scopes           TEXT NOT NULL,          -- json array
      user_id          TEXT,
      refresh_token_id TEXT,
      pickup_refresh   TEXT,                   -- raw refresh token, delivered once then nulled
      pickup_session   TEXT,                   -- raw access token, delivered once then nulled
      created_at       INTEGER NOT NULL,
      expires_at       INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mcp_refresh_token (
      id           TEXT PRIMARY KEY,
      token_hash   TEXT NOT NULL UNIQUE,
      user_id      TEXT NOT NULL,
      ns           TEXT NOT NULL,
      org          TEXT NOT NULL,
      role         TEXT,
      scopes       TEXT NOT NULL,              -- json array
      session_id   TEXT NOT NULL,              -- stable jti for minted access tokens
      label        TEXT,
      created_at   INTEGER NOT NULL,
      last_used_at INTEGER,
      expires_at   INTEGER NOT NULL,
      revoked_at   INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_mcp_refresh_user ON mcp_refresh_token(user_id);
  `);
  tablesCreated = true;
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function genUserCode(): string {
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += USER_CODE_ALPHABET[bytes[i] % USER_CODE_ALPHABET.length];
    if (i === 3) out += "-"; // XXXX-XXXX
  }
  return out;
}

function genId(): string {
  return randomBytes(16).toString("hex");
}

// ---------------------------------------------------------------------------
// Device flow
// ---------------------------------------------------------------------------

export interface DeviceStart {
  device_code: string;
  user_code: string;
  verification_url: string;
  interval: number;
  expires_in: number;
}

/**
 * Start a device-authorization request. Returns the secret `device_code` (the
 * client polls with this), a human `user_code`, and a verification URL.
 */
export async function createDeviceCode(opts: {
  verificationBase: string; // e.g. https://tenant.mentiko.com
  clientLabel?: string;
  scopes?: string[];
}): Promise<DeviceStart | null> {
  const db = await getDb();
  if (!db) return null;
  ensureTables(db);

  const deviceCode = randomBytes(32).toString("hex");
  const userCode = genUserCode();
  const now = Date.now();
  const scopes = opts.scopes && opts.scopes.length ? opts.scopes : DEFAULT_SCOPES;

  db.prepare(
    `INSERT INTO mcp_device_code
       (device_code_hash, user_code, status, client_label, scopes, created_at, expires_at)
     VALUES (?, ?, 'pending', ?, ?, ?, ?)`,
  ).run(
    sha256(deviceCode),
    userCode,
    opts.clientLabel ?? "MCP client",
    JSON.stringify(scopes),
    now,
    now + DEVICE_CODE_TTL_MS,
  );

  const base = opts.verificationBase.replace(/\/+$/, "");
  return {
    device_code: deviceCode,
    user_code: userCode,
    verification_url: `${base}/mcp-auth?code=${encodeURIComponent(userCode)}`,
    interval: POLL_INTERVAL_SECONDS,
    expires_in: Math.floor(DEVICE_CODE_TTL_MS / 1000),
  };
}

export type PollStatus = "pending" | "approved" | "denied" | "expired";

export interface PollResult {
  status: PollStatus;
  refresh_token?: string;
  session_token?: string;
}

/**
 * Poll a device code. On approval, returns the issued tokens exactly once
 * (pickup slot is cleared and the row marked consumed).
 */
export async function pollDeviceCode(deviceCode: string): Promise<PollResult> {
  const db = await getDb();
  if (!db) return { status: "expired" };
  ensureTables(db);

  const row = db
    .prepare(
      `SELECT status, pickup_refresh, pickup_session, expires_at
         FROM mcp_device_code WHERE device_code_hash = ?`,
    )
    .get(sha256(deviceCode)) as
    | { status: string; pickup_refresh: string | null; pickup_session: string | null; expires_at: number }
    | undefined;

  if (!row) return { status: "expired" };
  if (row.status === "denied") return { status: "denied" };
  if (Date.now() > row.expires_at && row.status !== "approved") {
    return { status: "expired" };
  }

  if (row.status === "approved" && row.pickup_refresh && row.pickup_session) {
    // single-use delivery: hand over the tokens and clear the pickup slot
    db.prepare(
      `UPDATE mcp_device_code
         SET status = 'consumed', pickup_refresh = NULL, pickup_session = NULL
       WHERE device_code_hash = ?`,
    ).run(sha256(deviceCode));
    return {
      status: "approved",
      refresh_token: row.pickup_refresh,
      session_token: row.pickup_session,
    };
  }

  if (row.status === "consumed") return { status: "expired" }; // already picked up
  return { status: "pending" };
}

export interface DeviceCodeInfo {
  user_code: string;
  client_label: string;
  scopes: string[];
  status: string;
  expired: boolean;
}

/** Look up a device code by its human user_code (for the approve page). */
export async function getDeviceByUserCode(userCode: string): Promise<DeviceCodeInfo | null> {
  const db = await getDb();
  if (!db) return null;
  ensureTables(db);
  const row = db
    .prepare(
      `SELECT user_code, client_label, scopes, status, expires_at
         FROM mcp_device_code WHERE user_code = ?`,
    )
    .get(userCode.trim().toUpperCase()) as
    | { user_code: string; client_label: string; scopes: string; status: string; expires_at: number }
    | undefined;
  if (!row) return null;
  return {
    user_code: row.user_code,
    client_label: row.client_label ?? "MCP client",
    scopes: safeParseScopes(row.scopes),
    status: row.status,
    expired: Date.now() > row.expires_at,
  };
}

export interface ApprovingUser {
  id: string;
  namespaceId?: string;
  orgId?: string;
  role?: OrgRole;
}

/**
 * Approve a pending device code (called from the cookie-authed approve page).
 * Mints + stores a refresh token bound to the approving user, mints a bootstrap
 * access token, and stashes both in the device row's single-use pickup slot.
 */
export async function approveDeviceCode(
  userCode: string,
  user: ApprovingUser,
): Promise<{ ok: boolean; error?: string }> {
  const db = await getDb();
  if (!db) return { ok: false, error: "no database" };
  ensureTables(db);

  const code = userCode.trim().toUpperCase();
  const row = db
    .prepare(
      `SELECT scopes, status, client_label, expires_at FROM mcp_device_code WHERE user_code = ?`,
    )
    .get(code) as { scopes: string; status: string; client_label: string; expires_at: number } | undefined;

  if (!row) return { ok: false, error: "unknown code" };
  if (row.status !== "pending") return { ok: false, error: `code already ${row.status}` };
  if (Date.now() > row.expires_at) return { ok: false, error: "code expired" };

  const ns = user.namespaceId ?? "default";
  const org = user.orgId ?? "default";
  const scopes = safeParseScopes(row.scopes);

  // mint + store the refresh token (hash only)
  const refreshRaw = "mkr_" + randomBytes(32).toString("hex");
  const refreshId = genId();
  const sessionId = "mcp-" + randomBytes(6).toString("hex");
  const now = Date.now();

  db.prepare(
    `INSERT INTO mcp_refresh_token
       (id, token_hash, user_id, ns, org, role, scopes, session_id, label, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    refreshId,
    sha256(refreshRaw),
    user.id,
    ns,
    org,
    user.role ?? null,
    JSON.stringify(scopes),
    sessionId,
    row.client_label ?? "MCP client",
    now,
    now + REFRESH_TOKEN_TTL_MS,
  );

  // bootstrap access token so the client works immediately
  const sessionToken = await mintSessionToken({
    sub: user.id,
    jti: sessionId,
    ns,
    org,
    role: user.role,
    scopes,
  });

  db.prepare(
    `UPDATE mcp_device_code
       SET status = 'approved', user_id = ?, refresh_token_id = ?,
           pickup_refresh = ?, pickup_session = ?
     WHERE user_code = ?`,
  ).run(user.id, refreshId, refreshRaw, sessionToken, code);

  return { ok: true };
}

/** Deny a pending device code. */
export async function denyDeviceCode(userCode: string): Promise<{ ok: boolean }> {
  const db = await getDb();
  if (!db) return { ok: false };
  ensureTables(db);
  db.prepare(`UPDATE mcp_device_code SET status = 'denied' WHERE user_code = ? AND status = 'pending'`).run(
    userCode.trim().toUpperCase(),
  );
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Refresh-token exchange
// ---------------------------------------------------------------------------

/**
 * Exchange a refresh token for a fresh 24h access token. Returns null if the
 * refresh token is unknown, revoked, or expired (caller → re-run device flow).
 */
export async function exchangeRefreshToken(
  refreshToken: string,
): Promise<{ session_token: string; expires_in: number } | null> {
  const db = await getDb();
  if (!db) return null;
  ensureTables(db);

  const row = db
    .prepare(
      `SELECT id, user_id, ns, org, role, scopes, session_id, expires_at, revoked_at
         FROM mcp_refresh_token WHERE token_hash = ?`,
    )
    .get(sha256(refreshToken)) as
    | {
        id: string;
        user_id: string;
        ns: string;
        org: string;
        role: string | null;
        scopes: string;
        session_id: string;
        expires_at: number;
        revoked_at: number | null;
      }
    | undefined;

  if (!row) return null;
  if (row.revoked_at) return null;
  if (Date.now() > row.expires_at) return null;

  const session_token = await mintSessionToken({
    sub: row.user_id,
    jti: row.session_id,
    ns: row.ns,
    org: row.org,
    role: (row.role as OrgRole) ?? undefined,
    scopes: safeParseScopes(row.scopes),
  });

  db.prepare(`UPDATE mcp_refresh_token SET last_used_at = ? WHERE id = ?`).run(Date.now(), row.id);

  return { session_token, expires_in: ACCESS_TTL_SECONDS };
}

// ---------------------------------------------------------------------------
// Management (Phase 4)
// ---------------------------------------------------------------------------

export interface RefreshTokenSummary {
  id: string;
  label: string;
  scopes: string[];
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number;
  revokedAt: number | null;
}

export async function listRefreshTokens(userId: string): Promise<RefreshTokenSummary[]> {
  const db = await getDb();
  if (!db) return [];
  ensureTables(db);
  const rows = db
    .prepare(
      `SELECT id, label, scopes, created_at, last_used_at, expires_at, revoked_at
         FROM mcp_refresh_token WHERE user_id = ? ORDER BY created_at DESC`,
    )
    .all(userId) as Array<{
    id: string;
    label: string | null;
    scopes: string;
    created_at: number;
    last_used_at: number | null;
    expires_at: number;
    revoked_at: number | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    label: r.label ?? "MCP client",
    scopes: safeParseScopes(r.scopes),
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at,
  }));
}

/** Revoke a refresh token. Scoped to the owning user so one user can't revoke another's. */
export async function revokeRefreshToken(id: string, userId: string): Promise<{ ok: boolean }> {
  const db = await getDb();
  if (!db) return { ok: false };
  ensureTables(db);
  const res = db
    .prepare(`UPDATE mcp_refresh_token SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL`)
    .run(Date.now(), id, userId);
  return { ok: res.changes > 0 };
}

function safeParseScopes(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
}
