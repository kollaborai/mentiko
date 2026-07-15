const mockCheckAuth = jest.fn();

jest.mock("@/lib/auth/api-auth", () => ({
  checkAuth: (...args: unknown[]) => mockCheckAuth(...args),
}));

jest.mock("@/lib/config", () => {
  const config = {
    get eventsDir() {
      return globalThis.__MENTIKO_EVENTS_ROUTE_TEST_DIR__;
    },
  };
  return { __esModule: true, config, default: config };
});

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GET } from "./route";

declare global {
  var __MENTIKO_EVENTS_ROUTE_TEST_DIR__: string;
}

function canonicalEvent(event: string, runId = "run-configured") {
  return [
    `event: ${event}`,
    "source: route-test",
    `run_id: ${runId}`,
    "timestamp: 2026-07-14T12:00:00.000Z",
    "processed: false",
    "data: ok",
    "",
  ].join("\n");
}

describe("GET /api/events", () => {
  let root: string;
  let configuredDir: string;
  let alternateDir: string;

  beforeEach(() => {
    mockCheckAuth.mockResolvedValue(true);
    root = join(tmpdir(), `mentiko-events-route-${Date.now()}-${Math.random()}`);
    configuredDir = join(root, "configured-events");
    alternateDir = join(root, "alternate-events");
    globalThis.__MENTIKO_EVENTS_ROUTE_TEST_DIR__ = configuredDir;
    mkdirSync(configuredDir, { recursive: true });
    mkdirSync(alternateDir, { recursive: true });
    writeFileSync(join(configuredDir, "valid.event"), canonicalEvent("configured-event"));
    writeFileSync(join(configuredDir, "invalid.event"), "event: malformed\nprocessed: false\n");
    writeFileSync(join(alternateDir, "alternate.event"), canonicalEvent("alternate-event", "run-alternate"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("reads only the configured event root and excludes invalid raw files", async () => {
    const url = new URL("http://localhost/api/events");
    url.searchParams.set("dir", alternateDir);

    const response = await GET(new Request(url) as never);
    const body = await response.json() as { data: { events: Array<{ event: string; filename: string }> } };

    expect(response.status).toBe(200);
    expect(body.data.events).toEqual([
      expect.objectContaining({ event: "configured-event", filename: "valid.event" }),
    ]);
  });
});
