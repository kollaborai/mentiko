import { homedir } from "node:os";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MonitorDriverIO } from "@/lib/runner-v2/monitor";
import type { MonitorObservation } from "@/lib/runner-v2/monitor-types";
import {
  captureAssertsAgentComplete,
  captureHash,
  findCompletionEventFile,
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
// The shared monitor's own latch and death/stall recovery are OR-shaped, so this
// adapter re-asserts the AND invariant on every terminal path it composes. A
// session whose turn ends with a stop_reason other than end_turn surfaces as a
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
  /** Control-call timeout (health/create/delete + message response start + response body reads). Default 10s. */
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

/** A control response plus the abort handle for its still-unread body. */
interface ControlResponse {
  response: Response;
  /** Abort the request's fetch controller: errors an in-flight body read. */
  abort: () => void;
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
    const cr = await this.controlFetch("/health", { method: "GET" }, "health check");
    if (!cr.response.ok) {
      await this.controlBody(cr, "health check body").catch(() => {});
      throw new EngineUnavailableError(`engine health check returned ${cr.response.status}`);
    }
    await this.controlBody(cr, "health check body").catch(() => {});
    return true;
  }

  async createSession(input: CreateSessionInput): Promise<string> {
    const body: Record<string, unknown> = { workspace: input.workspace };
    if (input.profile) body.profile = input.profile;
    if (input.mcpServers?.length) body.mcp_servers = input.mcpServers;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (input.mentikoSessionToken) headers["x-mentiko-session-token"] = input.mentikoSessionToken;
    const cr = await this.controlFetch(
      "/sessions",
      { method: "POST", headers, body: JSON.stringify(body) },
      "session create",
    );
    if (!cr.response.ok) {
      // Bounded drain of the error body: a server that stalls it must not hang
      // the create call past the deadline.
      await this.controlBody(cr, "session create error body").catch(() => {});
      throw new SessionFailedError(`session create returned ${cr.response.status}`, cr.response.status);
    }
    // Read the body FIRST so a stalled/aborted body surfaces as
    // EngineUnavailableError, not as a swallowed parse failure.
    const raw = await this.controlBody(cr, "session create body");
    let json: { session_id?: unknown } | null = null;
    try {
      json = JSON.parse(raw) as { session_id?: unknown };
    } catch {
      json = null;
    }
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
   *
   * `signal` (when given) stays live for the whole body: aborting it cancels
   * the stream mid-read, as does the idle timeout.
   */
  async *sendMessage(
    sessionId: string,
    content: string,
    signal?: AbortSignal,
  ): AsyncGenerator<EngineSseEvent> {
    const controller = new AbortController();
    const relayCallerAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", relayCallerAbort);
    }
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
      await this.boundedBody(response, () => controller.abort(), "message send error body").catch(() => {});
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
      // An idle-abort or caller abort ends iteration quietly: stalled output is
      // the monitor's signal (frozen captureHash -> stale cycles), not a
      // transport crash.
      if (!controller.signal.aborted) {
        throw toEngineError(error, "message stream");
      }
    } finally {
      if (idle) clearTimeout(idle);
      if (signal) signal.removeEventListener("abort", relayCallerAbort);
      // Cancel the underlying body on every exit (early iterator return
      // included): releaseLock alone abandons the response and its socket.
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  /**
   * Hard stop. DELETE is the only reliable teardown (cancel is a no-op for ACP
   * turns — spike finding 4a). 404 counts as success: the session is gone
   * either way, and teardown must be idempotent.
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    const cr = await this.controlFetch(
      `/sessions/${encodeURIComponent(sessionId)}`,
      { method: "DELETE" },
      "session delete",
    );
    await this.controlBody(cr, "session delete body").catch(() => {});
    if (cr.response.ok || cr.response.status === 404) return true;
    throw new SessionFailedError(`session delete returned ${cr.response.status}`, cr.response.status);
  }

  /** 200 -> session exists, 404 -> gone. Transport failures throw EngineUnavailableError. */
  async hasSession(sessionId: string): Promise<boolean> {
    const cr = await this.controlFetch(
      `/sessions/${encodeURIComponent(sessionId)}`,
      { method: "GET" },
      "session probe",
    );
    await this.controlBody(cr, "session probe body").catch(() => {});
    if (cr.response.ok) return true;
    if (cr.response.status === 404) return false;
    throw new SessionFailedError(`session probe returned ${cr.response.status}`, cr.response.status);
  }

  private url(path: string): string {
    return `${resolveEngineBaseUrl(this.env)}${path}`;
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${readEngineToken(this.env)}` };
  }

  /**
   * Control request whose fetch controller outlives the response headers: the
   * returned `abort()` puts a deadline on reading the body, so a server that
   * sends headers and then stalls its body cannot hang the call.
   */
  private async controlFetch(path: string, init: RequestInit, what: string): Promise<ControlResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(this.url(path), {
        ...init,
        headers: { ...this.authHeaders(), ...(init.headers as Record<string, string>) },
        signal: controller.signal,
      });
    } catch (error) {
      throw toEngineError(error, what);
    } finally {
      clearTimeout(timer);
    }
    return { response, abort: () => controller.abort() };
  }

  /** Read a control response's body with a deadline; abort errors the read. */
  private async controlBody(cr: ControlResponse, what: string): Promise<string> {
    return this.boundedBody(cr.response, cr.abort, what);
  }

  private async boundedBody(response: Response, abort: () => void, what: string): Promise<string> {
    const timer = setTimeout(abort, this.requestTimeoutMs);
    try {
      return await response.text();
    } catch (error) {
      throw toEngineError(error, what);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * One abort path for the whole request: the caller's signal (message stream
   * lifetime) and the deadline both abort the SAME controller that fetch (and
   * through it, the body reader) is tied to. The caller-signal relay is
   * deliberately never detached: the body must stay abortable for its whole
   * lifetime, so an idle timeout or stop() really cancels a stalled stream.
   */
  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    what: string,
  ): Promise<Response> {
    const controller = new AbortController();
    const outer = init.signal;
    if (outer instanceof AbortSignal) {
      if (outer.aborted) controller.abort();
      else outer.addEventListener("abort", () => controller.abort());
    }
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
  /** Partial line carried across token fragments — marker detection needs real line boundaries. */
  lineBuffer: string;
  agentCompleteSeen: boolean;
  /** Sticky: the marker AND the event file were both observed at least once. */
  bothSeen: boolean;
  lastStopReason: string | null;
  /** Message send hit a session-level failure (e.g. 409 daemon not running) or an engine stream error. */
  dead: boolean;
  stallReason: string | null;
  /** Consecutive liveness-probe transport failures (debounced before reporting gone). */
  probeFailures: number;
  /** Last DELETE failed; the session is kept so a later stop() can retry. */
  teardownFailed: boolean;
}

/** Consecutive transport failures before a probe blip is believed as "session gone". */
const PROBE_FAILURE_LIMIT = 3;

const MAX_ACCUMULATED_TEXT = 200_000;

interface TrackedDrain {
  controller: AbortController;
  done: Promise<void>;
}

/**
 * Drives one chain agent as an engine session and exposes the
 * transport-shaped surface of MonitorDriverIO: hasSession/observe/sendNudge,
 * plus stop() (hard teardown) and completion/stall probes. The terminal-side
 * handlers (onComplete/onDied/onStalled/... state files) are unchanged live
 * monitor behavior and are composed in by createKollabEngineMonitorIO — this
 * module never duplicates the completion rule, but it DOES re-assert its AND
 * shape on every terminal path (see createKollabEngineMonitorIO).
 */
export class KollabEngineDriver {
  readonly client: KollabEngineClient;
  /** The monitor-facing session name (engine session ids are engine-internal). */
  readonly sessionName: string;
  private readonly context: KollabEngineDriverContext;
  private readonly sessions = new Map<string, EngineSessionState>();
  private readonly drains = new Map<string, TrackedDrain[]>();

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
      lineBuffer: "",
      agentCompleteSeen: false,
      bothSeen: false,
      lastStopReason: null,
      dead: false,
      stallReason: null,
      probeFailures: 0,
      teardownFailed: false,
    });
    return sessionId;
  }

  /**
   * Deliver the initial prompt or a nudge. The SSE response is drained in the
   * background into the session state; the monitor reads the accumulation via
   * observe() each tick, exactly like PTY capture. Each drain is tracked and
   * abortable so stop() can cancel and await it.
   */
  send(sessionId: string, content: string): void {
    const state = this.requireState(sessionId);
    const controller = new AbortController();
    const tracked: TrackedDrain = { controller, done: Promise.resolve() };
    const list = this.drains.get(sessionId) ?? [];
    list.push(tracked);
    this.drains.set(sessionId, list);
    tracked.done = this.drain(
      this.client.sendMessage(sessionId, content, controller.signal),
      state,
      controller,
    ).finally(() => {
      const remaining = (this.drains.get(sessionId) ?? []).filter((t) => t !== tracked);
      if (remaining.length) this.drains.set(sessionId, remaining);
      else this.drains.delete(sessionId);
    });
  }

  /**
   * MonitorDriverIO.hasSession: transport liveness of the engine session.
   * A transport failure is NOT proof the session is gone — an engine blip must
   * not take the monitor down its death path while the agent still runs — so
   * probe failures are debounced over consecutive calls before reporting gone.
   */
  async hasSession(sessionId: string): Promise<boolean> {
    const state = this.sessions.get(sessionId);
    if (!state) return false;
    if (state.dead) return false;
    try {
      const alive = await this.client.hasSession(sessionId);
      state.probeFailures = 0;
      return alive;
    } catch {
      state.probeFailures += 1;
      return state.probeFailures < PROBE_FAILURE_LIMIT;
    }
  }

  /** MonitorDriverIO.observe: output hash + AND-shaped completion latch from engine state. */
  async observe(sessionId: string): Promise<Omit<MonitorObservation, "sessionAlive">> {
    const state = this.requireState(sessionId);
    const eventPresent = this.refreshBothSeen(state);
    return {
      // No local child process to watch; a dead engine session surfaces here.
      processGone: state.dead,
      captureHash: captureHash(state.text, 20),
      completionEventPresent: eventPresent,
      // The AND invariant, enforced here because the shared monitor's own latch
      // is OR-shaped (marker OR event). Only a session that produced BOTH its
      // AGENT_COMPLETE line and this run's declared event may report latched;
      // once both held, the latch is sticky (marker/event may scroll or be
      // consumed afterward).
      latched: state.bothSeen,
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
   * Hard stop = DELETE (cancel is a no-op for ACP turns). Cancels and awaits
   * every background drain first. Never throws: on a failed DELETE the session
   * is KEPT (marked teardown-failed, see teardownFailures()) so a later stop()
   * retries instead of silently orphaning the engine session.
   */
  async stop(sessionId: string): Promise<void> {
    const tracked = this.drains.get(sessionId) ?? [];
    for (const t of tracked) t.controller.abort();
    await Promise.allSettled(tracked.map((t) => t.done));
    this.drains.delete(sessionId);
    try {
      await this.client.deleteSession(sessionId);
      this.sessions.delete(sessionId);
    } catch (error) {
      const state = this.sessions.get(sessionId);
      if (state) state.teardownFailed = true;
      console.log(
        `kollab-engine-driver: session teardown failed for ${sessionId} (kept for retry): ${(error as Error).message}`,
      );
    }
  }

  /** Session ids whose last DELETE failed and are retained for a stop() retry. */
  teardownFailures(): string[] {
    return [...this.sessions.entries()]
      .filter(([, state]) => state.teardownFailed)
      .map(([id]) => id);
  }

  /**
   * The completion rule, unchanged: AGENT_COMPLETE asserted in the agent's own
   * output AND this run's declared completion event on disk. Either alone is
   * not success. Sticky once both have held.
   */
  async completionSatisfied(sessionId: string): Promise<boolean> {
    const state = this.requireState(sessionId);
    return this.refreshBothSeen(state);
  }

  /**
   * Why the session is not making progress, if the engine said so: a turn that
   * ended with a stop_reason other than end_turn, or a stream error event.
   * Unknown sessions read as null (safe for the composed monitor wrappers).
   */
  stallReason(sessionId: string): string | null {
    return this.sessions.get(sessionId)?.stallReason ?? null;
  }

  /** Whether this run's declared completion event is on disk (single-signal probe). */
  completionEventPresent(): boolean {
    return Boolean(this.findEventFile());
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

  /** Compute the AND latch; sticky in state once both signals have held. */
  private refreshBothSeen(state: EngineSessionState): boolean {
    if (state.bothSeen) return true;
    if (state.agentCompleteSeen && Boolean(this.findEventFile())) {
      state.bothSeen = true;
      writeLatch(this.context.sessionName, this.context.monitorStateDir);
      return true;
    }
    return false;
  }

  private requireState(sessionId: string): EngineSessionState {
    const state = this.sessions.get(sessionId);
    if (!state) {
      throw new SessionFailedError(`unknown engine session '${sessionId}' (not started by this driver)`);
    }
    return state;
  }

  private async drain(
    stream: AsyncGenerator<EngineSseEvent>,
    state: EngineSessionState,
    controller: AbortController,
  ): Promise<void> {
    try {
      for await (const event of stream) {
        this.applyEvent(state, event);
      }
      // Clean stream end proves end-of-turn: a trailing marker line without a
      // final newline is the agent's real last line. An aborted stream does
      // NOT prove that (the turn may still be in flight), so no flush there.
      if (!controller.signal.aborted) this.endOfTurn(state);
    } catch (error) {
      // Session-level failure (409 daemon not running, non-200, transport):
      // mark dead so the next observe() reports processGone and the monitor's
      // death path (never fabricated success) takes over.
      state.dead = true;
      state.stallReason = state.stallReason ?? (error as Error).message;
    }
  }

  private applyEvent(state: EngineSessionState, event: EngineSseEvent): void {
    const type = event.type;
    if (type === "turn_complete") {
      // A marker line complete at turn end counts even without a trailing \n.
      this.endOfTurn(state);
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
      // A stream error is a terminal condition for this session, not a generic
      // stall: mark it dead so the monitor takes its death path instead of
      // nudging a broken session until a flavorless stall.
      state.dead = true;
      return;
    }
    const text = eventText(event);
    if (!text) return;
    state.text = (state.text + text).slice(-MAX_ACCUMULATED_TEXT);
    if (type === "token") {
      // Tokens are arbitrary fragments, so only real line boundaries decide
      // whether a marker is standalone. Carry partial lines across fragments:
      // "AGENT_" + "COMPLETE\n" latches; "AGENT_COMPLETE" + "_EXAMPLE\n" never
      // does, because the line only completes as AGENT_COMPLETE_EXAMPLE.
      state.lineBuffer = (state.lineBuffer + text).slice(-MAX_ACCUMULATED_TEXT);
      let newline: number;
      while ((newline = state.lineBuffer.indexOf("\n")) >= 0) {
        const line = state.lineBuffer.slice(0, newline);
        state.lineBuffer = state.lineBuffer.slice(newline + 1);
        if (line.trim() === "AGENT_COMPLETE") state.agentCompleteSeen = true;
      }
      return;
    }
    // Full message events carry whole turns: judge them as complete text, never
    // through the fragment buffer. A harness notice glued onto the marker
    // inside one message ("...gateway-billing-noticeAGENT_COMPLETE") has no
    // standalone line and must not latch; the token stream owns that decision
    // where the marker really ended a line.
    if (captureAssertsAgentComplete(text)) state.agentCompleteSeen = true;
  }

  /** End of a turn: the buffered partial line, if any, is the agent's final line. */
  private endOfTurn(state: EngineSessionState): void {
    const trailing = state.lineBuffer;
    state.lineBuffer = "";
    if (trailing.trim() === "AGENT_COMPLETE") state.agentCompleteSeen = true;
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
 * MonitorDriverIO. The wiring lane (L2c) builds the terminal handlers the same
 * way the PTY monitor does today; nothing here reimplements them.
 *
 * The shared monitor's own completion surfaces are OR-shaped (its latch fires
 * on marker OR event; its live onDied/onStalled recover from the event file
 * alone). While the engine driver owns the session, that must not stand: every
 * terminal path below re-asserts the AND invariant — completion is only ever
 * reported (and the completion handler only ever launched) when the agent's
 * AGENT_COMPLETE line AND this run's completion event were both seen.
 */
export function createKollabEngineMonitorIO(
  driver: KollabEngineDriver,
  sessionId: string,
  terminal: MonitorTerminalIO,
): MonitorDriverIO {
  const sessionName = driver.sessionName;
  const log = (message: string) => {
    if (terminal.log) terminal.log(message);
  };

  // Terminal mutation guard for the death/stall/context paths: complete only
  // when BOTH signals hold; when the event file exists without the agent's
  // marker, the terminal handler's own event-first recovery would launch the
  // completion bridge on the event alone, so it is not invoked at all — the
  // run stays terminal and reconcile late-event recovery owns the orphan.
  const guarded = async (
    session: string,
    action: () => Promise<"complete" | "terminal">,
  ): Promise<"complete" | "terminal"> => {
    if (await driver.completionSatisfied(sessionId)) {
      await terminal.onComplete(session);
      return "complete";
    }
    if (driver.completionEventPresent()) {
      log(
        `kollab-engine-driver: ${session} ended with a completion event but no AGENT_COMPLETE in the agent stream; refusing single-signal completion`,
      );
      return "terminal";
    }
    return action();
  };

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
    onComplete: async (session) => {
      assertSession(session, sessionName);
      // The reducer only reaches the complete action through the AND-shaped
      // latch above, but the success action itself still re-asserts both
      // signals before launching the completion bridge (race guard).
      if (await driver.completionSatisfied(sessionId)) {
        await terminal.onComplete(session);
        return;
      }
      log(`kollab-engine-driver: ${session} complete action without both signals; skipping completion handler`);
    },
    onDied: async (session) => {
      assertSession(session, sessionName);
      return guarded(session, () => terminal.onDied(session));
    },
    onStalled: async (session, kind, count) => {
      assertSession(session, sessionName);
      // Surface the engine's own stall reason (non-end_turn stop, stream
      // error) instead of a generic quiescence label.
      const reason = driver.stallReason(sessionId);
      if (reason) log(`kollab-engine-driver: ${session} stalled: ${reason}`);
      return guarded(session, () => terminal.onStalled(session, kind, count));
    },
    onContextExhausted: async (session) => {
      assertSession(session, sessionName);
      return guarded(session, () => terminal.onContextExhausted(session));
    },
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
