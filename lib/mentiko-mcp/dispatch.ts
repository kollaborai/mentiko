/**
 * dispatch.ts — HTTP client for the MCP → web inbox.
 *
 * Signaling channel (dispatch/reply) still uses MENTIKO_INBOX_KEY.
 * sessionId is included in every dispatch so effects route to the correct tab.
 * WEB_URL defaults to the next.js dev/prod URL on the same container loopback.
 */

const WEB_URL = process.env.MENTIKO_WEB_URL || "http://127.0.0.1:3000";
const SESSION_ID = process.env.MENTIKO_SESSION_ID || "global";
const FETCH_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 500;
const DELIVERY_POLL_INTERVAL_MS = 500;
const DELIVERY_TIMEOUT_MS = 3000;
const DEFAULT_REPLY_TIMEOUT_MS = 5 * 60 * 1000;

function inboxKey(): string {
  const k = process.env.MENTIKO_INBOX_KEY;
  if (!k) {
    throw new Error(
      "MENTIKO_INBOX_KEY not set — cannot reach mentiko-web dispatch endpoint",
    );
  }
  return k;
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

async function waitForDelivery(effectId: string): Promise<void> {
  const deadline = Date.now() + DELIVERY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const url = new URL(`${WEB_URL}/api/mentiko-mcp/dispatch`);
      url.searchParams.set("id", effectId);
      url.searchParams.set("sessionId", SESSION_ID);

      const res = await withTimeout(
        fetch(url, {
          headers: { "X-Mentiko-Inbox-Key": inboxKey() },
        }),
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
    `dispatch ${effectId} was not delivered to session ${SESSION_ID} within ${DELIVERY_TIMEOUT_MS}ms`,
  );
}

export async function dispatchEffect(
  kind: string,
  payload: Record<string, unknown>,
): Promise<{ ok: true; id?: string }> {
  const res = await withTimeout(
    fetch(`${WEB_URL}/api/mentiko-mcp/dispatch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Mentiko-Inbox-Key": inboxKey(),
      },
      body: JSON.stringify({ kind, payload, sessionId: SESSION_ID }),
    }),
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`dispatch failed: ${res.status} ${body}`);
  }
  const data = (await res.json()) as { ok: true; id?: string };
  if (data.id) {
    await waitForDelivery(data.id);
  }
  return data;
}

export async function waitForResult(
  toolId: string,
  timeoutMs: number = DEFAULT_REPLY_TIMEOUT_MS,
): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await withTimeout(
        fetch(
          `${WEB_URL}/api/mentiko-mcp/reply?toolId=${encodeURIComponent(toolId)}`,
          {
            headers: { "X-Mentiko-Inbox-Key": inboxKey() },
          },
        ),
      );
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
