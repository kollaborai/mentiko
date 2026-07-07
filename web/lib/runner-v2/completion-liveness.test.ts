import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { completeAgent, evaluateAgentLiveness } from "@/lib/runner-v2/completion-runner";
import { createRunRecord, readRunJson, updateRunJson } from "@/lib/runner-v2/run-state";
import { createAgentAttempt, transitionAgentAttempt } from "@/lib/runner-v2/agent-attempt";

function runPath() {
  return join(mkdtempSync(join(tmpdir(), "runner-v2-completion-liveness-")), "run.json");
}

function seedRun(file: string) {
  const run = createRunRecord({ chainName: "chain", goal: "goal" });
  updateRunJson(file, () => ({
    ...run,
    id: "run-123",
    status: "running",
    agents: [{ id: "writer", name: "Writer", session: "writer-run-123", status: "running" }],
    sessions: ["writer-run-123"],
  }));
}

function seedSubmittedAttempt(file: string) {
  const attempt = createAgentAttempt({ runJsonPath: file, runId: "run-123", agentId: "writer" });
  transitionAgentAttempt({ runJsonPath: file, attemptId: attempt.id, to: "lease_acquired" });
  transitionAgentAttempt({ runJsonPath: file, attemptId: attempt.id, to: "pty_allocated" });
  transitionAgentAttempt({ runJsonPath: file, attemptId: attempt.id, to: "process_spawned" });
  transitionAgentAttempt({ runJsonPath: file, attemptId: attempt.id, to: "ready_for_instructions" });
  transitionAgentAttempt({ runJsonPath: file, attemptId: attempt.id, to: "instructions_submitted" });
  return attempt;
}

function attempts(file: string) {
  return (readRunJson(file).runnerV2 as { attempts?: Array<Record<string, unknown>> } | undefined)?.attempts || [];
}

const EXHAUSTED_RETRY = { policy: { max_retries: 1 }, currentAttempt: 1, taskId: "task-1" };

describe("evaluateAgentLiveness", () => {
  it("classifies a session that is alive and producing output as working", () => {
    expect(evaluateAgentLiveness({ sessionAlive: true, processAlive: true }).disposition).toBe("working");
    expect(evaluateAgentLiveness({ sessionAlive: true, outputChanged: true }).disposition).toBe("working");
  });

  it("grants bounded grace to an alive-but-silent session before the extension cap", () => {
    expect(evaluateAgentLiveness({
      sessionAlive: true,
      processAlive: false,
      outputChanged: false,
      extensionCount: 0,
      maxExtensions: 6,
    }).disposition).toBe("grace");
  });

  it("classifies an alive-but-silent session past the extension cap as a silent timeout", () => {
    expect(evaluateAgentLiveness({
      sessionAlive: true,
      processAlive: false,
      outputChanged: false,
      extensionCount: 6,
      maxExtensions: 6,
    }).disposition).toBe("silent-timeout");
    expect(evaluateAgentLiveness({ sessionAlive: true, outputChanged: true, extensionCount: 6, maxExtensions: 6 }).disposition)
      .toBe("silent-timeout");
  });

  it("classifies a missing/no signal session as dead", () => {
    expect(evaluateAgentLiveness(undefined).disposition).toBe("dead");
    expect(evaluateAgentLiveness({ sessionAlive: false, outputChanged: true }).disposition).toBe("dead");
  });
});

describe("runner-v2 completion runner: liveness-aware exhaustion", () => {
  it("does not terminalize an alive, producing agent when the no-event retry budget is exhausted", () => {
    const file = runPath();
    seedRun(file);
    seedSubmittedAttempt(file);

    const decision = completeAgent({
      runJsonPath: file,
      runId: "run-123",
      agent: { id: "writer", name: "Writer", emits: "draft-ready" },
      chain: { name: "Build Chain", agents: [{ id: "writer", emits: "draft-ready" }] },
      events: [],
      retry: EXHAUSTED_RETRY,
      liveness: { sessionAlive: true, processAlive: true, outputChanged: true },
      now: new Date("2026-06-25T10:00:00.000Z"),
    });

    expect(decision.action).toBe("await-liveness");
    // run + agent must stay live; nothing terminalized
    expect(readRunJson(file)).toMatchObject({
      status: "running",
      agents: [{ id: "writer", status: "running" }],
    });
    // no completion_failed attempt was written
    expect(attempts(file)[0]).toMatchObject({ phase: "instructions_submitted" });
    expect(attempts(file)[0].terminalReason).toBeUndefined();
  });

  it("defers on output change alone even without a live child process signal", () => {
    const file = runPath();
    seedRun(file);
    seedSubmittedAttempt(file);

    const decision = completeAgent({
      runJsonPath: file,
      runId: "run-123",
      agent: { id: "writer", emits: "draft-ready" },
      chain: { name: "Build Chain", agents: [{ id: "writer", emits: "draft-ready" }] },
      events: [],
      retry: EXHAUSTED_RETRY,
      liveness: { sessionAlive: true, outputChanged: true },
      now: new Date("2026-06-25T10:00:00.000Z"),
    });

    expect(decision.action).toBe("await-liveness");
    expect(readRunJson(file).status).toBe("running");
  });

  it("terminalizes an alive-but-silent agent once the bounded grace/extension cap is reached", () => {
    const file = runPath();
    seedRun(file);
    seedSubmittedAttempt(file);

    const decision = completeAgent({
      runJsonPath: file,
      runId: "run-123",
      agent: { id: "writer", name: "Writer", emits: "draft-ready" },
      chain: { name: "Build Chain", agents: [{ id: "writer", emits: "draft-ready" }] },
      events: [],
      retry: EXHAUSTED_RETRY,
      liveness: { sessionAlive: true, processAlive: false, outputChanged: false, extensionCount: 6, maxExtensions: 6 },
      now: new Date("2026-06-25T10:00:00.000Z"),
    });

    expect(decision.action).toBe("exhausted");
    expect(readRunJson(file)).toMatchObject({
      status: "stopped",
      agents: [{ id: "writer", status: "failed" }],
    });
    expect(attempts(file)[0]).toMatchObject({ phase: "completion_failed", terminalReason: "retries_exhausted" });
  });

  it("terminalizes a chatty agent that keeps producing output but never completes past the extension cap", () => {
    const file = runPath();
    seedRun(file);
    seedSubmittedAttempt(file);

    const decision = completeAgent({
      runJsonPath: file,
      runId: "run-123",
      agent: { id: "writer", name: "Writer", emits: "draft-ready" },
      chain: { name: "Build Chain", agents: [{ id: "writer", emits: "draft-ready" }] },
      events: [],
      retry: EXHAUSTED_RETRY,
      liveness: { sessionAlive: true, outputChanged: true, extensionCount: 6, maxExtensions: 6 },
      now: new Date("2026-06-25T10:00:00.000Z"),
    });

    expect(decision.action).toBe("exhausted");
    expect(readRunJson(file).status).toBe("stopped");
  });

  it("still terminalizes a dead agent (no liveness signal) — existing guard preserved", () => {
    const file = runPath();
    seedRun(file);
    seedSubmittedAttempt(file);

    const decision = completeAgent({
      runJsonPath: file,
      runId: "run-123",
      agent: { id: "writer", name: "Writer", emits: "draft-ready" },
      chain: { name: "Build Chain", agents: [{ id: "writer", emits: "draft-ready" }] },
      events: [],
      retry: EXHAUSTED_RETRY,
      now: new Date("2026-06-25T10:00:00.000Z"),
    });

    expect(decision.action).toBe("exhausted");
    expect(readRunJson(file)).toMatchObject({
      status: "stopped",
      status_message: "agent writer completed without declared event; retries exhausted",
    });
  });

  it("still terminalizes when the session is reported dead even if output somehow changed", () => {
    const file = runPath();
    seedRun(file);
    seedSubmittedAttempt(file);

    const decision = completeAgent({
      runJsonPath: file,
      runId: "run-123",
      agent: { id: "writer", emits: "draft-ready" },
      chain: { name: "Build Chain", agents: [{ id: "writer", emits: "draft-ready" }] },
      events: [],
      retry: EXHAUSTED_RETRY,
      liveness: { sessionAlive: false, outputChanged: true },
      now: new Date("2026-06-25T10:00:00.000Z"),
    });

    expect(decision.action).toBe("exhausted");
    expect(readRunJson(file).status).toBe("stopped");
  });

  it("does not fail a live agent on the no-retry path either", () => {
    const file = runPath();
    seedRun(file);
    seedSubmittedAttempt(file);

    const decision = completeAgent({
      runJsonPath: file,
      runId: "run-123",
      agent: { id: "writer", emits: "draft-ready" },
      chain: {
        name: "Build Chain",
        agents: [
          { id: "writer", emits: "draft-ready" },
          { id: "reviewer", triggers: ["draft-ready"] },
        ],
      },
      events: [],
      liveness: { sessionAlive: true, processAlive: true },
      now: new Date("2026-06-25T10:00:00.000Z"),
    });

    expect(decision.action).toBe("await-liveness");
    expect(readRunJson(file).status).toBe("running");
  });

  it("regression: a valid event present at check time completes/routes even under exhausted budget + live agent", () => {
    const file = runPath();
    seedRun(file);
    seedSubmittedAttempt(file);

    const decision = completeAgent({
      runJsonPath: file,
      runId: "run-123",
      agent: { id: "writer", emits: "draft-ready" },
      chain: {
        agents: [
          { id: "writer", emits: "draft-ready" },
          { id: "reviewer", triggers: ["draft-ready"] },
        ],
      },
      events: ["event: draft-ready\nsource: writer-run-123\nrun_id: run-123\nprocessed: false\n"],
      retry: EXHAUSTED_RETRY,
      liveness: { sessionAlive: true, outputChanged: true },
      now: new Date("2026-06-25T10:00:00.000Z"),
    });

    expect(decision).toMatchObject({
      action: "route",
      route: { action: "launch", agentIds: ["reviewer"] },
    });
    expect(readRunJson(file).agents[0]).toMatchObject({ id: "writer", status: "complete" });
  });
});
