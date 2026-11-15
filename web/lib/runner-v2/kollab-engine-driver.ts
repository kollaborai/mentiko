import { homedir } from "node:os";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MonitorDriverIO } from "@/lib/runner-v2/monitor";
import type { MonitorObservation } from "@/lib/runner-v2/monitor-types";
import {
  captureAssertsAgentComplete,
  captureHash,
  computeLatch,
  findCompletionEventFile,
  latchExists,
  readDeclaredEmits,
  writeLatch,
} from "@/lib/runner-v2/monitor-io";

// Kollab engine agent driver (lane L2b — module only, NOT wired into launches).
//
// Each chain agent runs as a kollabor_engine session (claude-code / codex over
// ACP) instead of a raw PTY CLI. The engine contract below was proven live by
// the spike (docs/spike-kollab-engine-driver.md, branch spike/kollab-engine-driver):
//
//   POST /sessions            {profile, workspace, mcp_servers} (+ x-mentiko-session-token)
//   POST /sessions/{id}/message  -> SSE stream of data:-only JSON lines (primary feed)
//   GET  /sessions/{id}          -> 200 vs 404 liveness
//   DELETE /sessions/{id}        -> hard stop (POST /cancel is a NO-OP for ACP turns)
//
// Completion keeps the monitor's exact rule: AGENT_COMPLETE in the stream AND
// the declared event file on disk (monitor-io helpers reused, never duplicated).
// A session whose turn ends with a stop_reason other than end_turn surfaces as a
// stall reason instead of success.

export class EngineUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineUnavailableError";
  }
}

export class SessionFailedError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "SessionFailedError";
    this.status = status;
  }
}

export class UnknownAgentCliError extends Error {
  readonly cli: string;
  constructor(cli: string) {
    super(`no kollab engine profile for cli '${cli}'`);
    this.name = "UnknownAgentCliError";
    this.cli = cli;
  }
}

// ---------------------------------------------------------------------------
// Engine client
// ---------------------------------------------------------------------------

export type EngineEnv = Record<string, string | undefined>;

export interface KollabEngineClientOptions {
  /** Override env lookup (tests inject process.env-free copies). */
  env?: EngineEnv;
  fetchImpl?: typeof fetch;
  /** Control-call timeout (health/create/delete + message response start). Default 10s. */
  requestTimeoutMs?: number;
  /** Max gap between SSE bytes before the stream is considered dead. Default 300s. */
  idleTimeoutMs?: number;
}

export interface CreateSessionInput {
  profile?: string;
  workspace: string;
  mcpServers?: string[];
  mentikoSessionToken?: string;
}

export type EngineSseEvent = Record<string, unknown> & { type?: string };

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_IDLE_TIMEOUT_MS = 300_000;

export function resolveEngineBaseUrl(env: EngineEnv): string {
  const raw = (env.KOLLABOR_ENGINE_URL ?? "").trim();
  if (!raw) {
    throw new EngineUnavailableError("KOLLABOR_ENGINE_URL is not configured");
  }
  return raw.replace(/\/+$/, "");
}

/**
 * Bearer token for the engine. Read fresh on every call: engines rotate the
 * token file on startup, so a cached token breaks after an engine restart.
 * KOLLAB_CONFIG_DIR isolates dev/probe engines from the shared ~/.kollab token.
 * Never log the value.
 */
export function readEngineToken(env: EngineEnv, homeDir: string = homedir()): string {
  const configDir = (env.KOLLAB_CONFIG_DIR ?? "").trim();
  const candidates = [
    configDir ? join(configDir, "engine.token") : "",
    join(homeDir, ".kollab", "engine.token"),
  ].filter(Boolean);
  for (const path of candidates) {
    try {
      const token = readFileSync(path, "utf8").trim();
      if (token) return token;
    } catch {
      /* try next candidate */
    }
  }
  throw new EngineUnavailableError(`no engine token found (looked in: ${candidates.join(", ")})`);
}

export class KollabEngineClient {
  private readonly env: EngineEnv;
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMs: number;
  private readonly idleTimeoutMs: number;

  constructor(options: KollabEngineClientOptions = {}) {
    this.env = options.env ?? process.env;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  }

  /** True when the engine answers /health. Throws EngineUnavailableError otherwise. */
  async health(): Promise<boolean> {
    const response = await this.controlFetch("/health", { method: "GET" }, "health check");
    if (!response.ok) {
      throw new EngineUnavailableError(`engine health check returned ${response.status}`);
    }
    await response.arrayBuffer().catch(() => {});
    return true;
  }

  async createSession(input: CreateSessionInput): Promise<string> {
    const body: Record<string, unknown> = { workspace: input.workspace };
    if (input.profile) body.profile = input.profile;
    if (input.mcpServers?.length) body.mcp_servers = input.mcpServers;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (input.mentikoSessionToken) headers["x-mentiko-session-token"] = input.mentikoSessionToken;
    const response = await this.controlFetch(
      "/sessions",
      { method: "POST", headers, body: JSON.stringify(body) },
      "session create",
    );
    if (!response.ok) {
      await response.arrayBuffer().catch(() => {});
      throw new SessionFailedError(`session create returned ${response.status}`, response.status);
    }
    const json = await response.json().catch(() => null) as { session_id?: unknown } | null;
    const sessionId = typeof json?.session_id === "string" ? json.session_id : "";
    if (!sessionId) {
      throw new SessionFailedError("session create response had no session_id");
    }
    return sessionId;
  }

  /**
   * POST a message and yield the parsed SSE events from the response body.
   * The engine subscribes before submitting the turn, so this stream is the
   * primary feed — no gap to backfill (spike finding 4c). Only `data:` lines
   * carry payloads; the engine sends no `event:` names.
   */
  async *sendMessage(sessionId: string, content: string): AsyncGenerator<EngineSseEvent> {
    const controller = new AbortController();
    const response = await this.fetchWithTimeout(
      this.url(`/sessions/${encodeURIComponent(sessionId)}/message`),
      {
        method: "POST",
        headers: {
          ...this.authHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content }),
        signal: controller.signal,
      },
      this.requestTimeoutMs,
      "message send",
    );
    if (!response.ok) {
      await response.arrayBuffer().catch(() => {});
      throw new SessionFailedError(`message send returned ${response.status}`, response.status);
    }
    if (!response.body) {
      throw new SessionFailedError("message send returned no stream body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let idle: ReturnType<typeof setTimeout> | undefined;
    const armIdle = () => {
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => controller.abort(), this.idleTimeoutMs);
    };
    try {
      armIdle();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        armIdle();
        buffer += decoder.decode(value, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          const event = parseSseLine(line);
          if (event) yield event;
        }
      }
      const tail = parseSseLine(buffer);
      if (tail) yield tail;
    } catch (error) {
      // An idle-abort ends iteration quietly: stalled output is the monitor's
      // signal (frozen captureHash -> stale cycles), not a transport crash.
      if (!controller.signal.aborted) {
        throw toEngineError(error, "message stream");
      }
    } finally {
      if (idle) clearTimeout(idle);
      reader.releaseLock();
    }
  }

  /**
   * Hard stop. DELETE is the only reliable teardown (cancel is a no-op for ACP
   * turns — spike finding 4a). 404 counts as success: the session is gone
   * either way, and teardown must be idempotent.
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    const response = await this.controlFetch(
      `/sessions/${encodeURIComponent(sessionId)}`,
      { method: "DELETE" },
      "session delete",
    );
    await response.arrayBuffer().catch(() => {});
    if (response.ok || response.status === 404) return true;
    throw new SessionFailedError(`session delete returned ${response.status}`, response.status);
  }

  /** 200 -> session exists, 404 -> gone. Transport failures throw EngineUnavailableError. */
  async hasSession(sessionId: string): Promise<boolean> {
    const response = await this.controlFetch(
      `/sessions/${encodeURIComponent(sessionId)}`,
      { method: "GET" },
      "session probe",
    );
    await response.arrayBuffer().catch(() => {});
    if (response.ok) return true;
    if (response.status === 404) return false;
    throw new SessionFailedError(`session probe returned ${response.status}`, response.status);
  }

  private url(path: string): string {
    return `${resolveEngineBaseUrl(this.env)}${path}`;
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${readEngineToken(this.env)}` };
  }

  private async controlFetch(
    path: string,
    init: RequestInit,
    what: string,
  ): Promise<Response> {
    return this.fetchWithTimeout(
      this.url(path),
      { ...init, headers: { ...this.authHeaders(), ...(init.headers as Record<string, string>) } },
      this.requestTimeoutMs,
      what,
    );
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    what: string,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      throw toEngineError(error, what);
    } finally {
      clearTimeout(timer);
    }
  }
}

function parseSseLine(line: string): EngineSseEvent | null {
  if (!line.startsWith("data:")) return null;
  const payload = line.slice(5).trimStart();
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as EngineSseEvent
      : null;
  } catch {
    return null;
  }
}

function toEngineError(error: unknown, what: string): Error {
  if (error instanceof EngineUnavailableError || error instanceof SessionFailedError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new EngineUnavailableError(`kollab engine ${what} failed: ${message}`);
}

// ---------------------------------------------------------------------------
// Profile mapping
// ---------------------------------------------------------------------------

// kollab -> undefined: let the engine pick its default profile.
const ENGINE_PROFILE_BY_CLI: Readonly<Record<string, string | undefined>> = {
  claude: "claude-code",
  codex: "codex-cli",
  kollab: undefined,
};

/**
 * Map a mentiko agent cli id to an engine profile name. Unknown CLIs throw
 * UnknownAgentCliError so the caller can fall back to the PTY launch instead of
 * silently running the engine's default agent.
 */
export function engineProfileForCli(cli: string): string | undefined {
  const key = cli.trim().toLowerCase();
  if (!(key in ENGINE_PROFILE_BY_CLI)) {
    throw new UnknownAgentCliError(cli);
  }
  return ENGINE_PROFILE_BY_CLI[key];
}

// ---------------------------------------------------------------------------
// MonitorDriverIO-compatible adapter
// ---------------------------------------------------------------------------

export interface KollabEngineDriverContext {
  sessionName: string;
  chainPath: string;
  runId: string;
  agentId: string;
  eventsDir: string;
  workspace: string;
  cli: string;
  mcpServers?: string[];
  mentikoSessionToken?: string;
  /** Run-local monitor bookkeeping root (latch files). Defaults to the shared dir. */
  monitorStateDir?: string;
}

interface EngineSessionState {
  /** Accumulated agent output text (tokens + agent/assistant messages). */
  text: string;
  agentCompleteSeen: boolean;
  lastStopReason: string | null;
  /** Message send hit a session-level failure (e.g. 409 daemon not running). */
  dead: boolean;
  stallReason: string | null;
}

const MAX_ACCUMULATED_TEXT = 200_000;

/**
 * Drives one chain agent as an engine session and exposes the
 * transport-shaped surface of MonitorDriverIO: hasSession/observe/sendNudge,
 * plus stop() (hard teardown) and completion/stall probes. The terminal-side
 * handlers (onComplete/onDied/onStalled/... state files) are unchanged live
 * monitor behavior and are composed in by createKollabEngineMonitorIO — this
 * module never duplicates the completion rule.
 */
export class KollabEngineDriver {
  readonly client: KollabEngineClient;
  /** The monitor-facing session name (engine session ids are engine-internal). */
  readonly sessionName: string;
  private readonly context: KollabEngineDriverContext;
  private readonly sessions = new Map<string, EngineSessionState>();

  constructor(client: KollabEngineClient, context: KollabEngineDriverContext) {
    this.client = client;
    this.context = context;
    this.sessionName = context.sessionName;
  }

  /** Create the engine session for this agent's workspace. Throws typed errors. */
  async start(): Promise<string> {
    const sessionId = await this.client.createSession({
      profile: engineProfileForCli(this.context.cli),
      workspace: this.context.workspace,
      mcpServers: this.context.mcpServers,
      mentikoSessionToken: this.context.mentikoSessionToken,
    });
    this.sessions.set(sessionId, {
      text: "",
      agentCompleteSeen: false,
      lastStopReason: null,
      dead: false,
      stallReason: null,
    });
    return sessionId;
  }

  /**
   * Deliver the initial prompt or a nudge. The SSE response is drained in the
   * background into the session state; the monitor reads the accumulation via
   * observe() each tick, exactly like PTY capture.
   */
  send(sessionId: string, content: string): void {
    const state = this.requireState(sessionId);
    void this.drain(sessionId, this.client.sendMessage(sessionId, content), state);
  }

  /** MonitorDriverIO.hasSession: transport liveness of the engine session. */
  async hasSession(sessionId: string): Promise<boolean> {
    const state = this.sessions.get(sessionId);
    if (state?.dead) return false;
    try {
      return await this.client.hasSession(sessionId);
    } catch {
      // Engine unreachable or probe failed: report the session as gone so the
      // monitor takes the session-gone path (event-first death check, which
      // still requires a real event to complete) instead of spinning.
      return false;
    }
  }

  /** MonitorDriverIO.observe: output hash + completion-event latch from engine state. */
  async observe(sessionId: string): Promise<Omit<MonitorObservation, "sessionAlive">> {
    const state = this.requireState(sessionId);
    const eventFile = this.findEventFile();
    const latched = computeLatch({
      alreadyLatched: latchExists(this.context.sessionName, this.context.monitorStateDir),
      markerDurable: state.agentCompleteSeen,
      completionEventPresent: Boolean(eventFile),
    });
    if (latched) writeLatch(this.context.sessionName, this.context.monitorStateDir);
    return {
      // No local child process to watch; a dead engine session surfaces here.
      processGone: state.dead,
      captureHash: captureHash(state.text, 20),
      completionEventPresent: Boolean(eventFile),
      latched,
      // Context exhaustion on the engine path is a turn-level failure surfaced
      // via stallReason (turn_complete stop_reason), not a repeated CLI error
      // tail; the reducer's debounce has no equivalent signal to count here.
      contextExhausted: false,
    };
  }

  /** MonitorDriverIO.sendNudge: a message POST, accepted mid-turn and between turns. */
  async sendNudge(sessionId: string, message: string): Promise<void> {
    this.send(sessionId, message);
  }

  /**
   * Hard stop = DELETE (cancel is a no-op for ACP turns). Never throws: a
   * failed teardown is logged, not escalated into a run failure.
   */
  async stop(sessionId: string): Promise<void> {
    try {
      await this.client.deleteSession(sessionId);
    } catch (error) {
      console.log(`kollab-engine-driver: session teardown failed for ${sessionId}: ${(error as Error).message}`);
    } finally {
      this.sessions.delete(sessionId);
    }
  }

  /**
   * The completion rule, unchanged: AGENT_COMPLETE asserted in the agent's own
   * output AND this run's declared completion event on disk. Either alone is
   * not success.
   */
  async completionSatisfied(sessionId: string): Promise<boolean> {
    const state = this.requireState(sessionId);
    return state.agentCompleteSeen && Boolean(this.findEventFile());
  }

  /**
   * Why the session is not making progress, if the engine said so: a turn that
   * ended with a stop_reason other than end_turn, or a stream error event.
   */
  stallReason(sessionId: string): string | null {
    return this.requireState(sessionId).stallReason;
  }

  private findEventFile(): string {
    return findCompletionEventFile({
      eventsDir: this.context.eventsDir,
      runId: this.context.runId,
      agentId: this.context.agentId,
      expectedEvent: readDeclaredEmits(this.context.chainPath, this.context.agentId),
      sessionName: this.context.sessionName,
    });
  }

  private requireState(sessionId: string): EngineSessionState {
    const state = this.sessions.get(sessionId);
    if (!state) {
      throw new SessionFailedError(`unknown engine session '${sessionId}' (not started by this driver)`);
    }
    return state;
  }

  private async drain(
    sessionId: string,
    stream: AsyncGenerator<EngineSseEvent>,
    state: EngineSessionState,
  ): Promise<void> {
    try {
      for await (const event of stream) {
        this.applyEvent(state, event);
      }
    } catch (error) {
      // Session-level failure (409 daemon not running, non-200, transport):
      // mark dead so the next observe() reports processGone and the monitor's
      // death path (event-first, never fabricated success) takes over.
      state.dead = true;
      state.stallReason = state.stallReason ?? (error as Error).message;
    }
  }

  private applyEvent(state: EngineSessionState, event: EngineSseEvent): void {
    const type = event.type;
    if (type === "turn_complete") {
      const stopReason = typeof event.stop_reason === "string" ? event.stop_reason : "";
      state.lastStopReason = stopReason || null;
      if (stopReason && stopReason !== "end_turn") {
        state.stallReason = state.stallReason
          ?? `engine turn ended with stop_reason '${stopReason}'`;
      }
      return;
    }
    if (type === "error") {
      const message = typeof event.message === "string" ? event.message
        : typeof event.error === "string" ? event.error
        : "engine stream error";
      state.stallReason = state.stallReason ?? `engine error: ${message}`;
      return;
    }
    const text = eventText(event);
    if (text) {
      state.text = (state.text + text).slice(-MAX_ACCUMULATED_TEXT);
      // Marker check runs per event as well as on the accumulation: the engine
      // can glue a harness notice directly onto the agent's final text inside
      // one message event (seen live: "...gateway-billing-noticeAGENT_COMPLETE"),
      // so the accumulated blob alone would miss a marker the agent did print
      // as its own line. Same standalone-line helper, applied at the
      // granularity where lines are actually separable.
      if (captureAssertsAgentComplete(text) || captureAssertsAgentComplete(state.text)) {
        state.agentCompleteSeen = true;
      }
    }
  }
}

/**
 * Token events carry raw model text; message events carry full turns. Field
 * names are read tolerantly (text/token/content, message/content/text) because
 * the exact payload shape is engine-version-dependent — anything missed simply
 * contributes no capture text, which degrades to a stall, never a false pass.
 */
function eventText(event: EngineSseEvent): string {
  const str = (value: unknown): string => (typeof value === "string" ? value : "");
  if (event.type === "token") {
    return str(event.text) || str(event.token) || str(event.content);
  }
  if (event.type === "message") {
    const messageType = str(event.message_type);
    if (messageType === "assistant" || messageType === "agent") {
      return str(event.message) || str(event.content) || str(event.text);
    }
  }
  return "";
}

/** The terminal-side live monitor behavior this adapter composes with. */
export type MonitorTerminalIO = Omit<
  MonitorDriverIO,
  "hasSession" | "observe" | "sendNudge" | "recheckCompletion"
>;

/**
 * Compose the engine driver with the existing terminal-side monitor handlers
 * (state files, completion bridge, death/stall classification) into a full
  MonitorDriverIO. The wiring lane (L2c) builds the terminal handlers the same
 * way the PTY monitor does today; nothing here reimplements them.
 */
export function createKollabEngineMonitorIO(
  driver: KollabEngineDriver,
  sessionId: string,
  terminal: MonitorTerminalIO,
): MonitorDriverIO {
  const sessionName = driver.sessionName;
  return {
    // async arrows so a session-name mismatch rejects instead of throwing
    // synchronously into callers that await.
    hasSession: async (session) => {
      assertSession(session, sessionName);
      return driver.hasSession(sessionId);
    },
    observe: async (session) => {
      assertSession(session, sessionName);
      return driver.observe(sessionId);
    },
    sendNudge: async (session, message) => {
      assertSession(session, sessionName);
      return driver.sendNudge(sessionId, message);
    },
    // One authoritative probe right before any terminal mutation: both halves
    // of the completion rule, freshly read.
    recheckCompletion: async (session) => {
      assertSession(session, sessionName);
      return driver.completionSatisfied(sessionId);
    },
    onComplete: terminal.onComplete,
    onDied: terminal.onDied,
    onStalled: terminal.onStalled,
    onContextExhausted: terminal.onContextExhausted,
    sleep: terminal.sleep,
    loadState: terminal.loadState,
    saveState: terminal.saveState,
    clearState: terminal.clearState,
    log: terminal.log,
  };
}

function assertSession(session: string, sessionName: string): void {
  if (session !== sessionName) {
    throw new SessionFailedError(`monitor session '${session}' does not match driver session '${sessionName}'`);
  }
}
