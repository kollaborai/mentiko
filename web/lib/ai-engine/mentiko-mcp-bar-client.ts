// -------------------------------------------------------------------
// mentiko-mcp-bar-client.ts — SSE subscriber for UI effects dispatched
// by the mentiko-mcp stdio subprocess.
// -------------------------------------------------------------------
// Effects are session-scoped: the JWT from the engine session create
// response is passed as ?sessionToken= so effects route only to the
// tab that initiated the agent turn.
//
// Token expiry handling: on 401 from stream, calls the refresh-token
// endpoint, updates sessionStorage, and reconnects.
// -------------------------------------------------------------------

import { UIEffect } from "./mentiko-mcp-inbox";

export type EffectHandler = (effect: UIEffect) => void;

const SESSION_TOKEN_KEY = "mentiko-session-token";
const LEGACY_SESSION_ID_KEY = "mentiko-kollabor-session-id";
const SESSION_ID_KEY = "mentiko-kollabor-session-id-v2";
const DEFAULT_STORAGE_SCOPE = "anonymous";

let mcpBarStorageScope = DEFAULT_STORAGE_SCOPE;

// -------------------------------------------------------------------
// storage scoping — isolates keys per org/namespace to prevent cross-talk
// in multi-tenant deployments.
// -------------------------------------------------------------------

function normalizeStorageScope(scope?: string | null): string {
  const value = typeof scope === "string" ? scope.trim() : "";
  return value || DEFAULT_STORAGE_SCOPE;
}

function scopedStorageKey(baseKey: string, scope = mcpBarStorageScope): string {
  return `${baseKey}:${scope}`;
}

export function setMcpBarStorageScope(scope?: string | null): void {
  mcpBarStorageScope = normalizeStorageScope(scope);
}

export function getMcpBarStorageScope(): string {
  return mcpBarStorageScope;
}

export function getStoredSessionToken(scope = mcpBarStorageScope): string | null {
  if (typeof sessionStorage === "undefined") return null;
  try { return sessionStorage.getItem(scopedStorageKey(SESSION_TOKEN_KEY, scope)); } catch { return null; }
}

export function storeSessionToken(token: string, scope = mcpBarStorageScope): void {
  if (typeof sessionStorage === "undefined") return;
  try { sessionStorage.setItem(scopedStorageKey(SESSION_TOKEN_KEY, scope), token); } catch {}
}

export function clearSessionToken(scope = mcpBarStorageScope): void {
  if (typeof sessionStorage === "undefined") return;
  try { sessionStorage.removeItem(scopedStorageKey(SESSION_TOKEN_KEY, scope)); } catch {}
}

export function syncSessionToken(token: string | null | undefined): void {
  if (token) {
    storeSessionToken(token);
    return;
  }
  clearSessionToken();
}

export function getStoredSessionId(scope = mcpBarStorageScope): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return (
      localStorage.getItem(scopedStorageKey(SESSION_ID_KEY, scope)) ||
      localStorage.getItem(scopedStorageKey(LEGACY_SESSION_ID_KEY, scope))
    );
  } catch {
    return null;
  }
}

// -------------------------------------------------------------------
// MCPBarClient — SSE client for UI effects
// -------------------------------------------------------------------

export class MCPBarClient {
  private eventSource: EventSource | null = null;
  private onEffect: EffectHandler;
  private closed = false;
  private refreshing = false;
  private refreshController: AbortController | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly scopeAtCreation: string;

  constructor(onEffect: EffectHandler) {
    this.onEffect = onEffect;
    this.scopeAtCreation = mcpBarStorageScope;
  }

  connect() {
    if (this.closed || this.eventSource || mcpBarStorageScope !== this.scopeAtCreation) return;

    const scope = this.scopeAtCreation;
    const token = getStoredSessionToken(scope);
    let url: string;
    if (token) {
      url = `/api/mentiko-mcp/stream?sessionToken=${encodeURIComponent(token)}`;
    } else {
      // dev fallback: no signed token (user not logged in). pass the engine
      // session id so the server route can match the bucket the MCP
      // subprocess dispatches into (MENTIKO_SESSION_ID).
      const sid = getStoredSessionId(scope);
      url = sid
        ? `/api/mentiko-mcp/stream?sessionId=${encodeURIComponent(sid)}`
        : `/api/mentiko-mcp/stream`;
    }

    const es = new EventSource(url);
    this.eventSource = es;

    es.onmessage = (event) => {
      try {
        const effect = JSON.parse(event.data) as UIEffect;
        if (!this.closed && mcpBarStorageScope === this.scopeAtCreation) this.onEffect(effect);
      } catch (err) {
        console.error("[mcp-bar] effect parse error:", err);
      }
    };

    es.onerror = () => {
      if (this.closed) return;
      es.close();
      this.eventSource = null;
      if (mcpBarStorageScope !== this.scopeAtCreation) return;

      // Check if error might be auth-related (401) — try refresh first
      const sessionId = (() => {
        if (typeof localStorage === "undefined") return null;
        try {
          localStorage.removeItem(scopedStorageKey(LEGACY_SESSION_ID_KEY, this.scopeAtCreation));
          return localStorage.getItem(scopedStorageKey(SESSION_ID_KEY, this.scopeAtCreation));
        } catch { return null; }
      })();

      if (sessionId && !this.refreshing) {
        this.refreshing = true;
        this.refreshController = new AbortController();
        fetch(`/api/kollabor/engine/sessions/${encodeURIComponent(sessionId)}/refresh-token`, {
          method: "POST",
          credentials: "same-origin",
          signal: this.refreshController.signal,
        })
          .then((res) => res.ok ? res.json() : null)
          .then((data) => {
            this.refreshing = false;
            if (this.closed || mcpBarStorageScope !== this.scopeAtCreation) {
              this.refreshController = null;
              return;
            }
            if (data?.session_token) {
              storeSessionToken(data.session_token, this.scopeAtCreation);
            } else {
              clearSessionToken(this.scopeAtCreation);
            }
            this.refreshController = null;
            this.scheduleReconnect(500);
          })
          .catch(() => {
            this.refreshing = false;
            if (this.closed || mcpBarStorageScope !== this.scopeAtCreation) {
              this.refreshController = null;
              return;
            }
            this.refreshController = null;
            clearSessionToken(this.scopeAtCreation);
            this.scheduleReconnect(3000);
          });
      } else {
        clearSessionToken(this.scopeAtCreation);
        this.scheduleReconnect(3000);
      }
    };
  }

  private scheduleReconnect(delayMs: number) {
    if (this.closed || mcpBarStorageScope !== this.scopeAtCreation) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closed && mcpBarStorageScope === this.scopeAtCreation) this.connect();
    }, delayMs);
  }

  disconnect() {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.refreshController?.abort();
    this.refreshController = null;
    this.refreshing = false;
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }
}

// -------------------------------------------------------------------
// tool reply API — POST the user's reply for a synchronous ask_* tool
// -------------------------------------------------------------------
// Auth: signed-in session cookie. sessionId from JWT or local storage fallback.
// -------------------------------------------------------------------

export async function replyToTool(
  toolId: string,
  result: unknown,
  guard?: { scope?: string; isCurrent?: () => boolean },
): Promise<void> {
  const requestScope = guard?.scope ?? mcpBarStorageScope;
  if (requestScope !== mcpBarStorageScope) throw new Error("stale MCP scope");
  if (guard?.isCurrent && !guard.isCurrent()) throw new Error("stale MCP reply");
  if (requestScope !== mcpBarStorageScope) throw new Error("stale MCP scope");
  const token = getStoredSessionToken(requestScope);
  const sessionId = getStoredSessionId(requestScope);
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
  if (requestScope !== mcpBarStorageScope) throw new Error("stale MCP scope");
  if (!res.ok) {
    throw new Error(`reply failed: ${res.status}`);
  }
  if (guard?.isCurrent && !guard.isCurrent()) throw new Error("stale MCP reply");
  if (requestScope !== mcpBarStorageScope) throw new Error("stale MCP scope");
}
