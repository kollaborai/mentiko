"use client";

/**
 * Browser client for kollabor-engine through the same-origin Next.js proxy.
 *
 * Auth: fetches endpoint metadata from /api/kollabor/token. The browser keeps a
 * placeholder token; the proxy reads ~/.kollab/engine.token server-side.
 *
 * All REST calls throw Error on non-2xx (caller wraps in try/catch for render).
 * sendMessage() surfaces errors as synthetic { type: "error" } events in the
 * AsyncIterable stream so the UI can keep rendering.
 */

// ----- SSE event discriminated union (mirrors kollabor_engine/sse.py) -----

export interface EventBase {
  session_id: string;
  ts: number;
}

export interface TokenEvent extends EventBase {
  type: "token";
  text: string;
}

export interface ThinkingEvent extends EventBase {
  type: "thinking";
  text: string;
}

export interface ToolInput {
  [k: string]: unknown;
}

export interface ToolStartEvent extends EventBase {
  type: "tool_start";
  tool_id: string;
  tool_name: string;
  tool_type: string;
  input: ToolInput;
  risk_level: string;
}

export interface ToolResultEvent extends EventBase {
  type: "tool_result";
  tool_id: string;
  tool_name: string;
  success: boolean;
  output: string;
  error?: string;
  execution_time?: number;
  metadata?: Record<string, unknown>;
}

export interface PermissionRequestEvent extends EventBase {
  type: "permission_request";
  tool_id: string;
  tool_name: string;
  tool_type: string;
  input: ToolInput;
  risk_level: string;
  risk_reason: string;
}

export interface PermissionGrantedEvent extends EventBase {
  type: "permission_granted";
  tool_id: string;
  scope: string;
}

export interface PermissionDeniedEvent extends EventBase {
  type: "permission_denied";
  tool_id: string;
}

export interface QuestionGateEvent extends EventBase {
  type: "question_gate";
  question: string;
  pending_tools: number;
}

export interface TurnCompleteEvent extends EventBase {
  type: "turn_complete";
  input_tokens: number;
  output_tokens: number;
  thinking_tokens?: number;
  tool_calls: number;
  stop_reason: string;
}

export interface ErrorEvent extends EventBase {
  type: "error";
  code?: string;
  message: string;
  retryable?: boolean;
}

export type EngineEvent =
  | TokenEvent
  | ThinkingEvent
  | ToolStartEvent
  | ToolResultEvent
  | PermissionRequestEvent
  | PermissionGrantedEvent
  | PermissionDeniedEvent
  | QuestionGateEvent
  | TurnCompleteEvent
  | ErrorEvent;

// ----- Session / request types -----

// SessionInfo as returned by GET /sessions/:id, POST /sessions, and items in
// GET /sessions.sessions[]. NOTE: engine serializes approval_mode as a NUMBER
// (enum index), not the string ("confirm_all") accepted on create.
export interface SessionInfo {
  session_id: string;
  profile: string;
  workspace: string | null;
  approval_mode: number;
  created_at: string;
  total_turns: number;
  total_input_tokens: number;
  total_output_tokens: number;
  history_length: number;
  active: boolean;
  mcp_servers: string[];
  mcp_connected: string[];
  /** Injected by the web proxy on POST /sessions — 15-min JWT for ops routes */
  session_token?: string;
}

export interface Credentials {
  provider?: string;
  api_key?: string;
  model?: string;
  base_url?: string;
  [k: string]: unknown;
}

// Accepted by POST /sessions. All fields optional; `{}` is valid.
export interface CreateSessionRequest {
  profile?: string;
  agent?: string;
  system_prompt?: string | null;
  workspace?: string | null;
  approval_mode?: string; // "confirm_all" | "default" | "auto_approve_edits" | "trust_all"
  mcp_servers?: string[];
  metadata?: Record<string, unknown>;
  credentials?: Credentials | null;
}

// Draft tool state used by the bar while a turn is in progress. Not part of
// the engine wire protocol; exported for callers that accumulate tool state
// between tool_start and tool_result.
export interface DraftTool {
  tool_id: string;
  tool_name: string;
  tool_type: string;
  input: ToolInput;
  risk_level: string;
  status: "running" | "done" | "error" | "awaiting_permission";
  output?: string;
  error?: string;
  execution_time?: number;
}

// PermissionScope values accepted by the engine (from routes/permissions.py).
export type PermissionScope =
  | "once"
  | "session"
  | "project"
  | "always_edits"
  | "trust_tool";

// ----- Module state -----

const DEFAULT_TIMEOUT_MS = 30_000;
const LEGACY_SESSION_ID_KEY = "mentiko-kollabor-session-id";
const LEGACY_SESSION_REQUIREMENTS_KEY = "mentiko-kollabor-session-requirements";
const SESSION_ID_KEY = "mentiko-kollabor-session-id-v2";
const SESSION_REQUIREMENTS_KEY = "mentiko-kollabor-session-requirements-v2";

let cachedToken: { token: string; baseUrl: string } | null = null;
let inflightTokenFetch: Promise<{ token: string; baseUrl: string }> | null =
  null;
let inflightMentikoSetup: Promise<MentikoAgentInstallResult> | null = null;

/** Drop the cached token so the next fetchToken() re-fetches from the server. */
export function clearTokenCache(): void {
  cachedToken = null;
  inflightTokenFetch = null;
}

// ----- Internal helpers -----

function combineSignals(
  caller: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  let onAbort: (() => void) | null = null;
  if (caller) {
    if (caller.aborted) {
      controller.abort(caller.reason);
    } else {
      onAbort = () => controller.abort(caller.reason);
      caller.addEventListener("abort", onAbort, { once: true });
    }
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      if (caller && onAbort) caller.removeEventListener("abort", onAbort);
    },
  };
}

async function authFetch(
  path: string,
  init: RequestInit & { signal?: AbortSignal } = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const { token, baseUrl } = await fetchToken();
  const { signal, cleanup } = combineSignals(init.signal, timeoutMs);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
      signal,
    });
    // auth failed — wipe cache so caller can retry with a fresh token
    if (res.status === 401 || res.status === 403) {
      clearTokenCache();
    }
    return res;
  } finally {
    cleanup();
  }
}

async function throwIfNotOk(res: Response, context: string): Promise<void> {
  if (res.ok) return;
  let detail = "";
  try {
    const body = await res.text();
    try {
      const j = JSON.parse(body);
      detail = typeof j?.detail === "string" ? j.detail : body;
    } catch {
      detail = body;
    }
  } catch {
    // ignore
  }
  throw new Error(`${context}: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`);
}

function requiredSessionSignature(opts: CreateSessionRequest): string | null {
  if (!opts.profile && !opts.agent && !opts.mcp_servers?.length && !opts.metadata) {
    return null;
  }

  const fingerprint =
    typeof opts.metadata?.mentiko_agent_fingerprint === "string"
      ? opts.metadata.mentiko_agent_fingerprint
      : null;

  return JSON.stringify({
    profile: opts.profile ?? null,
    agent: opts.agent ?? null,
    mcp_servers: [...(opts.mcp_servers ?? [])].sort(),
    mentiko_agent_fingerprint: fingerprint,
  });
}

function sessionMatchesRequest(info: SessionInfo, opts: CreateSessionRequest): boolean {
  if (opts.profile && info.profile !== opts.profile) return false;

  const requiredMcpServers = opts.mcp_servers ?? [];
  if (requiredMcpServers.length > 0) {
    const connected = new Set(info.mcp_connected ?? []);
    return requiredMcpServers.every((server) => connected.has(server));
  }

  return true;
}

function clearStoredSession(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LEGACY_SESSION_ID_KEY);
    window.localStorage.removeItem(LEGACY_SESSION_REQUIREMENTS_KEY);
    window.localStorage.removeItem(SESSION_ID_KEY);
    window.localStorage.removeItem(SESSION_REQUIREMENTS_KEY);
  } catch {
    // ignore
  }
}

// ----- Public API -----

/** Fetch the bearer token + baseUrl from /api/kollabor/token. Memoized. */
export async function fetchToken(): Promise<{ token: string; baseUrl: string }> {
  if (cachedToken) return cachedToken;
  if (inflightTokenFetch) return inflightTokenFetch;
  inflightTokenFetch = (async () => {
    const res = await fetch("/api/kollabor/token", { cache: "no-store" });
    if (!res.ok) {
      let msg = `token fetch failed: ${res.status}`;
      try {
        const j = await res.json();
        if (j?.error) msg = `token fetch failed: ${j.error}`;
      } catch {
        // ignore
      }
      inflightTokenFetch = null;
      throw new Error(msg);
    }
    const json = (await res.json()) as { token: string; baseUrl: string };
    if (!json?.token || !json?.baseUrl) {
      inflightTokenFetch = null;
      throw new Error("token response missing token/baseUrl");
    }
    cachedToken = json;
    inflightTokenFetch = null;
    return json;
  })();
  return inflightTokenFetch;
}

/** List all sessions known to the engine. */
export async function listSessions(signal?: AbortSignal): Promise<SessionInfo[]> {
  const res = await authFetch("/sessions", { method: "GET", signal });
  await throwIfNotOk(res, "listSessions");
  const body = (await res.json()) as { sessions?: SessionInfo[] };
  return Array.isArray(body?.sessions) ? body.sessions : [];
}

/** Create a new engine session. Pass `{}` or specific overrides. */
export async function createSession(
  opts: CreateSessionRequest = {},
  signal?: AbortSignal,
  ensureRuntime = true,
): Promise<SessionInfo> {
  if (ensureRuntime) {
    await ensureMentikoRuntimeSetup();
  }
  const res = await authFetch("/sessions", {
    method: "POST",
    body: JSON.stringify(opts ?? {}),
    signal,
  });
  await throwIfNotOk(res, "createSession");
  return (await res.json()) as SessionInfo;
}

/** Fetch one session by id. Returns null on 404, throws on other errors. */
export async function getSession(
  sessionId: string,
  signal?: AbortSignal,
): Promise<SessionInfo | null> {
  const res = await authFetch(`/sessions/${encodeURIComponent(sessionId)}`, {
    method: "GET",
    signal,
  });
  if (res.status === 404) return null;
  await throwIfNotOk(res, "getSession");
  return (await res.json()) as SessionInfo;
}

export interface SessionResult {
  sessionId: string;
  sessionToken?: string;
}

export interface MentikoAgentInstallResult {
  ok: true;
  /** true when repo bundle was missing or setup was skipped (no 500; kollabor may still run). */
  skipped?: boolean;
  reason?: string;
  synced: boolean;
  agentSynced?: boolean;
  mcpSynced?: boolean;
  agentFingerprint?: string;
  agentTarget?: string;
  mcpSettings?: string;
  agent?: {
    source: string;
    target: string;
    normalizedTarget: string;
    fingerprint: string;
    previousFingerprint: string | null;
    updated: boolean;
  };
  mcp?: {
    path: string;
    normalizedPath: string;
    directory: string;
    normalizedDirectory: string;
    serverName: string;
    command: string;
    createdFile: boolean;
    updated: boolean;
    preservedServerCount: number;
  };
}

/** Ensure the repo-local mentiko agent bundle is installed into Kollab config dir. */
export async function ensureMentikoAgentInstalled(): Promise<MentikoAgentInstallResult> {
  const res = await fetch("/api/kollabor/setup/mentiko", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ force: true }),
  });

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    let detail = `POST /api/kollabor/setup/mentiko: ${res.status} ${res.statusText}`;
    if (payload && typeof payload === "object" && "error" in payload && (payload as { error?: string }).error) {
      detail = `${detail} — ${(payload as { error: string }).error}`;
    }
    throw new Error(detail);
  }

  if (!payload || typeof payload !== "object" || !("ok" in payload)) {
    throw new Error("invalid JSON from /api/kollabor/setup/mentiko");
  }

  const result = payload as MentikoAgentInstallResult;
  if (result.skipped && result.reason && typeof console !== "undefined" && console.warn) {
    console.warn("[kollabor] mentiko agent bootstrap skipped:", result.reason);
  }

  return result;
}

async function ensureMentikoRuntimeSetup(): Promise<MentikoAgentInstallResult> {
  if (!inflightMentikoSetup) {
    inflightMentikoSetup = ensureMentikoAgentInstalled().finally(() => {
      inflightMentikoSetup = null;
    });
  }
  return inflightMentikoSetup;
}

/**
 * Return the persisted session id if still alive, otherwise create a new one.
 * Caller passes opts (e.g. profile) which are used only when creating fresh.
 * Returns { sessionId, sessionToken } — sessionToken is only present on
 * freshly-created sessions (minted by the web proxy).
 */
export async function getOrCreateSession(
  opts: CreateSessionRequest = {},
  signal?: AbortSignal,
): Promise<SessionResult> {
  await ensureMentikoRuntimeSetup();
  let existing: string | null = null;
  const requiredSignature = requiredSessionSignature(opts);
  if (typeof window !== "undefined") {
    try {
      existing = window.localStorage.getItem(SESSION_ID_KEY);
      const existingSignature = window.localStorage.getItem(SESSION_REQUIREMENTS_KEY);
      if (existing && requiredSignature && existingSignature !== requiredSignature) {
        clearStoredSession();
        existing = null;
      }
    } catch {
      existing = null;
    }
  }
  if (existing) {
    try {
      const info = await getSession(existing, signal);
      if (info && sessionMatchesRequest(info, opts)) {
        // Refresh the session token so sessionStorage and subprocess env stay current.
        // Fire-and-forget: failure is non-fatal — bar reconnects via MCPBarClient on 401.
        const tokenRes = await fetch(
          `/api/kollabor/engine/sessions/${encodeURIComponent(info.session_id)}/refresh-token`,
          { method: "POST", credentials: "same-origin", signal: signal ?? undefined },
        ).catch(() => null);
        const sessionToken = tokenRes?.ok
          ? (await tokenRes.json().catch(() => null))?.session_token as string | undefined
          : undefined;
        if (sessionToken) {
          return { sessionId: info.session_id, sessionToken };
        }
        if (typeof window !== "undefined") {
          clearStoredSession();
        }
      } else {
        clearStoredSession();
      }
    } catch {
      // network/auth error — fall through and create fresh
    }
  }
  const created = await createSession(opts, signal, false);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(SESSION_ID_KEY, created.session_id);
      if (requiredSignature) {
        window.localStorage.setItem(SESSION_REQUIREMENTS_KEY, requiredSignature);
      } else {
        window.localStorage.removeItem(SESSION_REQUIREMENTS_KEY);
      }
    } catch {
      // ignore
    }
  }
  return {
    sessionId: created.session_id,
    sessionToken: created.session_token,
  };
}

/**
 * Send a message and yield SSE events until turn_complete or error. On fetch
 * or parse error, yields a synthetic { type: "error" } event and stops.
 */
export async function* sendMessage(
  sessionId: string,
  content: string,
  signal?: AbortSignal,
): AsyncGenerator<EngineEvent, void, void> {
  const now = () => Date.now();
  const errorEvent = (message: string, code = "client_error"): ErrorEvent => ({
    type: "error",
    session_id: sessionId,
    ts: now(),
    code,
    message,
    retryable: false,
  });

  let token: string;
  let baseUrl: string;
  try {
    ({ token, baseUrl } = await fetchToken());
  } catch (e: unknown) {
    yield errorEvent(e instanceof Error ? e.message : String(e), "auth");
    return;
  }

  // sendMessage intentionally does NOT apply the 30s default timeout to the
  // response read — turns can run for minutes. Callers use the optional signal
  // for cancellation. A 30s timeout is only applied to the INITIAL fetch call
  // that returns the headers; once streaming starts, we let it run.
  const controller = new AbortController();
  let onCallerAbort: (() => void) | null = null;
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else {
      onCallerAbort = () => controller.abort(signal.reason);
      signal.addEventListener("abort", onCallerAbort, { once: true });
    }
  }

  let res: Response;
  try {
    res = await fetch(
      `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/message`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ content }),
        signal: controller.signal,
      },
    );
  } catch (e: unknown) {
    if (signal && onCallerAbort) signal.removeEventListener("abort", onCallerAbort);
    yield errorEvent(e instanceof Error ? e.message : String(e), "network");
    return;
  }

  if (res.status === 401 || res.status === 403) clearTokenCache();

  if (!res.ok || !res.body) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.text();
      if (body) detail = `${detail} — ${body.slice(0, 500)}`;
    } catch {
      // ignore
    }
    if (signal && onCallerAbort) signal.removeEventListener("abort", onCallerAbort);
    yield errorEvent(detail, "http_error");
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE uses blank-line (\n\n or \r\n\r\n) as event separator. Keep the
      // trailing incomplete block in the buffer for the next iteration.
      while (true) {
        const sepIdx = findBlankLine(buffer);
        if (sepIdx === -1) break;
        const rawBlock = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + blankLineLength(buffer, sepIdx));

        const dataLines: string[] = [];
        for (const line of rawBlock.split(/\r?\n/)) {
          if (!line || line.startsWith(":")) continue; // keepalive/comment
          if (line.startsWith("data:")) {
            // strip "data:" plus exactly one leading space if present
            dataLines.push(line.slice(line[5] === " " ? 6 : 5));
          }
          // ignore event:, id:, retry:
        }
        if (dataLines.length === 0) continue;
        const payload = dataLines.join("\n").trim();
        if (!payload || payload === "[DONE]") continue;

        let parsed: unknown;
        try {
          parsed = JSON.parse(payload);
        } catch (e: unknown) {
          yield errorEvent(
            `parse error: ${e instanceof Error ? e.message : String(e)}`,
            "parse_error",
          );
          continue;
        }
        if (isEngineEvent(parsed)) {
          yield parsed;
          if (parsed.type === "turn_complete") {
            // drain complete; stop reading
            try {
              await reader.cancel();
            } catch {
              // ignore
            }
            return;
          }
        }
      }
    }
  } catch (e: unknown) {
    const reason =
      controller.signal.aborted && signal?.aborted
        ? "aborted"
        : e instanceof Error
          ? e.message
          : String(e);
    yield errorEvent(reason, controller.signal.aborted ? "aborted" : "stream_error");
  } finally {
    if (signal && onCallerAbort) signal.removeEventListener("abort", onCallerAbort);
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

/** Cancel the current turn on a session. */
export async function cancelTurn(
  sessionId: string,
  signal?: AbortSignal,
): Promise<void> {
  const res = await authFetch(
    `/sessions/${encodeURIComponent(sessionId)}/cancel`,
    { method: "POST", signal },
  );
  await throwIfNotOk(res, "cancelTurn");
}

/**
 * Respond to a permission_request event. The engine wire format uses separate
 * `decision` ("approve" | "deny") + `scope` ("once" | "session" | ...).
 * This helper maps the convenience shape.
 */
export async function respondToPermission(
  sessionId: string,
  toolId: string,
  decision: "approve" | "approve_always" | "deny",
  signal?: AbortSignal,
): Promise<void> {
  let wireDecision: "approve" | "deny";
  let scope: PermissionScope;
  if (decision === "approve") {
    wireDecision = "approve";
    scope = "once";
  } else if (decision === "approve_always") {
    wireDecision = "approve";
    scope = "session";
  } else {
    wireDecision = "deny";
    scope = "once";
  }
  const res = await authFetch(
    `/sessions/${encodeURIComponent(sessionId)}/permission`,
    {
      method: "POST",
      body: JSON.stringify({
        tool_id: toolId,
        decision: wireDecision,
        scope,
      }),
      signal,
    },
  );
  await throwIfNotOk(res, "respondToPermission");
}

/** Quick liveness probe. Returns false on any non-2xx or network error. */
export async function ping(signal?: AbortSignal): Promise<boolean> {
  try {
    // /health is unauthenticated, so skip fetchToken() for this path and
    // hit the base url directly. But we still need baseUrl.
    const { baseUrl } = await fetchToken();
    const { signal: combined, cleanup } = combineSignals(signal, 5_000);
    try {
      const res = await fetch(`${baseUrl}/health`, {
        method: "GET",
        signal: combined,
      });
      return res.ok;
    } finally {
      cleanup();
    }
  } catch {
    return false;
  }
}

// ----- SSE parsing helpers -----

// Returns the index of the first blank-line separator in buf, or -1 if none.
function findBlankLine(buf: string): number {
  // try \n\n first (most common), then \r\n\r\n
  const nn = buf.indexOf("\n\n");
  const rnrn = buf.indexOf("\r\n\r\n");
  if (nn === -1) return rnrn;
  if (rnrn === -1) return nn;
  return Math.min(nn, rnrn);
}

function blankLineLength(buf: string, idx: number): number {
  return buf.startsWith("\r\n\r\n", idx) ? 4 : 2;
}

function isEngineEvent(x: unknown): x is EngineEvent {
  if (!x || typeof x !== "object") return false;
  const t = (x as { type?: unknown }).type;
  if (typeof t !== "string") return false;
  return (
    t === "token" ||
    t === "thinking" ||
    t === "tool_start" ||
    t === "tool_result" ||
    t === "permission_request" ||
    t === "permission_granted" ||
    t === "permission_denied" ||
    t === "question_gate" ||
    t === "turn_complete" ||
    t === "error"
  );
}
