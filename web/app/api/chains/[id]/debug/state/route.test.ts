const mockCheckAuth = jest.fn();

jest.mock("@/lib/auth/api-auth", () => ({
  checkAuth: (...args: unknown[]) => mockCheckAuth(...args),
}));

jest.mock("@/lib/config", () => {
  const path = jest.requireActual("node:path");
  const os = jest.requireActual("node:os");
  const root = path.join(os.tmpdir(), `mentiko-debug-state-route-${process.pid}`);
  const isolatedConfig = {
    namespaceId: "default",
    stateDir: path.join(root, "state"),
    runsDir: path.join(root, "runs"),
    eventsDir: path.join(root, "configured-events"),
  };
  return { __esModule: true, config: isolatedConfig, default: isolatedConfig };
});

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import config from "@/lib/config";
import { serializeRunnerEvent } from "@/lib/runner-v2/events";
import { GET } from "./route";

interface DebugStateResponse {
  data: {
    recent_output: Array<{
      timestamp: string;
      source: string;
      level: "info" | "warn" | "error" | "debug";
      message: string;
    }>;
  };
}

const RUN_ID = "run-debug-state";
const ROOT = dirname(config.stateDir);

function writeRunState(): void {
  const runDir = join(config.runsDir, RUN_ID);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "run.json"), JSON.stringify({ status: "running", agents: [] }));
  writeFileSync(join(runDir, "chain.json"), JSON.stringify({
    name: "Debug State Contract",
    version: "1.0",
    agents: [],
  }));
}

function canonicalEvent(
  event: string,
  timestamp: string,
  extensionFields?: Record<string, string>,
  runId = RUN_ID,
): string {
  return serializeRunnerEvent({
    event,
    source: "debug-state-test",
    runId,
    timestamp,
    processed: false,
    data: "payload",
    extensionFields,
  });
}

async function readDebugState(url = `http://localhost/api/chains/${RUN_ID}/debug/state`) {
  const response = await GET(new Request(url) as never, {
    params: Promise.resolve({ id: RUN_ID }),
  });
  const body = await response.json() as DebugStateResponse;
  return { response, body };
}

describe("GET /api/chains/[id]/debug/state canonical event output", () => {
  beforeEach(() => {
    mockCheckAuth.mockReset();
    mockCheckAuth.mockResolvedValue(true);
    if (existsSync(ROOT)) rmSync(ROOT, { recursive: true });
    mkdirSync(config.stateDir, { recursive: true });
    mkdirSync(config.eventsDir, { recursive: true });
    writeRunState();
  });

  afterEach(() => {
    if (existsSync(ROOT)) rmSync(ROOT, { recursive: true });
  });

  it("shows strict canonical .event output using its extension fields", async () => {
    writeFileSync(
      join(config.eventsDir, "canonical.event"),
      canonicalEvent("agent-progress", "2026-07-15T15:30:00.000Z", {
        level: "warn",
        message: "Agent is waiting for input",
      }),
    );

    const { response, body } = await readDebugState();

    expect(response.status).toBe(200);
    expect(body.data.recent_output).toEqual([{
      timestamp: "2026-07-15T15:30:00.000Z",
      source: "debug-state-test",
      level: "warn",
      message: "Agent is waiting for input",
    }]);
  });

  it("ignores obsolete JSON artifacts and malformed canonical files", async () => {
    writeFileSync(join(config.eventsDir, "obsolete.json"), JSON.stringify({
      event: "legacy-output",
      timestamp: "2026-07-15T15:31:00.000Z",
      source: "legacy-reader",
      message: "must stay invisible",
    }));
    writeFileSync(
      join(config.eventsDir, "malformed.event"),
      "event: incomplete\nsource: debug-state-test\nprocessed: false\n",
    );

    const { response, body } = await readDebugState();

    expect(response.status).toBe(200);
    expect(body.data.recent_output).toEqual([]);
  });

  it("scans the configured root instead of a request-supplied alternate root", async () => {
    const alternateDir = join(ROOT, "alternate-events");
    mkdirSync(alternateDir, { recursive: true });
    writeFileSync(
      join(config.eventsDir, "configured.event"),
      canonicalEvent("configured-output", "2026-07-15T15:32:00.000Z"),
    );
    writeFileSync(
      join(alternateDir, "alternate.event"),
      canonicalEvent("alternate-output", "2026-07-15T15:33:00.000Z"),
    );
    const url = new URL(`http://localhost/api/chains/${RUN_ID}/debug/state`);
    url.searchParams.set("eventsDir", alternateDir);

    const { response, body } = await readDebugState(url.toString());

    expect(response.status).toBe(200);
    expect(body.data.recent_output).toEqual([
      expect.objectContaining({ message: "configured-output" }),
    ]);
  });

  it("shows only the selected run and excludes other-run and runless ingress events", async () => {
    writeFileSync(
      join(config.eventsDir, "selected.event"),
      canonicalEvent("selected-output", "2026-07-15T15:34:00.000Z"),
    );
    writeFileSync(
      join(config.eventsDir, "other-run.event"),
      canonicalEvent("other-run-output", "2026-07-15T15:35:00.000Z", undefined, "run-other"),
    );
    writeFileSync(
      join(config.eventsDir, "ingress.event"),
      canonicalEvent("ingress-output", "2026-07-15T15:36:00.000Z", undefined, ""),
    );

    const { response, body } = await readDebugState();

    expect(response.status).toBe(200);
    expect(body.data.recent_output).toEqual([
      expect.objectContaining({ message: "selected-output" }),
    ]);
  });
});
