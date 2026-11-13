const mockCheckAuth = jest.fn();

jest.mock("@/lib/auth/api-auth", () => ({
  checkAuth: (...args: unknown[]) => mockCheckAuth(...args),
}));

jest.mock("@/lib/config", () => {
  const config = {
    get eventsDir() {
      return globalThis.__MENTIKO_EVENTS_EMIT_TEST_DIR__;
    },
  };
  return { __esModule: true, config, default: config };
});

import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseRunnerEvent } from "@/lib/runner-v2/events";
import { POST } from "./route";

declare global {
  var __MENTIKO_EVENTS_EMIT_TEST_DIR__: string;
}

describe("POST /api/events/emit", () => {
  let eventsDir: string;

  beforeEach(() => {
    eventsDir = join(tmpdir(), `mentiko-events-emit-${Date.now()}-${Math.random()}`);
    globalThis.__MENTIKO_EVENTS_EMIT_TEST_DIR__ = eventsDir;
    mockCheckAuth.mockResolvedValue(true);
  });

  afterEach(() => {
    rmSync(eventsDir, { recursive: true, force: true });
  });

  function emit(body: Record<string, unknown>) {
    return POST(new Request("http://localhost/api/events/emit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }) as never);
  }

  it("writes a canonical event that round-trips through the shared parser", async () => {
    const response = await emit({
      event: "review-approved",
      source: "reviewer",
      runId: "run-123",
      data: "approved",
    });

    expect(response.status).toBe(200);
    const files = readdirSync(eventsDir).filter((file) => file.endsWith(".event"));
    expect(files).toEqual(["reviewer-review-approved.event"]);
    expect(parseRunnerEvent(readFileSync(join(eventsDir, files[0]), "utf8"))).toMatchObject({
      event: "review-approved",
      source: "reviewer",
      runId: "run-123",
      data: "approved",
      fields: {
        occurrence_id: expect.any(String),
        content_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
  });

  it("keeps byte-identical unkeyed emissions as distinct occurrences", async () => {
    const body = {
      event: "review-approved",
      source: "reviewer",
      runId: "run-123",
      data: "approved",
    };
    const first = await emit(body);
    const second = await emit(body);
    const files = readdirSync(eventsDir).filter((file) => file.endsWith(".event"));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(files).toHaveLength(2);
    const records = files.map((file) => parseRunnerEvent(readFileSync(join(eventsDir, file), "utf8")));
    expect(new Set(records.map((record) => record.fields.occurrence_id)).size).toBe(2);
    expect(new Set(records.map((record) => record.fields.content_sha256)).size).toBe(1);
  });

  it("returns 400 and writes nothing for multiline physical fields", async () => {
    const response = await emit({
      event: "review-approved",
      source: "reviewer",
      data: "approved\nsource: injected",
    });

    expect(response.status).toBe(400);
    expect(readdirSync(eventsDir)).toEqual([]);
  });
});
