import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { completeAgent } from "@/lib/runner-v2/completion-runner";
import { createFanGroupState } from "@/lib/runner-v2/fan-group";
import { createRunRecord, readRunJson, updateRunJson } from "@/lib/runner-v2/run-state";
import { createAgentAttempt, transitionAgentAttempt } from "@/lib/runner-v2/agent-attempt";

function runPath() {
  return join(mkdtempSync(join(tmpdir(), "runner-v2-completion-runner-")), "run.json");
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

function runnerV2Attempts(file: string) {
  return (readRunJson(file).runnerV2 as { attempts?: Array<Record<string, unknown>> } | undefined)?.attempts || [];
}

describe("runner-v2 completion runner", () => {
  it("marks agent and run failed when the declared emits event is missing", () => {
    const file = runPath();
    seedRun(file);
    seedSubmittedAttempt(file);

    const decision = completeAgent({
      runJsonPath: file,
      runId: "run-123",
      agent: { id: "writer", emits: "draft-ready" },
      chain: { agents: [] },
      events: [],
      now: new Date("2026-06-25T10:00:00.000Z"),
    });

    expect(decision.action).toBe("fail");
    expect(readRunJson(file)).toMatchObject({
      status: "failed",
      status_message: "agent writer completed without declared event: no matching completion event",
      agents: [{ id: "writer", status: "failed", completed: "2026-06-25T10:00:00.000Z" }],
    });
    expect(runnerV2Attempts(file)[0]).toMatchObject({
      phase: "completion_failed",
      terminalReason: "no_completion_event",
    });
  });

  it("imports core generation payload instead of failing a missing emit", () => {
    const file = runPath();
    seedRun(file);

    const decision = completeAgent({
      runJsonPath: file,
      runId: "run-123",
      agent: { id: "writer", emits: "draft-ready" },
      chain: { id: "chain-generation", name: "Chain Generation", agents: [] },
      events: [],
      generation: {
        jobId: "job-1",
        generationKind: "chain_generation",
        runId: "run-123",
        artifactsDir: "/tmp/run-123/artifacts",
        importablePayload: true,
      },
      now: new Date("2026-06-25T10:00:00.000Z"),
    });

    expect(decision).toMatchObject({
      action: "generation-terminal",
      generation: { jobId: "job-1", generationKind: "chain_generation" },
    });
    expect(readRunJson(file)).toMatchObject({
      status: "completed",
      agents: [{ id: "writer", status: "complete" }],
    });
  });

  it("imports core generation payload before deferring to live session liveness", () => {
    const file = runPath();
    seedRun(file);
    seedSubmittedAttempt(file);

    const decision = completeAgent({
      runJsonPath: file,
      runId: "run-123",
      agent: { id: "writer", emits: "draft-ready" },
      chain: { id: "chain-generation", name: "Chain Generation", agents: [] },
      events: [],
      generation: {
        jobId: "job-1",
        generationKind: "chain_generation",
        runId: "run-123",
        artifactsDir: "/tmp/run-123/artifacts",
        importablePayload: true,
      },
      liveness: { sessionAlive: true, processAlive: true, outputChanged: true },
      now: new Date("2026-06-25T10:00:00.000Z"),
    });

    expect(decision).toMatchObject({
      action: "generation-terminal",
      generation: { jobId: "job-1", generationKind: "chain_generation" },
    });
    expect(readRunJson(file)).toMatchObject({
      status: "completed",
      agents: [{ id: "writer", status: "complete" }],
    });
    expect(runnerV2Attempts(file)[0]).toMatchObject({
      phase: "completed",
      terminalReason: "completed_from_generation_artifact",
    });
  });

  it("plans retry without failing the run when a declared emits event is missing and retry remains", () => {
    const file = runPath();
    seedRun(file);

    const decision = completeAgent({
      runJsonPath: file,
      runId: "run-123",
      agent: { id: "writer", name: "Writer", emits: "draft-ready" },
      chain: { name: "Build Chain", agents: [{ id: "writer", emits: "draft-ready" }] },
      events: [],
      retry: {
        policy: {
          max_retries: 2,
          strategy: "exponential",
          base_delay_ms: 1000,
          circuit_breaker: { threshold: 5, timeout: 300 },
        },
        currentAttempt: 0,
      },
      now: new Date("2026-06-25T10:00:00.000Z"),
    });

    expect(decision).toMatchObject({
      action: "retry",
      retry: {
        nextAttempt: 1,
        launch: { agentId: "writer", reason: "missing-event" },
        steps: [
          { type: "circuit-breaker", action: "record-failure" },
          { type: "retry-state", action: "set", agentId: "writer", attempt: 1 },
        ],
      },
    });
    expect(readRunJson(file)).toMatchObject({
      status: "running",
      agents: [{ id: "writer", status: "running" }],
    });
  });

  it("routes from agent handoff artifacts when the declared completion event is missing", () => {
    const file = runPath();
    seedRun(file);
    seedSubmittedAttempt(file);
    const artifactsDir = join(file, "..", "artifacts");
    mkdirSync(artifactsDir, { recursive: true });
    writeFileSync(join(artifactsDir, "writer-summary.json"), JSON.stringify({
      status: "complete",
      artifactsProduced: ["draft.md"],
    }));

    const decision = completeAgent({
      runJsonPath: file,
      runId: "run-123",
      agent: { id: "writer", name: "Writer", emits: "draft-ready" },
      chain: {
        id: "build-chain",
        name: "Build Chain",
        agents: [
          { id: "writer", emits: "draft-ready" },
          { id: "reviewer", triggers: ["draft-ready"] },
        ],
      },
      events: [],
      retry: {
        policy: { max_retries: 1 },
        currentAttempt: 1,
      },
      now: new Date("2026-06-25T10:00:00.000Z"),
    });

    expect(decision).toMatchObject({
      action: "route",
      event: {
        event: "draft-ready",
        source: "writer",
        data: "salvaged-from-agent-handoff-artifacts",
      },
      route: {
        action: "launch",
        agentIds: ["reviewer"],
      },
    });
    expect(readRunJson(file)).toMatchObject({
      status: "running",
      agents: [{ id: "writer", status: "complete" }],
    });
    expect(runnerV2Attempts(file)[0]).toMatchObject({
      phase: "completed",
      terminalReason: "completed_from_event",
    });
  });

  it("routes from a monitor-latched AGENT_COMPLETE marker when the declared event is missing", () => {
    const file = runPath();
    seedRun(file);
    seedSubmittedAttempt(file);

    const input = {
      runJsonPath: file,
      runId: "run-123",
      agent: { id: "writer", name: "Writer", emits: "draft-ready" },
      chain: {
        id: "build-chain",
        name: "Build Chain",
        agents: [
          { id: "writer", emits: "draft-ready" },
          { id: "reviewer", triggers: ["draft-ready"] },
        ],
      },
      events: [],
      agentCompleteMarker: true,
      liveness: { sessionAlive: true, processAlive: true, outputChanged: true },
      now: new Date("2026-06-25T10:00:00.000Z"),
    };

    const decision = completeAgent(input);

    expect(decision).toMatchObject({
      action: "route",
      event: {
        event: "draft-ready",
        source: "writer",
        data: "salvaged-from-agent-complete-marker",
      },
      route: {
        action: "launch",
        agentIds: ["reviewer"],
      },
    });
    expect(readRunJson(file)).toMatchObject({
      status: "running",
      agents: [{ id: "writer", status: "complete" }],
    });
    expect(runnerV2Attempts(file)[0]).toMatchObject({
      phase: "completed",
      terminalReason: "completed_from_event",
    });
  });

  it("stops the run when a declared emits event is missing and retries are exhausted", () => {
    const file = runPath();
    seedRun(file);
    seedSubmittedAttempt(file);

    const decision = completeAgent({
      runJsonPath: file,
      runId: "run-123",
      agent: { id: "writer", name: "Writer", emits: "draft-ready" },
      chain: { name: "Build Chain", agents: [{ id: "writer", emits: "draft-ready" }] },
      events: [],
      retry: {
        policy: { max_retries: 1 },
        currentAttempt: 1,
        taskId: "task-1",
      },
      now: new Date("2026-06-25T10:00:00.000Z"),
    });

    expect(decision.action).toBe("exhausted");
    if (decision.action !== "exhausted") {
      throw new Error(`expected exhausted decision, got ${decision.action}`);
    }
    expect(decision.retry.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "circuit-breaker", action: "record-failure" }),
      expect.objectContaining({ type: "retry-state", action: "clear" }),
      expect.objectContaining({ type: "run-status", status: "stopped" }),
      expect.objectContaining({ type: "task-status", status: "stopped", taskId: "task-1" }),
    ]));
    expect(readRunJson(file)).toMatchObject({
      status: "stopped",
      status_message: "agent writer completed without declared event; retries exhausted",
      agents: [{ id: "writer", status: "failed" }],
    });
    expect(runnerV2Attempts(file)[0]).toMatchObject({
      phase: "completion_failed",
      terminalReason: "retries_exhausted",
    });
  });

  it("does not route on diagnostic events", () => {
    const file = runPath();
    seedRun(file);

    const decision = completeAgent({
      runJsonPath: file,
      runId: "run-123",
      agent: { id: "writer", emits: "draft-ready" },
      chain: { agents: [{ id: "reviewer", triggers: ["draft-ready"] }] },
      events: ["event: draft-ready\nsource: chain-runner-complete\nrun_id: run-123\nprocessed: false\n"],
      now: new Date("2026-06-25T10:00:00.000Z"),
    });

    expect(decision.action).toBe("fail");
    expect(readRunJson(file).status).toBe("failed");
  });

  it("marks fan-group member failed when no-event failure stops a fan-out member", () => {
    const file = runPath();
    seedRun(file);

    const decision = completeAgent({
      runJsonPath: file,
      runId: "run-123",
      agent: { id: "writer", emits: "draft-ready" },
      chain: { name: "Build Chain", agents: [{ id: "writer", emits: "draft-ready" }] },
      events: [],
      fanGroup: createFanGroupState({
        id: "group-1",
        event: "draft-ready",
        fanOutAgents: ["writer", "designer"],
        fanInAgent: "merge",
        waitFor: "all",
        onError: "recover",
      }),
      now: new Date("2026-06-25T10:00:00.000Z"),
    });

    expect(decision).toMatchObject({
      action: "fail",
      fanGroup: {
        claimed: false,
        group: { completed: 0, failed: 1, status: "running" },
      },
    });
  });

  it("plans fan-group on_error launch when exhausted retry completes the group with a failed member", () => {
    const file = runPath();
    seedRun(file);

    const decision = completeAgent({
      runJsonPath: file,
      runId: "run-123",
      agent: { id: "writer", emits: "draft-ready" },
      chain: { name: "Build Chain", agents: [{ id: "writer", emits: "draft-ready" }] },
      events: [],
      retry: {
        policy: { max_retries: 0 },
        currentAttempt: 0,
      },
      fanGroup: {
        ...createFanGroupState({
          id: "group-1",
          event: "draft-ready",
          fanOutAgents: ["writer", "designer"],
          fanInAgent: "merge",
          waitFor: "all",
          onError: "recover",
        }),
        completed: 1,
      },
      now: new Date("2026-06-25T10:00:00.000Z"),
    });

    expect(decision.action).toBe("exhausted");
    if (decision.action !== "exhausted") {
      throw new Error(`expected exhausted decision, got ${decision.action}`);
    }
    expect(decision.fanGroup).toMatchObject({
      claimed: true,
      claim: { fanInAgent: "recover", completed: 1, failed: 1 },
      launch: { agentId: "recover", env: { AGENT_FAN_GROUP_ID: "group-1" } },
    });
  });

  it("marks agent complete and returns routing decision on a real event", () => {
    const file = runPath();
    seedRun(file);
    seedSubmittedAttempt(file);

    const decision = completeAgent({
      runJsonPath: file,
      runId: "run-123",
      agent: { id: "writer", emits: "draft-ready" },
      chain: {
        agents: [
          { id: "reviewer", triggers: ["draft-ready"] },
          { id: "already", triggers: ["draft-ready"], status: "running" },
        ],
      },
      events: ["event: draft-ready\nsource: writer-run-123\nrun_id: run-123\nprocessed: false\n"],
      now: new Date("2026-06-25T10:00:00.000Z"),
    });

    expect(decision).toMatchObject({
      action: "route",
      route: { action: "launch", agentIds: ["reviewer"] },
    });
    expect(readRunJson(file).agents[0]).toMatchObject({
      id: "writer",
      status: "complete",
      completed: "2026-06-25T10:00:00.000Z",
    });
    expect(runnerV2Attempts(file)[0]).toMatchObject({
      phase: "completed",
      terminalReason: "completed_from_event",
      terminalDetail: "matched completion event draft-ready",
    });
  });

  it("completes the run when loop guard sees a repeated agent/event visit", () => {
    const file = runPath();
    seedRun(file);

    const decision = completeAgent({
      runJsonPath: file,
      runId: "run-123",
      agent: { id: "writer", emits: "draft-ready" },
      chain: { agents: [{ id: "reviewer", triggers: ["draft-ready"] }] },
      events: ["event: draft-ready\nsource: writer-run-123\nrun_id: run-123\nprocessed: false\n"],
      loopGuard: {
        visited: ["writer:draft-ready"],
        currentRound: 1,
        maxRounds: 3,
      },
      now: new Date("2026-06-25T10:00:00.000Z"),
    });

    expect(decision).toMatchObject({
      action: "loop-complete",
      loopGuard: { action: "complete", visitKey: "writer:draft-ready" },
      run: { status: "completed" },
    });
    expect(readRunJson(file)).toMatchObject({
      status: "completed",
      agents: [{ id: "writer", status: "complete" }],
    });
  });

  it("stops the run when loop guard max rounds are exceeded", () => {
    const file = runPath();
    seedRun(file);

    const decision = completeAgent({
      runJsonPath: file,
      runId: "run-123",
      agent: { id: "writer", emits: "revise" },
      chain: {
        agents: [
          { id: "writer", emits: "revise" },
          { id: "writer", triggers: ["revise"] },
        ],
      },
      events: ["event: revise\nsource: writer-run-123\nrun_id: run-123\nprocessed: false\n"],
      loopGuard: {
        currentRound: 3,
        maxRounds: 3,
      },
      now: new Date("2026-06-25T10:00:00.000Z"),
    });

    expect(decision).toMatchObject({
      action: "max-rounds-stop",
      loopGuard: { action: "stop", round: 4, maxRounds: 3 },
      run: {
        status: "stopped",
        status_message: "max rounds exceeded (3)",
      },
    });
  });

  it("completes an empty-emits last agent instead of fabricating a missing event failure", () => {
    const file = runPath();
    seedRun(file);
    seedSubmittedAttempt(file);

    const decision = completeAgent({
      runJsonPath: file,
      runId: "run-123",
      agent: { id: "writer" },
      chain: { name: "Build Chain", agents: [{ id: "writer" }] },
      events: [],
      terminal: {
        runId: "run-123",
        chainName: "Build Chain",
        lastAgentId: "writer",
      },
      now: new Date("2026-06-25T10:00:00.000Z"),
    });

    expect(decision).toMatchObject({
      action: "terminal",
      reason: "empty-emits-last-agent",
      terminal: { reason: "empty-emits-last-agent" },
    });
    expect(readRunJson(file)).toMatchObject({
      status: "completed",
      agents: [{ id: "writer", status: "complete" }],
      runnerV2: {
        attempts: [{
          phase: "completed",
          terminalReason: "completed_empty_emits_last_agent",
          terminalDetail: "empty emits last agent accepted as terminal completion",
        }],
      },
    });
  });

  it("does not complete empty-emits agent when downstream exists for its emits contract", () => {
    const file = runPath();
    seedRun(file);

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
      now: new Date("2026-06-25T10:00:00.000Z"),
    });

    expect(decision.action).toBe("fail");
    expect(readRunJson(file).status).toBe("failed");
  });
});
