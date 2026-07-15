/**
 * @jest-environment node
 *
 * Executes every active shell-facing runner-event producer against an isolated
 * configured event root, then feeds the emitted bytes through the shared strict
 * raw validator and parser. Shell may select semantic inputs; it may not build
 * event fields, filenames, timestamps, or persistence paths.
 */

import { execFile, execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RUNNER_EVENT_RAW_FIELDS,
  parseRunnerEvent,
  serializeRunnerEvent,
  validateRawRunnerEvent,
  type RunnerEventRecord,
} from "@/lib/runner-v2/events";
import { findCompletionEventFile } from "@/lib/runner-v2/monitor-io";
import { eventIsOwnedBy } from "@/lib/runner-v2/event-side-effects";

const CODE_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const LIB = join(CODE_ROOT, "lib");
const EVENT_TRIGGER = join(LIB, "event-trigger.sh");
const AGENT_FUNCTIONS = join(LIB, "agent-functions.sh");
const COMPLETE = join(LIB, "chain-runner-complete.sh");
const EMITTER = join(LIB, "runner-event-emitter.js");
const MENTIKO = join(CODE_ROOT, "bin", "mentiko");
const AI_GATEWAY_SMOKE_AGENT = join(CODE_ROOT, "bin", "ai-gateway-smoke-agent.mjs");

interface EmissionResult {
  eventsDir: string;
  filename: string;
  content: string;
  event: RunnerEventRecord;
}

function isolatedEnvironment(eventsDir: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: process.env.NODE_ENV || "test",
    PATH: process.env.PATH || "",
    HOME: join(eventsDir, "home"),
    MENTIKO_CODE_ROOT: CODE_ROOT,
    MENTIKO_GLOBAL_ROOT: join(eventsDir, "global"),
    MENTIKO_PROJECT_ROOT: join(eventsDir, "project"),
    EVENTS_DIR: eventsDir,
    ...extra,
  };
}

function makeEventsDir(): string {
  const eventsDir = join(mkdtempSync(join(tmpdir(), "mentiko-typed-events-")), "events");
  mkdirSync(eventsDir, { recursive: true });
  return eventsDir;
}

function runBash(script: string, extra: Record<string, string> = {}): string {
  const eventsDir = makeEventsDir();
  execFileSync("/bin/bash", ["-c", script], {
    cwd: CODE_ROOT,
    env: isolatedEnvironment(eventsDir, extra),
    encoding: "utf8",
  });
  return eventsDir;
}

function emittedEvent(eventsDir: string): EmissionResult {
  const files = readdirSync(eventsDir).filter((file) => file.endsWith(".event"));
  expect(files).toHaveLength(1);
  const filename = files[0];
  const content = readFileSync(join(eventsDir, filename), "utf8");
  const validation = validateRawRunnerEvent(content);
  expect(validation.issues).toEqual([]);
  for (const field of RUNNER_EVENT_RAW_FIELDS) {
    expect(validation.fields).toHaveProperty(field);
  }
  return { eventsDir, filename, content, event: parseRunnerEvent(content) };
}

function shellFunction(functionName: string, file: string): string {
  return `
extract_function() {
  awk -v name=${q(functionName)} '
    $0 ~ "^" name "\\(\\)" { active=1 }
    active { print }
    active && /^}$/ { exit }
  ' ${q(file)}
}
eval "$(extract_function)"
`;
}

describe("typed runner-event producer contract", () => {
  it("event-trigger emit-event delegates canonical bytes to the typed writer", () => {
    const eventsDir = runBash(
      `source ${q(EVENT_TRIGGER)} >/dev/null
       emit-event "agent-complete" "writer" "url=https://example.com:8443/report" >/dev/null`,
      { MENTIKO_RUN_ID: "run-emit-1", RUN_ID: "run-emit-1" },
    );
    const result = emittedEvent(eventsDir);

    expect(result.filename).toBe("run-emit-1-writer-agent-complete.event");
    expect(result.event).toMatchObject({
      event: "agent-complete",
      source: "writer",
      runId: "run-emit-1",
      processed: false,
      data: "url=https://example.com:8443/report",
    });
  });

  it("bin/mentiko emit requires explicit scope for pre-run ingress", () => {
    const eventsDir = makeEventsDir();
    const rejected = spawnSync(MENTIKO, ["emit", "manual-start", "operator", "requested"], {
      cwd: CODE_ROOT,
      env: isolatedEnvironment(eventsDir),
      encoding: "utf8",
    });
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain("run-scoped events require a run id");
    expect(readdirSync(eventsDir).filter((file) => file.endsWith(".event"))).toEqual([]);

    execFileSync(MENTIKO, ["emit", "--scope", "ingress", "manual-start", "operator", "requested"], {
      cwd: CODE_ROOT,
      env: isolatedEnvironment(eventsDir),
      encoding: "utf8",
    });
    const result = emittedEvent(eventsDir);

    expect(result.filename).toBe("operator-manual-start.event");
    expect(result.event).toMatchObject({
      event: "manual-start",
      source: "operator",
      runId: "",
      data: "requested",
    });
  });

  it("the AI gateway smoke agent delegates its real completion event to the typed writer", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        choices: [{ message: { content: "gateway smoke ok" } }],
        usage: { input_tokens: 1, output_tokens: 3 },
      }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("mock gateway did not bind a TCP port");

    const eventsDir = makeEventsDir();
    const artifactsDir = join(eventsDir, "artifacts");
    try {
      await new Promise<void>((resolve, reject) => {
        execFile(process.execPath, [AI_GATEWAY_SMOKE_AGENT], {
          cwd: CODE_ROOT,
          env: isolatedEnvironment(eventsDir, {
            OPENAI_BASE_URL: `http://127.0.0.1:${address.port}/v1/`,
            OPENAI_API_KEY: "test-key",
            ARTIFACTS_DIR: artifactsDir,
            MENTIKO_RUN_ID: "run-gateway-smoke-1",
            MENTIKO_AGENT_ID: "gateway-smoke",
            MENTIKO_AGENT_EMITS: "gateway-smoke-complete",
          }),
          encoding: "utf8",
        }, (error) => error ? reject(error) : resolve());
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }

    const result = emittedEvent(eventsDir);
    expect(result.filename).toBe("run-gateway-smoke-1-gateway-smoke-gateway-smoke-complete.event");
    expect(result.event).toMatchObject({
      event: "gateway-smoke-complete",
      source: "gateway-smoke",
      runId: "run-gateway-smoke-1",
      data: "",
    });
  });

  it("the typed completion reader rejects cross-run and malformed files", () => {
    const eventsDir = makeEventsDir();
    writeFileSync(join(eventsDir, "other-run.event"), serializeRunnerEvent({
      event: "agent-complete",
      source: "writer",
      runId: "run-other",
      timestamp: "2026-07-15T00:00:00.000Z",
      processed: false,
      data: "done",
    }));
    writeFileSync(
      join(eventsDir, "malformed-current-run.event"),
      "event: agent-complete\nsource: writer\nrun_id: run-target\ntimestamp: 2026-07-15T00:00:00.000Z\nprocessed: false\n",
    );

    expect(findCompletionEventFile({
      eventsDir,
      runId: "run-target",
      agentId: "writer",
      expectedEvent: "agent-complete",
      sessionName: "writer",
    })).toBe("");

    writeFileSync(join(eventsDir, "current-run.event"), serializeRunnerEvent({
      event: "agent-complete",
      source: "writer",
      runId: "run-target",
      timestamp: "2026-07-15T00:00:01.000Z",
      processed: false,
      data: "done",
    }));
    expect(findCompletionEventFile({
      eventsDir,
      runId: "run-target",
      agentId: "writer",
      expectedEvent: "agent-complete",
      sessionName: "writer",
    })).toBe("current-run.event");
  });

  it("monitor diagnostics emit strict six-field events with structured data", () => {
    const eventsDir = runBash(
      `${shellFunction("_monitor_emit_diagnostic_event", AGENT_FUNCTIONS)}
       _monitor_emit_diagnostic_event "agent-timeout" "researcher" "no progress" "5" >/dev/null`,
      { MENTIKO_RUN_ID: "run-monitor-1", RUN_ID: "run-monitor-1" },
    );
    const result = emittedEvent(eventsDir);

    expect(result.filename).toMatch(/^\d{8}T\d{6}-run-monitor-1-researcher-agent-timeout\.event$/);
    expect(result.event).toMatchObject({
      event: "agent-timeout",
      source: "monitor",
      runId: "run-monitor-1",
    });
    expect(JSON.parse(result.event.data)).toEqual({
      agent: "researcher",
      reason: "no progress",
      stale_count: 5,
    });
    expect(result.event.fields).toMatchObject({
      agent: "researcher",
      reason: "no progress",
      stale_count: "5",
    });
    const owner = parseRunnerEvent(serializeRunnerEvent({
      event: "research-complete",
      source: "researcher",
      runId: "run-monitor-1",
      timestamp: "2026-07-15T00:00:00.000Z",
      data: "done",
    }));
    expect(eventIsOwnedBy(owner, result.event)).toBe(true);
  });

  it("completion diagnostics emit the same strict shape through their real entrypoint", () => {
    const eventsDir = runBash(
      `${shellFunction("emit_completion_diagnostic_event", COMPLETE)}
       emit_completion_diagnostic_event "agent-error" "writer" "missing completion event" >/dev/null`,
      { RUN_ID: "run-complete-1" },
    );
    const result = emittedEvent(eventsDir);

    expect(result.filename).toMatch(/^\d{8}T\d{6}-run-complete-1-writer-agent-error\.event$/);
    expect(result.event).toMatchObject({
      event: "agent-error",
      source: "chain-runner-complete",
      runId: "run-complete-1",
    });
    expect(JSON.parse(result.event.data)).toEqual({
      agent: "writer",
      reason: "missing completion event",
    });
    expect(result.event.fields).toMatchObject({
      agent: "writer",
      reason: "missing completion event",
    });
  });

  it("fails closed when a run-scoped diagnostic has no run id", () => {
    const eventsDir = makeEventsDir();
    const result = spawnSync(
      process.execPath,
      [
        EMITTER,
        "diagnostic",
        "--scope", "run",
        "--event", "agent-error",
        "--source", "monitor",
        "--run-id", "",
        "--agent", "writer",
        "--reason", "missing run id",
      ],
      { env: isolatedEnvironment(eventsDir), encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("run-scoped events require a run id");
    expect(readdirSync(eventsDir)).toEqual([]);
  });

  it("rejects run lifecycle events at the ingress boundary", () => {
    const eventsDir = makeEventsDir();
    const result = spawnSync(process.execPath, [
      EMITTER,
      "emit",
      "--scope", "ingress",
      "--event", "agent-complete",
      "--source", "writer",
      "--run-id", "",
      "--data", "done",
    ], { env: isolatedEnvironment(eventsDir), encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("run lifecycle event agent-complete cannot use ingress scope");
    expect(readdirSync(eventsDir)).toEqual([]);
  });

  it("fails closed when agent context is missing its run id", () => {
    const eventsDir = makeEventsDir();
    const result = spawnSync(MENTIKO, ["emit", "draft-ready"], {
      env: isolatedEnvironment(eventsDir, { MENTIKO_AGENT_ID: "writer" }),
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(readdirSync(eventsDir).filter((file) => file.endsWith(".event"))).toEqual([]);
  });

  it("reuses semantically identical retries and preserves differing concurrent events", async () => {
    const identicalDir = makeEventsDir();
    const common = [
      "emit", "--scope", "run", "--event", "draft-ready", "--source", "writer",
      "--run-id", "run-collision", "--data", "same", "--output", "json",
    ];
    const identicalResults = await Promise.all([
      invokeEmitter(identicalDir, common),
      invokeEmitter(identicalDir, common),
    ]);
    expect(new Set(identicalResults.map((result) => result.path)).size).toBe(1);
    expect(readdirSync(identicalDir).filter((file) => file.endsWith(".event"))).toHaveLength(1);

    const differingDir = makeEventsDir();
    await Promise.all([
      invokeEmitter(differingDir, [...common.slice(0, -4), "--data", "first", "--output", "json"]),
      invokeEmitter(differingDir, [...common.slice(0, -4), "--data", "second", "--output", "json"]),
    ]);
    const events = readdirSync(differingDir)
      .filter((file) => file.endsWith(".event"))
      .map((file) => parseRunnerEvent(readFileSync(join(differingDir, file), "utf8")));
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.data).sort()).toEqual(["first", "second"]);
    expect(readdirSync(differingDir).some((file) => file.includes("-collision-"))).toBe(true);
  });

  it("archives a real typed diagnostic by its top-level agent ownership field", () => {
    const eventsDir = runBash(
      `${shellFunction("_monitor_emit_diagnostic_event", AGENT_FUNCTIONS)}
       source ${q(EVENT_TRIGGER)} >/dev/null
       _monitor_emit_diagnostic_event "agent-timeout" "researcher" "no progress" "5" >/dev/null
       _monitor_emit_diagnostic_event "agent-timeout" "reviewer" "no progress" "5" >/dev/null
       emit-event "research-complete" "researcher" "done" >/dev/null
       archive-run-events "run-archive-1" "researcher" >/dev/null`,
      { MENTIKO_RUN_ID: "run-archive-1", RUN_ID: "run-archive-1" },
    );
    const archived = readdirSync(join(eventsDir, "archive"));
    const remaining = readdirSync(eventsDir).filter((file) => file.endsWith(".event"));

    expect(archived.some((file) => file.includes("researcher-agent-timeout"))).toBe(true);
    expect(archived).toContain("run-archive-1-researcher-research-complete.event");
    expect(remaining.some((file) => file.includes("reviewer-agent-timeout"))).toBe(true);
  });

  it("keeps shell producers as invocation-only entrypoints", () => {
    const eventTrigger = sourceFunction("emit-event", EVENT_TRIGGER);
    const monitorDiagnostic = sourceFunction("_monitor_emit_diagnostic_event", AGENT_FUNCTIONS);
    const completionDiagnostic = sourceFunction("emit_completion_diagnostic_event", COMPLETE);

    for (const producer of [eventTrigger, monitorDiagnostic, completionDiagnostic]) {
      expect(producer).toContain("runner-event-emitter.js");
      expect(producer).not.toMatch(/printf ['\"]event:/);
      expect(producer).not.toMatch(/cat\s*>[^\n]*\.event/);
      expect(producer).not.toMatch(/event_file=.*\.event/);
    }
    expect(readFileSync(AGENT_FUNCTIONS, "utf8")).not.toContain("ensure-event-file");

    const smokeProducer = sourceFunction("writeEvent", AI_GATEWAY_SMOKE_AGENT);
    expect(smokeProducer).toContain("runner-event-emitter.js");
    expect(smokeProducer).not.toMatch(/writeFileSync|event:|source:|run_id:|processed:|data:/);
  });

  it("compiles the typed emitter into the tenant runtime image", () => {
    const dockerfile = readFileSync(join(CODE_ROOT, "Dockerfile"), "utf8");
    expect(dockerfile).toContain("event-emitter-cli.ts");
    expect(dockerfile).toContain("--outfile=/context/lib/runner-event-emitter.js");
  });
});

function sourceFunction(functionName: string, file: string): string {
  const source = readFileSync(file, "utf8");
  const lines = source.split("\n");
  const start = lines.findIndex((line) =>
    line === `${functionName}() {` || line === `function ${functionName}() {`,
  );
  expect(start).toBeGreaterThanOrEqual(0);
  const end = lines.findIndex((line, index) => index > start && line === "}");
  expect(end).toBeGreaterThan(start);
  return lines.slice(start, end + 1).join("\n");
}

function q(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function invokeEmitter(eventsDir: string, args: string[]): Promise<{ path: string; filename: string }> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [EMITTER, ...args], {
      env: isolatedEnvironment(eventsDir),
      encoding: "utf8",
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`emitter failed: ${stderr || error.message}`));
        return;
      }
      resolve(JSON.parse(stdout));
    });
  });
}
