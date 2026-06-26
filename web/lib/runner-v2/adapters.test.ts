import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawn, spawnSync } from "child_process";
import { applyTypedExecutorPlan } from "@/lib/runner-v2/adapters";
import { parseRunnerEvent } from "@/lib/runner-v2/events";
import { createFanGroupState } from "@/lib/runner-v2/fan-group";
import { fanGroupPath } from "@/lib/runner-v2/fan-group-store";
import { createRunRecord, readRunJson, updateRunJson } from "@/lib/runner-v2/run-state";
import { planTerminalCompletion } from "@/lib/runner-v2/terminal-plan";

jest.mock("child_process", () => ({
  ...jest.requireActual("child_process"),
  spawn: jest.fn(() => ({ pid: 4242, unref: jest.fn() })),
  spawnSync: jest.fn(() => ({ status: 0, stdout: "import ok", stderr: "" })),
}));

function tempDir() {
  return mkdtempSync(join(tmpdir(), "runner-v2-adapters-"));
}

function seedRun(dir: string) {
  const runJsonPath = join(dir, "run.json");
  const run = createRunRecord({ chainName: "chain", goal: "goal" });
  updateRunJson(runJsonPath, () => ({
    ...run,
    id: "run-123",
    status: "running",
    agents: [],
    sessions: [],
  }));
  return runJsonPath;
}

function eventFile(dir: string, name: string, content: string) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

describe("runner-v2 adapters", () => {
  it("marks triggered event processed and archives owned sibling event files", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const eventsDir = join(dir, "events");
    const triggeredPath = eventFile(eventsDir, "trigger.event", "event: done\nsource: writer\nrun_id: run-123\nprocessed: false\n");
    const siblingPath = eventFile(eventsDir, "sibling.event", "event: note\nsource: writer-helper\nrun_id: run-123\nprocessed: false\n");
    const otherPath = eventFile(eventsDir, "other.event", "event: note\nsource: writer\nrun_id: run-999\nprocessed: false\n");
    const triggered = { ...parseRunnerEvent(readFileSync(triggeredPath, "utf8")), path: triggeredPath };
    const sibling = { ...parseRunnerEvent(readFileSync(siblingPath, "utf8")), path: siblingPath };
    const other = { ...parseRunnerEvent(readFileSync(otherPath, "utf8")), path: otherPath };

    applyTypedExecutorPlan({
      action: "route",
      effects: [{
        type: "event-side-effects",
        plan: { markProcessed: triggered, archiveOwned: [triggered, sibling] },
      }],
      launches: [],
    }, {
      runJsonPath,
      stateDir: dir,
    });

    expect(readFileSync(triggeredPath, "utf8")).toContain("processed: true");
    expect(existsSync(siblingPath)).toBe(false);
    expect(existsSync(join(eventsDir, "archive", "sibling.event"))).toBe(true);
    expect(existsSync(other.path || "")).toBe(true);
  });

  it("persists fan-group create effects", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const group = createFanGroupState({
      id: "group-1",
      event: "done",
      fanOutAgents: ["a", "b"],
      fanInAgent: "merge",
    });

    applyTypedExecutorPlan({
      action: "route",
      effects: [{ type: "fan-group-create", group }],
      launches: [],
    }, {
      runJsonPath,
      stateDir: dir,
    });

    expect(JSON.parse(readFileSync(fanGroupPath(dir, "group-1"), "utf8"))).toMatchObject({
      id: "group-1",
      fanOutAgents: ["a", "b"],
      fanInAgent: "merge",
    });
  });

  it("applies terminal run-status effects to run.json", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);

    applyTypedExecutorPlan({
      action: "loop-complete",
      effects: [{ type: "run-terminal", status: "completed", reason: "visited-agent-event" }],
      launches: [],
    }, {
      runJsonPath,
      stateDir: dir,
    });

    expect(readRunJson(runJsonPath)).toMatchObject({
      status: "completed",
      status_message: "visited-agent-event",
    });
  });

  it("starts launch plans through the process adapter", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const result = applyTypedExecutorPlan({
      action: "route",
      effects: [],
      launches: [{
        kind: "single",
        command: "echo ok",
        env: { MENTIKO_RUN_ID: "run-123" },
        detached: false,
      }],
    }, {
      runJsonPath,
      stateDir: dir,
    });

    expect(result.launchesStarted).toEqual([{ command: "echo ok", pid: 4242 }]);
  });

  it("dry run records planned work without mutating files or spawning", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);

    const result = applyTypedExecutorPlan({
      action: "route",
      effects: [{ type: "run-terminal", status: "completed", reason: "dry" }],
      launches: [{ kind: "single", command: "echo ok", env: {}, detached: false }],
    }, {
      runJsonPath,
      stateDir: dir,
      dryRun: true,
    });

    expect(result).toEqual({
      effectsApplied: ["run-terminal"],
      operations: [],
      launchesStarted: [{ command: "echo ok", pid: undefined }],
    });
    expect(readRunJson(runJsonPath).status).toBe("running");
  });

  it("applies generation import effects through the mentiko CLI", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const artifactsDir = join(dir, "artifacts");
    mkdirSync(artifactsDir, { recursive: true });

    const result = applyTypedExecutorPlan({
      action: "generation-terminal",
      effects: [{
        type: "generation-import",
        plan: {
          jobId: "job-1",
          generationKind: "chain_recommendation",
          runId: "run-123",
          artifactsDir,
          namespaceId: "default",
          orgId: "default",
        },
      }],
      launches: [],
    }, {
      runJsonPath,
      stateDir: dir,
    });

    expect(result.operations).toEqual([
      expect.objectContaining({
        type: "generation-import",
        jobId: "job-1",
        generationKind: "chain_recommendation",
        artifactsDir,
      }),
    ]);
    expect(readFileSync(join(dir, "generation-import.jsonl"), "utf8")).toContain("\"status\":\"complete\"");
    expect(spawn).not.toHaveBeenCalledWith(expect.stringContaining("mentiko"), expect.arrayContaining(["generation", "import"]), expect.anything());
    expect(spawnSync).toHaveBeenCalledWith(expect.stringContaining("/bin/mentiko"), ["generation", "import"], expect.objectContaining({
      env: expect.objectContaining({
        ARTIFACTS_DIR: artifactsDir,
        MENTIKO_GENERATION_JOB_ID: "job-1",
        MENTIKO_GENERATION_KIND: "chain_recommendation",
      }),
    }));
  });

  it("records terminal side-effect operations while applying run status", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const terminal = planTerminalCompletion({
      runId: "run-123",
      chainName: "Build Chain",
      chainPath: join(dir, "chain.json"),
      taskId: "task-1",
      lastEvent: "done",
      lastAgentId: "writer",
      sessions: ["writer-run-123"],
      schedule: "daily",
      onComplete: "chain:next-chain",
    });

    const result = applyTypedExecutorPlan({
      action: "terminal",
      effects: [{ type: "terminal", plan: terminal }],
      launches: [],
    }, {
      runJsonPath,
      stateDir: dir,
    });

    expect(readRunJson(runJsonPath).status).toBe("completed");
    expect(result.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "task-status", status: "completed", taskId: "task-1" }),
      expect.objectContaining({ type: "schedule-mark", status: "success" }),
      expect.objectContaining({ type: "webhook", event: "chain_complete" }),
      expect.objectContaining({ type: "event", event: "chain-complete" }),
      expect.objectContaining({ type: "plugin", event: "chain-completed" }),
      expect.objectContaining({ type: "notification", event: "chain-completed" }),
      expect.objectContaining({ type: "hook", event: "run-completed" }),
      expect.objectContaining({ type: "metadata-webhooks", event: "completed" }),
      expect.objectContaining({ type: "next-chain", chainName: "next-chain" }),
    ]));
    expect(readFileSync(join(dir, "events", "run-123-Build_Chain-chain-complete.event"), "utf8")).toContain("event: chain-complete");
    const scheduleState = JSON.parse(readFileSync(join(dir, "schedules", "state.json"), "utf8"));
    expect(scheduleState["chain.json"]).toEqual(expect.any(Number));
    expect(readFileSync(join(dir, "schedules", "chain.json.history"), "utf8")).toContain("success");
    expect(JSON.parse(readFileSync(join(dir, "watchdog-hooks", "dispatch.jsonl"), "utf8").trim())).toMatchObject({
      event: "run-completed",
      runId: "run-123",
      hookCount: 0,
    });
  });

  it("records retry exhausted side-effect operations while applying stopped status", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const retryStatePath = join(dir, "retry", "retry_writer.count");
    mkdirSync(join(dir, "retry"), { recursive: true });
    writeFileSync(retryStatePath, "1");

    const result = applyTypedExecutorPlan({
      action: "exhausted",
      effects: [{
        type: "retry",
        plan: {
          action: "exhausted",
          maxRetries: 1,
          currentAttempt: 1,
          circuitBreaker: { threshold: 5, timeout: 300 },
          onError: "rollback",
          steps: [
            { type: "circuit-breaker", action: "record-failure", chainName: "Build Chain", agentId: "writer", threshold: 5, timeout: 300 },
            { type: "retry-state", action: "clear", agentId: "writer" },
            { type: "rollback", action: "plan-only", agentId: "writer", startSha: "abc123" },
            { type: "run-status", status: "stopped", reason: "agent error, retries exhausted" },
            { type: "task-status", status: "stopped", taskId: "task-1" },
            { type: "hook", event: "run-error", runId: "run-123", details: { run_id: "run-123" } },
            { type: "notification", event: "agent-failed", chainName: "Build Chain", runId: "run-123", agentId: "writer", reason: "failed" },
            { type: "plugin", event: "chain-stopped", chainName: "Build Chain", runId: "run-123", agentId: "writer" },
            { type: "notification", event: "chain-failed", chainName: "Build Chain", runId: "run-123", reason: "failed" },
            { type: "metadata-webhooks", event: "failed", chainName: "Build Chain", runId: "run-123" },
          ],
        },
      }],
      launches: [],
    }, {
      runJsonPath,
      stateDir: dir,
    });

    expect(readRunJson(runJsonPath)).toMatchObject({
      status: "stopped",
      status_message: "agent error, retries exhausted",
    });
    expect(result.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "circuit-breaker", action: "record-failure" }),
      expect.objectContaining({ type: "retry-state", action: "clear" }),
      expect.objectContaining({ type: "rollback", action: "plan-only" }),
      expect.objectContaining({ type: "task-status", status: "stopped" }),
      expect.objectContaining({ type: "hook", event: "run-error" }),
      expect.objectContaining({ type: "notification", event: "agent-failed" }),
      expect.objectContaining({ type: "plugin", event: "chain-stopped" }),
      expect.objectContaining({ type: "metadata-webhooks", event: "failed" }),
    ]));
    expect(existsSync(retryStatePath)).toBe(false);
    expect(JSON.parse(readFileSync(join(dir, "retry", "circuit_Build Chain_writer.json"), "utf8"))).toMatchObject({
      failure_count: 1,
      threshold: 5,
      timeout: 300,
    });
    expect(JSON.parse(readFileSync(join(dir, "watchdog-hooks", "dispatch.jsonl"), "utf8").trim())).toMatchObject({
      event: "run-error",
      runId: "run-123",
      hookCount: 0,
    });
  });

  it("dispatches executable watchdog hooks with explicit argv", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const hooksDir = join(dir, "hooks");
    mkdirSync(hooksDir, { recursive: true });
    const hookPath = join(hooksDir, "notify.sh");
    writeFileSync(hookPath, "#!/bin/bash\nexit 0\n");
    chmodSync(hookPath, 0o755);

    applyTypedExecutorPlan({
      action: "terminal",
      effects: [{
        type: "terminal",
        plan: {
          reason: "no-downstream",
          steps: [
            { type: "run-status", status: "completed" },
            { type: "hook", event: "run-completed", runId: "run-123", details: { run_id: "run-123", task_id: "task-1" } },
          ],
        },
      }],
      launches: [],
    }, {
      runJsonPath,
      stateDir: dir,
      hooksDir,
    });

    expect(spawn).toHaveBeenCalledWith("/bin/bash", [
      hookPath,
      "run-completed",
      "run-123",
      JSON.stringify({ run_id: "run-123", task_id: "task-1" }),
    ], expect.objectContaining({ detached: true, stdio: "ignore" }));
    expect(JSON.parse(readFileSync(join(hooksDir, "dispatch.jsonl"), "utf8").trim())).toMatchObject({
      event: "run-completed",
      runId: "run-123",
      hookCount: 1,
    });
  });

  it("audits session policy decisions without mutating sessions directly", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);

    applyTypedExecutorPlan({
      action: "terminal",
      effects: [{
        type: "terminal",
        plan: {
          reason: "no-downstream",
          steps: [
            { type: "run-status", status: "completed" },
            { type: "session-policy", policy: "stop", sessions: ["writer-run-123", "monitor-writer-run-123"] },
          ],
        },
      }],
      launches: [],
    }, {
      runJsonPath,
      stateDir: dir,
    });

    expect(JSON.parse(readFileSync(join(dir, "session-policy.jsonl"), "utf8").trim())).toMatchObject({
      policy: "stop",
      sessions: ["writer-run-123", "monitor-writer-run-123"],
      applied: false,
      reason: "transport session control is legacy-only until typed runtime owns pty transport",
    });
  });

  it("launches resolved next-chain policies and audits missing chains", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const chainsDir = join(dir, "chains");
    const deployChainDir = join(chainsDir, "deploy");
    mkdirSync(deployChainDir, { recursive: true });
    writeFileSync(join(deployChainDir, "chain.json"), JSON.stringify({ name: "deploy" }));

    const found = applyTypedExecutorPlan({
      action: "terminal",
      effects: [{
        type: "terminal",
        plan: {
          reason: "no-downstream",
          steps: [
            { type: "run-status", status: "completed" },
            { type: "next-chain", chainName: "deploy", parentRunId: "run-123" },
          ],
        },
      }],
      launches: [],
    }, {
      runJsonPath,
      stateDir: dir,
      chainsDir,
    });

    expect(found.launchesStarted).toEqual([expect.objectContaining({
      command: expect.stringContaining(join(deployChainDir, "chain.json")),
      pid: 4242,
    })]);
    expect(spawn).toHaveBeenCalledWith("/bin/zsh", [
      "-lc",
      expect.stringContaining(join(deployChainDir, "chain.json")),
    ], expect.objectContaining({
      detached: true,
      env: expect.objectContaining({ MENTIKO_PARENT_RUN_ID: "run-123" }),
    }));
    expect(JSON.parse(readFileSync(join(dir, "next-chain.jsonl"), "utf8").trim())).toMatchObject({
      chainName: "deploy",
      parentRunId: "run-123",
      status: "launched",
    });

    applyTypedExecutorPlan({
      action: "terminal",
      effects: [{
        type: "terminal",
        plan: {
          reason: "no-downstream",
          steps: [
            { type: "run-status", status: "completed" },
            { type: "next-chain", chainName: "missing", parentRunId: "run-123" },
          ],
        },
      }],
      launches: [],
    }, {
      runJsonPath,
      stateDir: dir,
      chainsDir,
    });

    const records = readFileSync(join(dir, "next-chain.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(records[1]).toMatchObject({
      chainName: "missing",
      parentRunId: "run-123",
      status: "missing",
    });
  });

  it("writes auditable outbox records for external terminal operations", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);

    applyTypedExecutorPlan({
      action: "terminal",
      effects: [{
        type: "terminal",
        plan: {
          reason: "no-downstream",
          steps: [
            { type: "run-status", status: "completed" },
            { type: "task-status", status: "completed", taskId: "task-1" },
            { type: "webhook", event: "chain_complete", chainPath: join(dir, "chain.json"), lastEvent: "done", lastAgentId: "writer" },
            { type: "plugin", event: "chain-completed", chainName: "Build Chain", runId: "run-123", agentId: "writer" },
            { type: "notification", event: "chain-completed", chainName: "Build Chain", runId: "run-123", agentId: "writer" },
            { type: "metadata-webhooks", event: "completed", chainPath: join(dir, "chain.json"), chainName: "Build Chain", runId: "run-123" },
            { type: "legacy-webhook", url: "https://hooks.example.test/chain", payload: { chain: "Build Chain", status: "complete" } },
          ],
        },
      }],
      launches: [],
    }, {
      runJsonPath,
      stateDir: dir,
    });

    const records = readFileSync(join(dir, "external-effects.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "task-status", status: "queued", operation: expect.objectContaining({ taskId: "task-1" }) }),
      expect.objectContaining({ type: "webhook", status: "queued", operation: expect.objectContaining({ event: "chain_complete" }) }),
      expect.objectContaining({ type: "plugin", status: "queued", operation: expect.objectContaining({ event: "chain-completed" }) }),
      expect.objectContaining({ type: "notification", status: "queued", operation: expect.objectContaining({ event: "chain-completed" }) }),
      expect.objectContaining({ type: "metadata-webhooks", status: "queued", operation: expect.objectContaining({ event: "completed" }) }),
      expect.objectContaining({ type: "legacy-webhook", status: "queued", operation: expect.objectContaining({ url: "https://hooks.example.test/chain" }) }),
    ]));
  });

  it("writes rollback as plan-only audit instead of mutating git state", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);

    applyTypedExecutorPlan({
      action: "exhausted",
      effects: [{
        type: "retry",
        plan: {
          action: "exhausted",
          maxRetries: 1,
          currentAttempt: 1,
          circuitBreaker: { threshold: 5, timeout: 300 },
          onError: "rollback",
          steps: [
            { type: "rollback", action: "plan-only", agentId: "writer", startSha: "abc123" },
            { type: "run-status", status: "stopped", reason: "agent error, retries exhausted" },
          ],
        },
      }],
      launches: [],
    }, {
      runJsonPath,
      stateDir: dir,
    });

    expect(JSON.parse(readFileSync(join(dir, "rollback-plan.jsonl"), "utf8").trim())).toMatchObject({
      agentId: "writer",
      startSha: "abc123",
      action: "plan-only",
      applied: false,
      reason: "destructive rollback requires explicit operator approval",
    });
  });
});
