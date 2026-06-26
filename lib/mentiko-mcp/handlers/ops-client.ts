/**
 * ops-client.ts
 *
 * Shared HTTP client for the internal /api/mentiko-mcp/ops/* routes.
 * Uses session-scoped Bearer token auth (MENTIKO_SESSION_TOKEN).
 *
 * Token refresh: on 401 from any ops call, reads the engine token from disk,
 * calls GET /sessions/{id}/token on the engine to get a fresh web JWT, updates
 * the in-memory token, and retries once. This means tokens never expire from
 * the subprocess's perspective — they self-heal on first 401.
 */

import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const WEB_URL     = process.env.MENTIKO_WEB_URL || "http://127.0.0.1:3000";
const ENGINE_URL  = process.env.KOLLABOR_ENGINE_URL || "http://127.0.0.1:7433";
const SESSION_ID  = process.env.MENTIKO_SESSION_ID || "";
const FETCH_TIMEOUT_MS = 15000;

// In-memory token — starts from env, refreshed on 401.
let currentToken: string = process.env.MENTIKO_SESSION_TOKEN || "";

function getEngineToken(): string {
  try {
    return readFileSync(join(homedir(), ".kollab", "engine.token"), "utf8").trim();
  } catch {
    return "";
  }
}

async function refreshToken(): Promise<boolean> {
  if (!SESSION_ID) return false;
  const engineToken = getEngineToken();
  if (!engineToken) return false;

  try {
    const res = await fetch(`${ENGINE_URL}/sessions/${SESSION_ID}/token`, {
      headers: { "Authorization": `Bearer ${engineToken}` },
    });
    if (!res.ok) return false;
    const data = await res.json() as { session_token?: string };
    if (!data.session_token) return false;
    currentToken = data.session_token;
    return true;
  } catch {
    return false;
  }
}

// When the env-provided token is empty (a run/session that didn't ship one in
// MENTIKO_SESSION_TOKEN), bootstrap one from the kollab engine BEFORE the first
// request. The 401-retry path in fetchWithRetry cannot help here: dataHeaders()
// would throw before any request is made, so there is no 401 to trigger a
// refresh — a chicken-and-egg that leaves every ops call failing with
// "session auth required". This lets the bridge self-heal an absent token.
async function ensureToken(): Promise<void> {
  if (currentToken) return;
  await refreshToken();
}

function dataHeaders(): Record<string, string> {
  if (!currentToken) {
    throw new Error("MENTIKO_SESSION_TOKEN not set — session auth required");
  }
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${currentToken}`,
    "X-Mentiko-Session-Id": SESSION_ID,
  };
}

async function withTimeout<T>(p: Promise<T>, timeoutMs = FETCH_TIMEOUT_MS): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`ops call timed out after ${timeoutMs}ms`)),
        timeoutMs,
      ),
    ),
  ]);
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const res = await withTimeout(fetch(url, init), timeoutMs);
  if (res.status !== 401) return res;
  // Token expired — refresh and retry once.
  const refreshed = await refreshToken();
  if (!refreshed) return res; // can't refresh, return the 401
  const retryInit = {
    ...init,
    headers: { ...(init.headers as Record<string, string>), ...dataHeaders() },
  };
  return await withTimeout(fetch(url, retryInit), timeoutMs);
}

export async function opsGet<T = any>(
  path: string,
  query?: Record<string, string>,
): Promise<T> {
  await ensureToken();
  const url = new URL(`${WEB_URL}${path}`);
  for (const [k, v] of Object.entries(query || {})) {
    if (v != null) url.searchParams.set(k, v);
  }
  const res = await fetchWithRetry(url.toString(), { headers: dataHeaders() });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GET ${path} failed: ${res.status} ${body}`);
  }
  return (await res.json()) as T;
}

export async function opsPost<T = any>(
  path: string,
  body: any,
  options?: { timeoutMs?: number },
): Promise<T> {
  await ensureToken();
  const res = await fetchWithRetry(`${WEB_URL}${path}`, {
    method: "POST",
    headers: dataHeaders(),
    body: JSON.stringify(body),
  }, options?.timeoutMs);
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`POST ${path} failed: ${res.status} ${msg}`);
  }
  return (await res.json()) as T;
}

export async function opsPatch<T = any>(path: string, body: any): Promise<T> {
  await ensureToken();
  const res = await fetchWithRetry(`${WEB_URL}${path}`, {
    method: "PATCH",
    headers: dataHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`PATCH ${path} failed: ${res.status} ${msg}`);
  }
  return (await res.json()) as T;
}

export async function opsDelete<T = any>(
  path: string,
  query?: Record<string, string>,
): Promise<T> {
  await ensureToken();
  const url = new URL(`${WEB_URL}${path}`);
  for (const [k, v] of Object.entries(query || {})) {
    if (v != null) url.searchParams.set(k, v);
  }
  const res = await fetchWithRetry(url.toString(), {
    method: "DELETE",
    headers: dataHeaders(),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`DELETE ${path} failed: ${res.status} ${msg}`);
  }
  return (await res.json()) as T;
}
