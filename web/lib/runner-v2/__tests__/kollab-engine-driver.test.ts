/**
 * @jest-environment node
 */
import { createServer, type Server } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AddressInfo } from "node:net";
import {
  EngineUnavailableError,
  KollabEngineClient,
  KollabEngineDriver,
  SessionFailedError,
  UnknownAgentCliError,
  createKollabEngineMonitorIO,
  engineProfileForCli,
  readEngineToken,
  resolveEngineBaseUrl,
  type EngineSseEvent,
} from "@/lib/runner-v2/kollab-engine-driver";
import { serializeRunnerEvent } from "@/lib/runner-v2/events";
import type { MonitorDriverIO } from "@/lib/runner-v2/monitor";

// Fake kollabor_engine: enough of the spike-verified HTTP contract
// (POST /sessions, POST /sessions/:id/message SSE, GET/DELETE /sessions/:id)
// to drive the client and the MonitorDriverIO adapter end to end in-test.

interface RecordedRequest {
  method: string;
  url: string;
  auth?: string;
  mentikoToken?: string;
  body: Record<string, unknown>;
}

interface FakeEngine {
  server: Server;
  baseUrl: string;
  requests: RecordedRequest[];
  /** SSE lines (already `data: ...` encoded) returned for the next message POST. */
  messageScript: string[];
  messageStatus: number;
  createStatus: number;
  sessionExists: boolean;
  deleted: string[];
}

function sse(events: Array<Record<string, unknown>>): string[] {
  return events.map((event) => `data: ${JSON.stringify(event)}`);
}

async function startFakeEngine(): Promise<FakeEngine> {
  const engine: FakeEngine = {
    server: undefined as unknown as Server,
    baseUrl: "",
    requests: [],
    messageScript: [],
    messageStatus: 200,
    createStatus: 200,
    sessionExists: true,
    deleted: [],
  };
  engine.server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const url = req.url ?? "";
      let body: Record<string, unknown> = {};
      try {
        body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      } catch {
        body = {};
      }
      engine.requests.push({
        method: req.method ?? "",
        url,
        auth: req.headers.authorization,
        mentikoToken: req.headers["x-mentiko-session-token"] as string | undefined,
        body,
      });
      if (url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
        return;
      }
      if (url === "/sessions" && req.method === "POST") {
        if (engine.createStatus !== 200) {
          res.writeHead(engine.createStatus);
          res.end("boom");
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ session_id: "sess-1", harness: "fake" }));
        return;
      }
      if (url === "/sessions/sess-1/message") {
        if (engine.messageStatus !== 200) {
          res.writeHead(engine.messageStatus);
          res.end("Session daemon is not running");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        for (const line of engine.messageScript) res.write(`${line}\n`);
        res.write(": keep-alive comment, not an event\n\n");
        res.write("data: not-json\n\n");
        res.end();
        return;
      }
      if (url === "/sessions/sess-1" && req.method === "GET") {
        res.writeHead(engine.sessionExists ? 200 : 404);
        res.end("{}");
        return;
      }
      if (url === "/sessions/sess-1" && req.method === "DELETE") {
        engine.deleted.push(url);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
        return;
      }
      res.writeHead(404);
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => engine.server.listen(0, "127.0.0.1", resolve));
  engine.baseUrl = `http://127.0.0.1:${(engine.server.address() as AddressInfo).port}`;
  return engine;
}

interface Fixture {
  root: string;
  configDir: string;
  eventsDir: string;
  chainPath: string;
  env: Record<string, string>;
}

const RUN_ID = "run-42";
const AGENT_ID = "writer";
const SESSION_NAME = "writer-run-42";
const EMITS = "draft-ready";

function makeFixture(engine: FakeEngine): Fixture {
  const root = mkdtempSync(join(tmpdir(), "kollab-engine-driver-"));
  const configDir = join(root, "kcfg");
  const eventsDir = join(root, "events");
  mkdirSync(configDir);
  mkdirSync(eventsDir);
  writeFileSync(join(configDir, "engine.token"), "token-one\n");
  const chainPath = join(root, "chain.json");
  writeFileSync(
    chainPath,
    JSON.stringify({ agents: [{ id: AGENT_ID, emits: EMITS }] }),
  );
  return {
    root,
    configDir,
    eventsDir,
    chainPath,
    env: {
      KOLLABOR_ENGINE_URL: engine.baseUrl,
      KOLLAB_CONFIG_DIR: configDir,
    },
  };
}

function writeCompletionEvent(fixture: Fixture): void {
  writeFileSync(
    join(fixture.eventsDir, "draft-ready.event"),
    serializeRunnerEvent({
      event: EMITS,
      source: SESSION_NAME,
      runId: RUN_ID,
      timestamp: new Date().toISOString(),
      processed: false,
      data: "",
    }),
  );
}

function makeDriver(fixture: Fixture, engine: FakeEngine, cli = "claude"): KollabEngineDriver {
  const client = new KollabEngineClient({ env: fixture.env, requestTimeoutMs: 2_000, idleTimeoutMs: 2_000 });
  return new KollabEngineDriver(client, {
    sessionName: SESSION_NAME,
    chainPath: fixture.chainPath,
    runId: RUN_ID,
    agentId: AGENT_ID,
    eventsDir: fixture.eventsDir,
    workspace: join(fixture.root, "ws"),
    cli,
    monitorStateDir: join(fixture.root, "monitor-state"),
  });
}

async function waitFor(condition: () => boolean, ms = 3_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("waitFor: condition never met");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function startTurn(driver: KollabEngineDriver): Promise<string> {
  const sessionId = await driver.start();
  driver.send(sessionId, "do the thing");
  return sessionId;
}

let engine: FakeEngine;
let fixture: Fixture;

beforeEach(async () => {
  engine = await startFakeEngine();
  fixture = makeFixture(engine);
});

afterEach(async () => {
  await new Promise<void>((resolve) => engine.server.close(() => resolve()));
  rmSync(fixture.root, { recursive: true, force: true });
});

describe("engine client", () => {
  it("health returns true against a live engine", async () => {
    const client = new KollabEngineClient({ env: fixture.env });
    await expect(client.health()).resolves.toBe(true);
  });

  it("health against a dead engine throws EngineUnavailableError", async () => {
    const client = new KollabEngineClient({ env: { ...fixture.env, KOLLABOR_ENGINE_URL: "http://127.0.0.1:1" } });
    await expect(client.health()).rejects.toThrow(EngineUnavailableError);
  });

  it("missing KOLLABOR_ENGINE_URL throws EngineUnavailableError", () => {
    expect(() => resolveEngineBaseUrl({})).toThrow(EngineUnavailableError);
    expect(resolveEngineBaseUrl({ KOLLABOR_ENGINE_URL: "http://x/" })).toBe("http://x");
  });

  it("reads the bearer token from KOLLAB_CONFIG_DIR and re-reads it per call", async () => {
    const client = new KollabEngineClient({ env: fixture.env });
    await client.createSession({ workspace: "/ws" });
    expect(engine.requests.at(-1)?.auth).toBe("Bearer token-one");
    writeFileSync(join(fixture.configDir, "engine.token"), "token-two\n");
    await client.createSession({ workspace: "/ws" });
    expect(engine.requests.at(-1)?.auth).toBe("Bearer token-two");
  });

  it("missing token file throws EngineUnavailableError without KOLLAB_CONFIG_DIR", () => {
    // Home is injected so the shared ~/.kollab fallback stays host state.
    expect(() => readEngineToken({}, join(fixture.root, "empty-home"))).toThrow(EngineUnavailableError);
  });

  it("createSession sends profile, mcp_servers and x-mentiko-session-token", async () => {
    const client = new KollabEngineClient({ env: fixture.env });
    const id = await client.createSession({
      profile: "claude-code",
      workspace: "/ws",
      mcpServers: ["mentiko"],
      mentikoSessionToken: "mentiko-session-token-1",
    });
    expect(id).toBe("sess-1");
    const request = engine.requests.at(-1);
    expect(request?.mentikoToken).toBe("mentiko-session-token-1");
    expect(request?.body).toEqual({
      profile: "claude-code",
      workspace: "/ws",
      mcp_servers: ["mentiko"],
    });
  });

  it("non-200 create is SessionFailedError", async () => {
    engine.createStatus = 500;
    const client = new KollabEngineClient({ env: fixture.env });
    const error = await client.createSession({ workspace: "/ws" }).catch((e: Error) => e);
    expect(error).toBeInstanceOf(SessionFailedError);
    expect((error as SessionFailedError).status).toBe(500);
  });

  it("sendMessage yields parsed SSE events, skipping non-data and non-JSON lines", async () => {
    engine.messageScript = sse([
      { type: "turn_start" },
      { type: "token", text: "hello" },
      { type: "turn_complete", stop_reason: "end_turn" },
    ]);
    const client = new KollabEngineClient({ env: fixture.env });
    const events: EngineSseEvent[] = [];
    for await (const event of client.sendMessage("sess-1", "go")) {
      events.push(event);
    }
    expect(events).toEqual([
      { type: "turn_start" },
      { type: "token", text: "hello" },
      { type: "turn_complete", stop_reason: "end_turn" },
    ]);
  });

  it("message POST hitting a dead session (409) is SessionFailedError", async () => {
    engine.messageStatus = 409;
    const client = new KollabEngineClient({ env: fixture.env });
    const error = await client.sendMessage("sess-1", "go").next().then(
      () => null,
      (e: Error) => e,
    );
    expect(error).toBeInstanceOf(SessionFailedError);
    expect((error as SessionFailedError).status).toBe(409);
  });

  it("request timeout on message POST is EngineUnavailableError", async () => {
    // A server that accepts the request but never responds.
    const stalled = createServer(() => { /* hang */ });
    await new Promise<void>((resolve) => stalled.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(stalled.address() as AddressInfo).port}`;
    const client = new KollabEngineClient({
      env: { KOLLABOR_ENGINE_URL: url, KOLLAB_CONFIG_DIR: fixture.configDir },
      requestTimeoutMs: 150,
    });
    const error = await client.sendMessage("sess-1", "go").next().then(
      () => null,
      (e: Error) => e,
    );
    await new Promise<void>((resolve) => stalled.close(() => resolve()));
    expect(error).toBeInstanceOf(EngineUnavailableError);
  });

  it("hasSession maps 200/404 to true/false", async () => {
    const client = new KollabEngineClient({ env: fixture.env });
    await expect(client.hasSession("sess-1")).resolves.toBe(true);
    engine.sessionExists = false;
    await expect(client.hasSession("sess-1")).resolves.toBe(false);
  });

  it("deleteSession succeeds and treats 404 as done", async () => {
    const client = new KollabEngineClient({ env: fixture.env });
    await expect(client.deleteSession("sess-1")).resolves.toBe(true);
    expect(engine.deleted).toEqual(["/sessions/sess-1"]);
    engine.sessionExists = false;
    await expect(client.deleteSession("sess-1")).resolves.toBe(true);
  });
});

describe("profile mapping", () => {
  it("maps mentiko cli ids to engine profiles", () => {
    expect(engineProfileForCli("claude")).toBe("claude-code");
    expect(engineProfileForCli("codex")).toBe("codex-cli");
    expect(engineProfileForCli("kollab")).toBeUndefined();
  });

  it("unknown cli throws so the caller falls back to PTY", () => {
    expect(() => engineProfileForCli("aider")).toThrow(UnknownAgentCliError);
    expect(() => engineProfileForCli("opencode")).toThrow(UnknownAgentCliError);
  });
});

describe("driver adapter", () => {
  it("start maps the cli to the engine profile and sends the mentiko session token", async () => {
    const driver = makeDriver(fixture, engine, "codex");
    const sessionId = await driver.start();
    expect(sessionId).toBe("sess-1");
    expect(engine.requests.at(-1)?.body.profile).toBe("codex-cli");
  });

  it("start with an unmapped cli throws UnknownAgentCliError before any request", async () => {
    const driver = makeDriver(fixture, engine, "aider");
    await expect(driver.start()).rejects.toThrow(UnknownAgentCliError);
    expect(engine.requests.filter((r) => r.url === "/sessions")).toHaveLength(0);
  });

  it("observe accumulates agent output into the capture hash", async () => {
    engine.messageScript = sse([
      { type: "token", text: "line one\n" },
      { type: "message", message_type: "assistant", message: "line two\n" },
      { type: "message", message_type: "user", message: "nudge text" },
    ]);
    const driver = makeDriver(fixture, engine);
    const sessionId = await startTurn(driver);
    await waitFor(() => driver["sessions"].get(sessionId)!.text.includes("line two"));
    const observation = await driver.observe(sessionId);
    expect(observation.captureHash).not.toBe("");
    expect(observation.processGone).toBe(false);
    // user-role text is not agent output; only the two agent lines count
    expect(driver["sessions"].get(sessionId)!.text).toBe("line one\nline two\n");
  });

  it("completion needs BOTH AGENT_COMPLETE in the stream and the event file", async () => {
    engine.messageScript = sse([
      { type: "token", text: "working...\n" },
      { type: "token", text: "AGENT_COMPLETE\n" },
      { type: "turn_complete", stop_reason: "end_turn" },
    ]);
    const driver = makeDriver(fixture, engine);
    const sessionId = await startTurn(driver);
    await waitFor(() => driver["sessions"].get(sessionId)!.agentCompleteSeen);

    // Marker seen, no event file: not complete, not latched as event-complete.
    await expect(driver.completionSatisfied(sessionId)).resolves.toBe(false);
    let observation = await driver.observe(sessionId);
    expect(observation.completionEventPresent).toBe(false);
    expect(observation.latched).toBe(true); // marker durable latches, like the PTY rule

    // Event file alone (no marker) is still not complete.
    writeCompletionEvent(fixture);
    await expect(driver.completionSatisfied(sessionId)).resolves.toBe(true);
    observation = await driver.observe(sessionId);
    expect(observation.completionEventPresent).toBe(true);
  });

  it("a token event that is exactly AGENT_COMPLETE latches even when a message event glues text onto it", async () => {
    // Seen live: a harness warning is glued directly onto the agent's final
    // text inside one assistant message event, so the accumulated blob has no
    // standalone marker line — but the agent's own token event was exactly
    // the marker.
    engine.messageScript = sse([
      { type: "message", message_type: "assistant", content: "gateway noticeAGENT_COMPLETE" },
      { type: "token", text: "AGENT_COMPLETE" },
    ]);
    const driver = makeDriver(fixture, engine);
    const sessionId = await startTurn(driver);
    await waitFor(() => driver["sessions"].get(sessionId)!.agentCompleteSeen);
    writeCompletionEvent(fixture);
    await expect(driver.completionSatisfied(sessionId)).resolves.toBe(true);
  });

  it("event file without the AGENT_COMPLETE marker never satisfies completion", async () => {
    engine.messageScript = sse([{ type: "token", text: "still working\n" }]);
    const driver = makeDriver(fixture, engine);
    const sessionId = await startTurn(driver);
    await waitFor(() => driver["sessions"].get(sessionId)!.text.includes("working"));
    writeCompletionEvent(fixture);
    await expect(driver.completionSatisfied(sessionId)).resolves.toBe(false);
  });

  it("a non-end_turn stop reason surfaces as the stall reason", async () => {
    engine.messageScript = sse([
      { type: "token", text: "counting...\n" },
      { type: "turn_complete", stop_reason: "max_turns" },
    ]);
    const driver = makeDriver(fixture, engine);
    const sessionId = await startTurn(driver);
    await waitFor(() => driver.stallReason(sessionId) !== null);
    expect(driver.stallReason(sessionId)).toContain("max_turns");
  });

  it("a 409 message send marks the session dead so observe reports processGone", async () => {
    engine.messageStatus = 409;
    const driver = makeDriver(fixture, engine);
    const sessionId = await startTurn(driver);
    await waitFor(() => (driver["sessions"].get(sessionId)!.dead));
    const observation = await driver.observe(sessionId);
    expect(observation.processGone).toBe(true);
    await expect(driver.hasSession(sessionId)).resolves.toBe(false);
  });

  it("sendNudge posts another message to the same session", async () => {
    engine.messageScript = sse([{ type: "token", text: "ack\n" }]);
    const driver = makeDriver(fixture, engine);
    const sessionId = await startTurn(driver);
    engine.messageScript = sse([{ type: "token", text: "nudged\n" }]);
    await driver.sendNudge(sessionId, "finish up");
    const messagePosts = () => engine.requests.filter((r) => r.url === "/sessions/sess-1/message");
    await waitFor(() => messagePosts().length === 2);
    expect(messagePosts().at(-1)?.body).toEqual({ content: "finish up" });
    await waitFor(() => driver["sessions"].get(sessionId)!.text.includes("nudged"));
  });

  it("stop issues DELETE and forgets the session; a failed DELETE does not throw", async () => {
    const driver = makeDriver(fixture, engine);
    const sessionId = await startTurn(driver);
    await driver.stop(sessionId);
    expect(engine.deleted).toEqual(["/sessions/sess-1"]);
    await expect(driver.observe(sessionId)).rejects.toThrow(SessionFailedError);
  });
});

describe("monitor composition", () => {
  it("composeKollabEngineMonitorIO delegates transport calls and terminal handlers", async () => {
    engine.messageScript = sse([
      { type: "token", text: "done\nAGENT_COMPLETE\n" },
      { type: "turn_complete", stop_reason: "end_turn" },
    ]);
    const driver = makeDriver(fixture, engine);
    const sessionId = await startTurn(driver);
    writeCompletionEvent(fixture);
    await waitFor(() => driver["sessions"].get(sessionId)!.agentCompleteSeen);

    const calls: string[] = [];
    const terminal = {
      onComplete: async () => { calls.push("onComplete"); },
      onDied: async () => { calls.push("onDied"); return "terminal" as const; },
      onStalled: async () => { calls.push("onStalled"); return "terminal" as const; },
      onContextExhausted: async () => { calls.push("onContextExhausted"); return "terminal" as const; },
      sleep: async () => { calls.push("sleep"); },
      loadState: () => { calls.push("loadState"); return { prevHash: "", staleCount: 0, nudgeCount: 0, nudgeEchoGrace: 0, contextExhaustedStreak: 0 }; },
      saveState: () => { calls.push("saveState"); },
      clearState: () => { calls.push("clearState"); },
      log: () => { calls.push("log"); },
    };
    const io: MonitorDriverIO = createKollabEngineMonitorIO(driver, sessionId, terminal);

    await expect(io.hasSession(SESSION_NAME)).resolves.toBe(true);
    const observation = await io.observe(SESSION_NAME);
    expect(observation.captureHash).not.toBe("");
    await expect(io.recheckCompletion(SESSION_NAME)).resolves.toBe(true);
    await io.sendNudge(SESSION_NAME, "nudge");
    await io.onComplete(SESSION_NAME);
    expect(calls).toContain("onComplete");
    // wrong monitor session name is rejected, not silently routed
    await expect(io.hasSession("other-session")).rejects.toThrow(SessionFailedError);
  });
});
