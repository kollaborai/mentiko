import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runCompletionPipeline } from "@/lib/runner-v2/completion-pipeline";
import {
  createAgentAttempt,
  readRunnerV2AttemptState,
  transitionAgentAttempt,
} from "@/lib/runner-v2/agent-attempt";
import { readLoopState, shellLoopStatePath, writeLoopState } from "@/lib/runner-v2/loop-state";
import { createRunRecord, readRunJson, updateRunJson } from "@/lib/runner-v2/run-state";
import { runnerEventFixture } from "@/lib/runner-v2/test-support/runner-event-fixture";

function runDir() {
  return mkdtempSync(join(tmpdir(), "runner-v2-completion-pipeline-"));
}

function seedRun(dir: string) {
  const file = join(dir, "run.json");
  const run = createRunRecord({ chainName: "chain", goal: "goal" });
  updateRunJson(file, () => ({
    ...run,
    id: "run-123",
    status: "running",
    agents: [{ id: "writer", name: "Writer", session: "writer-run-123", status: "running" }],
    sessions: ["writer-run-123"],
  }));
  return file;
}

describe("runner-v2 completion pipeline", () => {
  it("mutates the exact completion attempt without touching a newer retry", () => {
    const dir = runDir();
    const runJsonPath = seedRun(dir);
    const first = createAgentAttempt({
      runJsonPath,
      runId: "run-123",
      agentId: "writer",
      leaseId: "writer-run-123",
    });
    for (const phase of [
      "queued",
      "lease_acquired",
      "pty_allocated",
      "process_spawned",
      "ready_for_instructions",
      "instructions_submitted",
    ] as const) {
      transitionAgentAttempt({ runJsonPath, attemptId: first.id, to: phase });
    }
    const retry = createAgentAttempt({
      runJsonPath,
      runId: "run-123",
      agentId: "writer",
      attemptId: "run-123:writer:2",
      leaseId: "writer-retry-run-123",
    });
    for (const phase of [
      "queued",
      "lease_acquired",
      "pty_allocated",
      "process_spawned",
      "ready_for_instructions",
      "instructions_submitted",
    ] as const) {
      transitionAgentAttempt({ runJsonPath, attemptId: retry.id, to: phase });
    }

    runCompletionPipeline({
      runDir: dir,
      runJsonPath,
      runId: "run-123",
      attemptId: first.id,
      agent: { id: "writer", emits: "draft-ready" },
      chain: { agents: [{ id: "writer", emits: "draft-ready" }] },
      events: [runnerEventFixture({ event: "draft-ready", source: "writer-run-123", runId: "run-123" })],
      now: new Date("2026-08-09T20:00:00.000Z"),
    });

    const attempts = readRunnerV2AttemptState(runJsonPath).attempts;
    expect(attempts.find((attempt) => attempt.id === first.id)).toMatchObject({
      phase: "completed",
      terminalReason: "completed_from_declared_event",
    });
    const retryAfter = attempts.find((attempt) => attempt.id === retry.id);
    expect(retryAfter).toMatchObject({ phase: "instructions_submitted" });
    expect(retryAfter?.terminalReason).toBeUndefined();
  });

  it("records loop visit and round after a routable completion", () => {
    const dir = runDir();
    const runJsonPath = seedRun(dir);

    const result = runCompletionPipeline({
      runDir: dir,
      runJsonPath,
      runId: "run-123",
      agent: { id: "writer", emits: "draft-ready" },
      chain: {
        agents: [
          { id: "writer", emits: "draft-ready" },
          { id: "reviewer", triggers: ["draft-ready"] },
        ],
      },
      events: [runnerEventFixture({ event: "draft-ready", source: "writer-run-123", runId: "run-123" })],
      maxRounds: 3,
      now: new Date("2026-06-25T10:00:00.000Z"),
    });

    expect(result).toMatchObject({
      decision: {
        action: "route",
        loopGuard: { action: "continue", visitKey: "writer:draft-ready", round: 1 },
      },
      loopStateBefore: { visited: [], round: 1 },
      loopStateAfter: { visited: ["writer:draft-ready"], round: 1 },
    });
    expect(readLoopState(dir)).toEqual({ visited: ["writer:draft-ready"], round: 1 });
  });

  it("uses persisted loop state to complete repeated agent/event visits", () => {
    const dir = runDir();
    const runJsonPath = seedRun(dir);
    writeLoopState(dir, { visited: ["writer:draft-ready"], round: 1 });

    const result = runCompletionPipeline({
      runDir: dir,
      runJsonPath,
      runId: "run-123",
      agent: { id: "writer", emits: "draft-ready" },
      chain: {
        agents: [
          { id: "writer", emits: "draft-ready" },
          { id: "reviewer", triggers: ["draft-ready"] },
        ],
      },
      events: [runnerEventFixture({ event: "draft-ready", source: "writer-run-123", runId: "run-123" })],
      maxRounds: 3,
      now: new Date("2026-06-25T10:00:00.000Z"),
    });

    expect(result).toMatchObject({
      decision: {
        action: "loop-complete",
        loopGuard: { visitKey: "writer:draft-ready" },
      },
      loopStateBefore: { visited: ["writer:draft-ready"], round: 1 },
    });
    expect(result.loopStateAfter).toBeUndefined();
    expect(readRunJson(runJsonPath).status).toBe("completed");
  });

  it("uses shell loop tracker visits to complete repeated agent/event visits", () => {
    const dir = runDir();
    const runJsonPath = seedRun(dir);
    writeFileSync(shellLoopStatePath(dir), "writer:draft-ready\n");

    const result = runCompletionPipeline({
      runDir: dir,
      runJsonPath,
      runId: "run-123",
      agent: { id: "writer", emits: "draft-ready" },
      chain: {
        agents: [
          { id: "writer", emits: "draft-ready" },
          { id: "reviewer", triggers: ["draft-ready"] },
        ],
      },
      events: [runnerEventFixture({ event: "draft-ready", source: "writer-run-123", runId: "run-123" })],
      maxRounds: 3,
      now: new Date("2026-06-25T10:00:00.000Z"),
    });

    expect(result).toMatchObject({
      decision: {
        action: "loop-complete",
        loopGuard: { visitKey: "writer:draft-ready" },
      },
      loopStateBefore: { visited: ["writer:draft-ready"], round: 1 },
    });
    expect(result.loopStateAfter).toBeUndefined();
    expect(readRunJson(runJsonPath).status).toBe("completed");
  });

  it("records the stop round when max rounds are exceeded", () => {
    const dir = runDir();
    const runJsonPath = seedRun(dir);
    writeLoopState(dir, { visited: [], round: 3 });

    const result = runCompletionPipeline({
      runDir: dir,
      runJsonPath,
      runId: "run-123",
      agent: { id: "writer", emits: "revise" },
      chain: {
        agents: [
          { id: "writer", emits: "revise" },
          { id: "writer", triggers: ["revise"] },
        ],
      },
      events: [runnerEventFixture({ event: "revise", source: "writer-run-123", runId: "run-123" })],
      maxRounds: 3,
      now: new Date("2026-06-25T10:00:00.000Z"),
    });

    expect(result).toMatchObject({
      decision: {
        action: "max-rounds-stop",
        loopGuard: { visitKey: "writer:revise", round: 4 },
      },
      loopStateAfter: { visited: ["writer:revise"], round: 4 },
    });
    expect(readRunJson(runJsonPath).status).toBe("stopped");
  });
});
