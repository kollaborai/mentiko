/**
 * dispatch.ts — HTTP client for the MCP → web inbox (UI-effect signaling).
 *
 * Credentials are resolved per call:
 *   - MENTIKO_INBOX_KEY (env): app-launched bar bridge → X-Mentiko-Inbox-Key,
 *     routes effects to MENTIKO_SESSION_ID.
 *   - else ~/.mentiko/mcp/ui-control.json (a user-approved UI-control grant) →
 *     Authorization: Bearer <signaling token>, routes to the approved window's id.
 *   - else headless + ungranted → effects no-op (there is no UI to drive, so a
 *     post-write navigate must not fail the tool, and interactive prompts can't
 *     be shown).
 */

import { readUiControl } from "./handlers/session-store.js";

const WEB_URL = process.env.MENTIKO_WEB_URL || "http://127.0.0.1:3000";
const FETCH_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 500;
const DELIVERY_POLL_INTERVAL_MS = 500;
const DELIVERY_TIMEOUT_MS = 3000;
const DEFAULT_REPLY_TIMEOUT_MS = 5 * 60 * 1000;

interface DispatchEffectOptions {
  waitForDelivery?: boolean;
}

interface DispatchCreds {
  headers: Record<string, string>;
  sessionId: string;
}

/**
 * Is a JWT-style signaling token expired? Decodes the payload exp (seconds).
 * Unreadable tokens return false (let the server reject, don't silently drop a
 * possibly-valid opaque token); clearly-JWT tokens past their exp return true.
 */
function isSignalingExpired(token: string | undefined): boolean {
  if (!token || token.split(".").length !== 3) return false;
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
    ) as { exp?: number };
    return typeof payload.exp === "number" && payload.exp * 1000 < Date.now();
  } catch {
    return false;
  }
}

/**
 * Who do we dispatch as? env inbox key (bar) wins; else a granted UI-control
 * sidecar (scoped signaling token); else null = headless with no UI to drive.
 * An expired UI-control grant is treated as no grant (headless) rather than
 * sending a dead token that 401s.
 */
function resolveCreds(): DispatchCreds | null {
  const inbox = process.env.MENTIKO_INBOX_KEY;
  if (inbox) {
    return {
      headers: { "X-Mentiko-Inbox-Key": inbox },
      sessionId: process.env.MENTIKO_SESSION_ID || "global",
    };
  }
  const ui = readUiControl();
  if (ui?.signaling_token && ui?.session_id && !isSignalingExpired(ui.signaling_token)) {
    return {
      headers: { Authorization: `Bearer ${ui.signaling_token}` },
      sessionId: ui.session_id,
    };
  }
  return null;
}

async function withTimeout<T>(p: Promise<T>, ms = FETCH_TIMEOUT_MS): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms),
    ),
  ]);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDelivery(effectId: string, creds: DispatchCreds): Promise<void> {
  const deadline = Date.now() + DELIVERY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const url = new URL(`${WEB_URL}/api/mentiko-mcp/dispatch`);
      url.searchParams.set("id", effectId);
      url.searchParams.set("sessionId", creds.sessionId);

      const res = await withTimeout(
        fetch(url, { headers: creds.headers }),
        Math.min(FETCH_TIMEOUT_MS, Math.max(250, deadline - Date.now())),
      );
      if (res.ok) {
        const data = (await res.json()) as { delivered?: boolean };
        if (data.delivered) return;
      } else if (res.status !== 404) {
        const body = await res.text().catch(() => "");
        throw new Error(`delivery poll got ${res.status} ${body}`);
      }
    } catch (err) {
      console.error(`[mentiko-mcp] delivery poll error:`, err);
    }
    await sleep(DELIVERY_POLL_INTERVAL_MS);
  }
  throw new Error(
    `dispatch ${effectId} was not delivered to session ${creds.sessionId} within ${DELIVERY_TIMEOUT_MS}ms`,
  );
}

export async function dispatchEffect(
  kind: string,
  payload: Record<string, unknown>,
  options: DispatchEffectOptions = {},
): Promise<{ ok: true; id?: string }> {
  const creds = resolveCreds();
  // No UI target (headless, no grant) — fire-and-forget effects no-op so a
  // successful write isn't reported as a failure.
  if (!creds) {
    return { ok: true };
  }

  const res = await withTimeout(
    fetch(`${WEB_URL}/api/mentiko-mcp/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...creds.headers },
      body: JSON.stringify({ kind, payload, sessionId: creds.sessionId }),
    }),
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // Fire-and-forget UI effects (navigate, toast, highlight, ...) must never
    // fail a tool — a stale/expired UI grant or a closed window must not mask a
    // successful data write. Delivery-dependent effects (ask_* prompts) still
    // surface failures because the user never received the prompt.
    if (!options.waitForDelivery) {
      console.error(`[mentiko-mcp] fire-and-forget dispatch "${kind}" failed (non-fatal): ${res.status} ${body}`);
      return { ok: true };
    }
    throw new Error(`dispatch failed: ${res.status} ${body}`);
  }
  const data = (await res.json()) as { ok: true; id?: string };
  if (options.waitForDelivery && data.id) {
    await waitForDelivery(data.id, creds);
  }
  return data;
}

export async function waitForResult(
  toolId: string,
  timeoutMs: number = DEFAULT_REPLY_TIMEOUT_MS,
): Promise<unknown> {
  const creds = resolveCreds();
  if (!creds) {
    throw new Error("no UI channel to wait on (headless, ungranted)");
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const url = new URL(`${WEB_URL}/api/mentiko-mcp/reply`);
      url.searchParams.set("toolId", toolId);
      url.searchParams.set("sessionId", creds.sessionId);

      const res = await withTimeout(fetch(url, { headers: creds.headers }));
      if (res.status === 200) {
        const data = (await res.json()) as { result: unknown };
        return data.result;
      }
      if (res.status !== 404) {
        const body = await res.text().catch(() => "");
        throw new Error(`reply poll got ${res.status} ${body}`);
      }
    } catch (err) {
      // transient network errors during poll — log and continue until deadline
      console.error(`[mentiko-mcp] reply poll error:`, err);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`timeout waiting for user reply to ${toolId}`);
}
