/**
 * mentiko-mcp-bar-client.ts
 *
 * SSE subscriber for UI effects dispatched by the mentiko-mcp stdio
 * subprocess. Effects are session-scoped: the JWT from the engine session
 * create response is passed as ?sessionToken= so effects route only to
 * the tab that initiated the agent turn.
 *
 * Token expiry handling: on 401 from stream, calls the refresh-token
 * endpoint, updates sessionStorage, and reconnects.
 */

import { UIEffect } from "./mentiko-mcp-inbox";

export type EffectHandler = (effect: UIEffect) => void;

const SESSION_TOKEN_KEY = "mentiko-session-token";
const LEGACY_SESSION_ID_KEY = "mentiko-kollabor-session-id";
const SESSION_ID_KEY = "mentiko-kollabor-session-id-v2";
const DEFAULT_STORAGE_SCOPE = "anonymous";

let mcpBarStorageScope = DEFAULT_STORAGE_SCOPE;

function normalizeStorageScope(scope?: string | null): string {
  const value = typeof scope === "string" ? scope.trim() : "";
  return value || DEFAULT_STORAGE_SCOPE;
}

function scopedStorageKey(baseKey: string): string {
  return `${baseKey}:${mcpBarStorageScope}`;
}

export function setMcpBarStorageScope(scope?: string | null): void {
  mcpBarStorageScope = normalizeStorageScope(scope);
}

export function getStoredSessionToken(): string | null {
  if (typeof sessionStorage === "undefined") return null;
  try { return sessionStorage.getItem(scopedStorageKey(SESSION_TOKEN_KEY)); } catch { return null; }
}

export function storeSessionToken(token: string): void {
  if (typeof sessionStorage === "undefined") return;
  try { sessionStorage.setItem(scopedStorageKey(SESSION_TOKEN_KEY), token); } catch {}
}

export function clearSessionToken(): void {
  if (typeof sessionStorage === "undefined") return;
  try { sessionStorage.removeItem(scopedStorageKey(SESSION_TOKEN_KEY)); } catch {}
}

export function syncSessionToken(token: string | null | undefined): void {
  if (token) {
    storeSessionToken(token);
    return;
  }
  clearSessionToken();
}

export function getStoredSessionId(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return (
      localStorage.getItem(scopedStorageKey(SESSION_ID_KEY)) ||
      localStorage.getItem(scopedStorageKey(LEGACY_SESSION_ID_KEY))
    );
  } catch {
    return null;
  }
}

export class MCPBarClient {
  private eventSource: EventSource | null = null;
  private onEffect: EffectHandler;
  private closed = false;
  private refreshing = false;

  constructor(onEffect: EffectHandler) {
    this.onEffect = onEffect;
  }

  connect() {
    if (this.eventSource) return;

    const token = getStoredSessionToken();
    let url: string;
    if (token) {
      url = `/api/mentiko-mcp/stream?sessionToken=${encodeURIComponent(token)}`;
    } else {
      // dev fallback: no signed token (user not logged in). pass the engine
      // session id so the server route can match the bucket the MCP
      // subprocess dispatches into (MENTIKO_SESSION_ID).
      const sid = getStoredSessionId();
      url = sid
        ? `/api/mentiko-mcp/stream?sessionId=${encodeURIComponent(sid)}`
        : `/api/mentiko-mcp/stream`;
    }

    const es = new EventSource(url);
    this.eventSource = es;

    es.onmessage = (event) => {
      try {
        const effect = JSON.parse(event.data) as UIEffect;
        this.onEffect(effect);
      } catch (err) {
        console.error("[mcp-bar] effect parse error:", err);
      }
    };

    es.onerror = () => {
      if (this.closed) return;
      es.close();
      this.eventSource = null;

      // Check if error might be auth-related (401) — try refresh first
      const sessionId = (() => {
        if (typeof localStorage === "undefined") return null;
        try {
          localStorage.removeItem(scopedStorageKey(LEGACY_SESSION_ID_KEY));
          return localStorage.getItem(scopedStorageKey(SESSION_ID_KEY));
        } catch { return null; }
      })();

      if (sessionId && !this.refreshing) {
        this.refreshing = true;
        fetch(`/api/kollabor/engine/sessions/${encodeURIComponent(sessionId)}/refresh-token`, {
          method: "POST",
          credentials: "same-origin",
        })
          .then((res) => res.ok ? res.json() : null)
          .then((data) => {
            this.refreshing = false;
            if (data?.session_token) {
              storeSessionToken(data.session_token);
            } else {
              clearSessionToken();
            }
            if (!this.closed) {
              setTimeout(() => this.connect(), 500);
            }
          })
          .catch(() => {
            this.refreshing = false;
            clearSessionToken();
            if (!this.closed) {
              setTimeout(() => this.connect(), 3000);
            }
          });
      } else {
        clearSessionToken();
        setTimeout(() => {
          if (!this.closed) this.connect();
        }, 3000);
      }
    };
  }

  disconnect() {
    this.closed = true;
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }
}

/**
 * POST the user's reply for a synchronous ask_* tool.
 * Auth: signed-in session cookie. sessionId from JWT or local storage fallback.
 */
export async function replyToTool(
  toolId: string,
  result: unknown,
): Promise<void> {
  const token = getStoredSessionToken();
  const sessionId = getStoredSessionId();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch("/api/mentiko-mcp/reply", {
    method: "POST",
    credentials: "same-origin",
    headers,
    body: JSON.stringify({
      toolId,
      result,
      ...(sessionId ? { sessionId } : {}),
    }),
  });
  if (!res.ok) {
    throw new Error(`reply failed: ${res.status}`);
  }
}
