jest.mock("next/server", () => {
  class MockNextResponse {
    status: number;
    _body: unknown;
    constructor(body?: unknown, init?: { status?: number }) {
      this.status = init?.status ?? 200;
      this._body = body;
    }
    async text() { return typeof this._body === "string" ? this._body : JSON.stringify(this._body); }
    async json() { return typeof this._body === "string" ? JSON.parse(this._body) : this._body; }
    static json(body: unknown, init?: { status?: number }) {
      return new MockNextResponse(body, init);
    }
  }

  return { NextResponse: MockNextResponse };
});

jest.mock("@/lib/ai-engine/mentiko-mcp-ops-auth", () => ({
  requireOpsAuth: jest.fn().mockResolvedValue({
    userId: "user-1",
    sessionId: "session-1",
    namespaceId: "tenant-a",
    orgId: "engineering",
    role: "member",
    scopes: [],
  }),
}));

jest.mock("@/lib/config", () => ({
  __esModule: true,
  get config() {
    const orgRoot = [globalThis.__MENTIKO_RUNTIME_TEST_ROOT__, "namespaces", "tenant-a", "orgs", "engineering"].join("/");
    return {
      namespaceId: "tenant-a",
      orgId: "engineering",
      eventsDir: `${orgRoot}/events`,
      runsDir: `${orgRoot}/runs`,
    };
  },
  get default() {
    const orgRoot = [globalThis.__MENTIKO_RUNTIME_TEST_ROOT__, "namespaces", "tenant-a", "orgs", "engineering"].join("/");
    return {
      namespaceId: "tenant-a",
      orgId: "engineering",
      eventsDir: `${orgRoot}/events`,
      runsDir: `${orgRoot}/runs`,
    };
  },
  orgPath: jest.fn((namespaceId: string, orgId: string, ...segments: string[]) => {
    return [globalThis.__MENTIKO_RUNTIME_TEST_ROOT__, "namespaces", namespaceId, "orgs", orgId, ...segments].join("/");
  }),
}));

import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { GET } from "./route";

declare global {
  var __MENTIKO_RUNTIME_TEST_ROOT__: string;
}

function request(action: string, params: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/mentiko-mcp/ops/runtime");
  url.searchParams.set("action", action);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new Request(url);
}

describe("/api/mentiko-mcp/ops/runtime", () => {
  let root: string;
  let orgRoot: string;

  beforeEach(() => {
    root = join(tmpdir(), `mentiko-runtime-test-${Date.now()}-${Math.random()}`);
    globalThis.__MENTIKO_RUNTIME_TEST_ROOT__ = root;
    orgRoot = join(root, "namespaces", "tenant-a", "orgs", "engineering");
    mkdirSync(join(orgRoot, "events"), { recursive: true });
    mkdirSync(join(orgRoot, "runs", "run-1778724644028"), { recursive: true });
    mkdirSync(join(orgRoot, "logs"), { recursive: true });
    writeFileSync(
      join(orgRoot, "events", "20260514T021248-run-1778724644028-stalled.event"),
      [
        "event: run-stalled",
        "source: watchdog",
        "run_id: run-1778724644028",
        "timestamp: 2026-05-14T02:12:48.000Z",
        "processed: false",
        "data: run stalled",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(orgRoot, "runs", "run-1778724644028", "run.json"),
      JSON.stringify({
        id: "run-1778724644028",
        status: "stalled",
        agents: [
          { id: "researcher", status: "completed", completedAt: "2026-05-14T02:10:00.000Z" },
          { id: "writer", status: "pending" },
        ],
      }),
    );
    writeFileSync(
      join(orgRoot, "logs", "system.jsonl"),
      [
        JSON.stringify({ ts: "2026-05-14T02:12:00.000Z", level: "error", source: "chain-generation", message: "run stalled", detail: "run-1778724644028" }),
        JSON.stringify({ ts: "2026-05-14T02:11:00.000Z", level: "info", source: "scheduler", message: "tick" }),
      ].join("\n"),
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("reads allowed runtime files from current org roots", async () => {
    const res = await GET(request("read_file", {
      path: "events/20260514T021248-run-1778724644028-stalled.event",
    }));

    expect(res.status).toBe(200);
    const body = await res.json() as { content: string };
    expect(body.content).toContain("run-stalled");
  });

  test("rejects traversal outside approved runtime roots", async () => {
    const res = await GET(request("read_file", { path: "events/../../logs/system.jsonl" }));

    expect(res.status).toBe(403);
    await expect(res.text()).resolves.toContain("Path outside allowed runtime roots");
  });

  test("rejects symlinks that escape approved runtime roots", async () => {
    const secretPath = join(root, "secret.txt");
    writeFileSync(secretPath, "nope");
    symlinkSync(secretPath, join(orgRoot, "events", "escape.event"));

    const res = await GET(request("read_file", { path: "events/escape.event" }));

    expect(res.status).toBe(403);
  });

  test("returns run state diagnostics without broad filesystem access", async () => {
    const res = await GET(request("get_run_state", { runId: "run-1778724644028" }));

    expect(res.status).toBe(200);
    const body = await res.json() as { diagnostics: { status: string; pendingAgent: { id: string } } };
    expect(body.diagnostics.status).toBe("stalled");
    expect(body.diagnostics.pendingAgent.id).toBe("writer");
  });

  test("returns only event files for the requested run id", async () => {
    writeFileSync(
      join(orgRoot, "events", "opaque-owned.event"),
      [
        "event: agent-complete",
        "source: writer",
        "run_id: run-1778724644028",
        "timestamp: 2026-05-14T02:13:00.000Z",
        "processed: false",
        "data: owned",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(orgRoot, "events", "run-1778724644028-foreign.event"),
      [
        "event: agent-complete",
        "source: writer",
        "run_id: run-1778724644028-other",
        "timestamp: 2026-05-14T02:13:01.000Z",
        "processed: false",
        "data: foreign",
        "",
      ].join("\n"),
    );
    const res = await GET(request("get_run_events", { runId: "run-1778724644028" }));

    expect(res.status).toBe(200);
    const body = await res.json() as { events: Array<{ name: string; content: string; parsed: { event: string } }> };
    expect(body.events).toHaveLength(2);
    expect(body.events.map((event) => event.name)).toEqual(expect.arrayContaining([
      "20260514T021248-run-1778724644028-stalled.event",
      "opaque-owned.event",
    ]));
    expect(body.events.map((event) => event.parsed.event)).toEqual(expect.arrayContaining([
      "run-stalled",
      "agent-complete",
    ]));
    expect(body.events.map((event) => event.name)).not.toContain("run-1778724644028-foreign.event");
  });

  test("queries structured system logs with filters", async () => {
    const res = await GET(request("get_system_logs", {
      level: "error",
      query: "1778724644028",
      limit: "50",
    }));

    expect(res.status).toBe(200);
    const body = await res.json() as { logs: Array<{ source: string }> };
    expect(body.logs).toEqual([{ ts: "2026-05-14T02:12:00.000Z", level: "error", source: "chain-generation", message: "run stalled", detail: "run-1778724644028" }]);
  });
});
