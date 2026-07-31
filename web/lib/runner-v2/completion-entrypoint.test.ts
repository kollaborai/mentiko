import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  RunnerV2CompletionUnsupportedError,
  runRunnerV2CompletionEntrypoint,
} from "@/lib/runner-v2/completion-entrypoint";
import { parseRunnerEvent } from "@/lib/runner-v2/events";
import { shellLoopStatePath, writeLoopState } from "@/lib/runner-v2/loop-state";
import { createRunRecord, readRunJson, updateRunJson, type AgentStatus } from "@/lib/runner-v2/run-state";
import { runnerEventFixture } from "@/lib/runner-v2/test-support/runner-event-fixture";

function tempRoot() {
  return mkdtempSync(join(tmpdir(), "runner-v2-completion-entrypoint-"));
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function seedGenerationArtifactFixture(input: {
  generationKind: string;
  payload?: unknown;
  rawPayload?: string;
  artifactMtime?: Date;
  attemptStartedAt?: string;
}) {
  const root = tempRoot();
  const runDir = join(root, "runs", "run-123");
  const eventsDir = join(root, "events");
  const stateDir = join(root, "state");
  const artifactsDir = join(runDir, "artifacts");
  mkdirSync(artifactsDir, { recursive: true });
  mkdirSync(eventsDir, { recursive: true });
  mkdirSync(stateDir, { recursive: true });

  const chainPath = join(root, "chain.json");
  writeJson(chainPath, {
    id: "task-generation",
    name: "Task Generation",
    metadata: { coreGenerationChain: true, generationKind: input.generationKind },
    agents: [{ id: "task-generator", name: "Task Generator", emits: "task-generation-complete" }],
  });

  const runJsonPath = join(runDir, "run.json");
  const started = "2026-07-15T11:00:00.000Z";
  const run = createRunRecord({ chainName: "Task Generation", goal: "generate", now: new Date(started) });
  updateRunJson(runJsonPath, () => ({
    ...run,
    id: "run-123",
    status: "running",
    metadata: { generationJobId: "job-1", generationKind: input.generationKind },
    agents: [{
      id: "task-generator",
      name: "Task Generator",
      session: "task-generator-run-123",
      status: "running",
      started: "2026-07-15T11:30:00.000Z",
    }],
    sessions: ["task-generator-run-123"],
    ...(input.attemptStartedAt ? {
      runnerV2: {
        attempts: [{
          id: "run-123:task-generator:1",
          runId: "run-123",
          agentId: "task-generator",
          phase: "instructions_submitted",
          desiredPhase: "completed",
          observedPhase: "instructions_submitted",
          instructionLedger: [],
          recoveryDecisionCount: 0,
          createdAt: input.attemptStartedAt,
          updatedAt: input.attemptStartedAt,
          transitions: [],
        }],
      },
    } : {}),
  }));

  const artifactPath = join(artifactsDir, "generation-result.json");
  if (input.rawPayload !== undefined) writeFileSync(artifactPath, input.rawPayload);
  else writeJson(artifactPath, input.payload);
  if (input.artifactMtime) utimesSync(artifactPath, input.artifactMtime, input.artifactMtime);

  return { chainPath, runDir, eventsDir, stateDir };
}

function completeGenerationFixture(fixture: ReturnType<typeof seedGenerationArtifactFixture>) {
  return runRunnerV2CompletionEntrypoint({
    sessionName: "task-generator-run-123",
    chainPath: fixture.chainPath,
    env: {
      MENTIKO_RUN_ID: "run-123",
      MENTIKO_RUN_DIR: fixture.runDir,
      EVENTS_DIR: fixture.eventsDir,
      STATE_DIR: fixture.stateDir,
      NAMESPACE_ID: "default",
      ORG_ID: "default",
    },
    dryRun: true,
    now: new Date("2026-07-15T12:00:00.000Z"),
  });
}

function expectNoGenerationImport(result: ReturnType<typeof completeGenerationFixture>) {
  expect(result.decision).not.toBe("generation-terminal");
  expect(result.plan.effects).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "generation-import" }),
  ]));
}

describe("runner-v2 completion entrypoint", () => {
  it("handles an agent completion event through the typed pipeline", () => {
    const root = tempRoot();
    const runDir = join(root, "runs", "run-123");
    const eventsDir = join(root, "events");
    const stateDir = join(root, "state");
    mkdirSync(runDir, { recursive: true });
    mkdirSync(eventsDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });

    const chainPath = join(root, "chain.json");
    writeJson(chainPath, {
      id: "chain",
      name: "Build Chain",
      config: { project_root: root },
      agents: [
        { id: "writer", name: "Writer", emits: "draft-ready" },
        { id: "reviewer", name: "Reviewer", triggers: ["draft-ready"] },
      ],
    });

    const runJsonPath = join(runDir, "run.json");
    const run = createRunRecord({ chainName: "Build Chain", goal: "ship" });
    updateRunJson(runJsonPath, () => ({
      ...run,
      id: "run-123",
      status: "running",
      agents: [{ id: "writer", name: "Writer", session: "writer-run-123", status: "running" }],
      sessions: ["writer-run-123"],
    }));
    const eventPath = join(eventsDir, "run-123-writer-draft-ready.event");
    writeFileSync(eventPath, runnerEventFixture({
      event: "draft-ready",
      source: "writer-run-123",
      runId: "run-123",
      timestamp: "2026-06-26T00:00:00.000Z",
      data: "ready",
    }));

    const result = runRunnerV2CompletionEntrypoint({
      sessionName: "writer-run-123",
      chainPath,
      env: {
        MENTIKO_RUN_ID: "run-123",
        MENTIKO_RUN_DIR: runDir,
        EVENTS_DIR: eventsDir,
        STATE_DIR: stateDir,
        MENTIKO_RUNNER_V2: "1",
        MENTIKO_RUNNER_V2_COMPLETION: "1",
      },
      dryRun: true,
      now: new Date("2026-06-26T00:00:00.000Z"),
    });

    expect(result).toMatchObject({
      status: "handled",
      runId: "run-123",
      agentId: "writer",
      decision: "route",
      plan: { action: "route", launches: [{ kind: "single" }] },
    });
    expect(readRunJson(runJsonPath).agents[0]).toMatchObject({
      id: "writer",
      status: "running",
    });
    expect(readFileSync(eventPath, "utf8")).toContain("processed: false");
  });

  it("does not route or consume a notwriter event for writer", () => {
    const root = tempRoot();
    const runDir = join(root, "runs", "run-123");
    const eventsDir = join(root, "events");
    const stateDir = join(root, "state");
    mkdirSync(runDir, { recursive: true });
    mkdirSync(eventsDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });

    const chainPath = join(root, "chain.json");
    writeJson(chainPath, {
      id: "chain",
      name: "Build Chain",
      agents: [
        { id: "writer", name: "Writer", emits: "draft-ready" },
        { id: "reviewer", name: "Reviewer", triggers: ["draft-ready"] },
      ],
    });
    const runJsonPath = join(runDir, "run.json");
    const run = createRunRecord({ chainName: "Build Chain", goal: "ship" });
    updateRunJson(runJsonPath, () => ({
      ...run,
      id: "run-123",
      status: "running",
      agents: [{ id: "writer", name: "Writer", session: "writer-run-123", status: "running" }],
      sessions: ["writer-run-123"],
    }));
    const eventPath = join(eventsDir, "notwriter-draft-ready.event");
    writeFileSync(eventPath, runnerEventFixture({
      event: "draft-ready",
      source: "notwriter",
      runId: "run-123",
      data: "wrong owner",
    }));

    const result = runRunnerV2CompletionEntrypoint({
      sessionName: "writer-run-123",
      chainPath,
      env: {
        MENTIKO_RUN_ID: "run-123",
        MENTIKO_RUN_DIR: runDir,
        EVENTS_DIR: eventsDir,
        STATE_DIR: stateDir,
        MENTIKO_RUNNER_V2: "1",
        MENTIKO_RUNNER_V2_COMPLETION: "1",
      },
      dryRun: true,
    });

    expect(result.decision).not.toBe("route");
    expect(result.plan.effects.some((effect) => effect.type === "event-side-effects")).toBe(false);
    expect(readFileSync(eventPath, "utf8")).toContain("processed: false");
    expect(existsSync(join(eventsDir, "archive"))).toBe(false);
  });

  it("terminalizes a monitor-latched AGENT_COMPLETE completion when no event file exists", () => {
    const root = tempRoot();
    const runDir = join(root, "runs", "run-123");
    const eventsDir = join(root, "events");
    const stateDir = join(root, "state");
    mkdirSync(runDir, { recursive: true });
    mkdirSync(eventsDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });

    const chainPath = join(root, "chain.json");
    writeJson(chainPath, {
      id: "chain",
      name: "Build Chain",
      config: { project_root: root },
      agents: [
        { id: "writer", name: "Writer", emits: "draft-ready" },
        { id: "reviewer", name: "Reviewer", triggers: ["draft-ready"] },
      ],
    });

    const runJsonPath = join(runDir, "run.json");
    const run = createRunRecord({ chainName: "Build Chain", goal: "ship" });
    updateRunJson(runJsonPath, () => ({
      ...run,
      id: "run-123",
      status: "running",
      agents: [{ id: "writer", name: "Writer", session: "writer-run-123", status: "running" }],
      sessions: ["writer-run-123"],
    }));

    const result = runRunnerV2CompletionEntrypoint({
      sessionName: "writer-run-123",
      chainPath,
      env: {
        MENTIKO_RUN_ID: "run-123",
        MENTIKO_RUN_DIR: runDir,
        EVENTS_DIR: eventsDir,
        STATE_DIR: stateDir,
        MENTIKO_RUNNER_V2: "1",
        MENTIKO_RUNNER_V2_COMPLETION: "1",
        MENTIKO_MONITOR_COMPLETION_LATCH: "durable-marker",
      },
      dryRun: true,
      now: new Date("2026-06-26T00:00:00.000Z"),
    });

    expect(result).toMatchObject({
      status: "handled",
      runId: "run-123",
      agentId: "writer",
      decision: "fail",
      plan: {
        action: "fail",
        launches: [],
      },
    });
    expect(result.status === "handled" ? result.plan.effects : []).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "terminal-failure" })]),
    );
    expect(readRunJson(runJsonPath).agents[0]).toMatchObject({
      id: "writer",
      status: "running",
    });
  });

  it("ignores a run-local event outside the configured EVENTS_DIR", () => {
    const root = tempRoot();
    const runDir = join(root, "runs", "run-123");
    const orgEventsDir = join(root, "events");
    const runEventsDir = join(runDir, "events");
    mkdirSync(runDir, { recursive: true });
    mkdirSync(orgEventsDir, { recursive: true });
    mkdirSync(runEventsDir, { recursive: true });

    const chainPath = join(root, "chain.json");
    writeJson(chainPath, {
      id: "chain",
      name: "Build Chain",
      config: { project_root: root },
      agents: [
        { id: "writer", name: "Writer", emits: "draft-ready" },
        { id: "reviewer", name: "Reviewer", triggers: ["draft-ready"] },
      ],
    });

    const runJsonPath = join(runDir, "run.json");
    const run = createRunRecord({ chainName: "Build Chain", goal: "ship" });
    updateRunJson(runJsonPath, () => ({
      ...run,
      id: "run-123",
      status: "running",
      agents: [{ id: "writer", name: "Writer", session: "writer-run-123", status: "running" }],
      sessions: ["writer-run-123"],
    }));
    writeFileSync(join(runEventsDir, "run-123-writer-draft-ready.event"), runnerEventFixture({
      event: "draft-ready",
      source: "writer-run-123",
      runId: "run-123",
      data: "ready",
    }));

    const result = runRunnerV2CompletionEntrypoint({
      sessionName: "writer-run-123",
      chainPath,
      env: {
        MENTIKO_RUN_ID: "run-123",
        MENTIKO_RUN_DIR: runDir,
        EVENTS_DIR: orgEventsDir,
        MENTIKO_RUNNER_V2: "1",
        MENTIKO_RUNNER_V2_COMPLETION: "1",
      },
      dryRun: true,
      now: new Date("2026-06-26T00:00:00.000Z"),
    });

    expect(result).toMatchObject({
      status: "handled",
      agentId: "writer",
      decision: "exhausted",
      eventsDir: orgEventsDir,
    });
  });

  it("does not resolve agents by loose session substring", () => {
    const root = tempRoot();
    const runDir = join(root, "runs", "run-123");
    const eventsDir = join(root, "events");
    mkdirSync(runDir, { recursive: true });
    mkdirSync(eventsDir, { recursive: true });

    const chainPath = join(root, "chain.json");
    writeJson(chainPath, {
      id: "chain",
      agents: [
        { id: "a", emits: "a-done" },
        { id: "alpha", emits: "alpha-done" },
      ],
    });
    const runJsonPath = join(runDir, "run.json");
    const run = createRunRecord({ chainName: "chain", goal: "ship" });
    updateRunJson(runJsonPath, () => ({
      ...run,
      id: "run-123",
      status: "running",
      agents: [{ id: "a", name: "A", session: "different-session", status: "running" }],
      sessions: ["different-session"],
    }));

    expect(() => runRunnerV2CompletionEntrypoint({
      sessionName: "alpha-run-123",
      chainPath,
      env: {
        MENTIKO_RUN_ID: "run-123",
        MENTIKO_RUN_DIR: runDir,
        EVENTS_DIR: eventsDir,
      },
      dryRun: true,
    })).not.toThrow();
    expect(readRunJson(runJsonPath).agents[0]).toMatchObject({ id: "a", status: "running" });
  });

  it("creates event-artifact triage when a quality gate summary fails", () => {
    const root = tempRoot();
    const runDir = join(root, "runs", "run-123");
    const eventsDir = join(root, "events");
    const artifactsDir = join(runDir, "artifacts");
    mkdirSync(runDir, { recursive: true });
    mkdirSync(eventsDir, { recursive: true });
    mkdirSync(artifactsDir, { recursive: true });

    const chainPath = join(root, "chain.json");
    writeJson(chainPath, {
      id: "chain",
      name: "Build Chain",
      config: { project_root: root },
      agents: [
        { id: "validator", name: "Validator", emits: "validated" },
        { id: "deployer", name: "Deployer", triggers: ["validated"] },
      ],
    });
    const runJsonPath = join(runDir, "run.json");
    const run = createRunRecord({ chainName: "Build Chain", goal: "ship" });
    updateRunJson(runJsonPath, () => ({
      ...run,
      id: "run-123",
      taskId: "FEAT-1",
      status: "running",
      agents: [{ id: "validator", name: "Validator", session: "validator-run-123", status: "running" }],
      sessions: ["validator-run-123"],
    }));
    writeJson(join(artifactsDir, "validator-summary.json"), {
      status: "failed",
      findings: ["tests failed"],
      risks: ["regression"],
      nextActions: ["repair tests"],
    });
    writeFileSync(join(eventsDir, "run-123-validator-validated.event"), runnerEventFixture({
      event: "validated",
      source: "validator-run-123",
      runId: "run-123",
      timestamp: "2026-06-26T00:00:00.000Z",
    }));

    const result = runRunnerV2CompletionEntrypoint({
      sessionName: "validator-run-123",
      chainPath,
      env: {
        MENTIKO_RUN_ID: "run-123",
        MENTIKO_RUN_DIR: runDir,
        EVENTS_DIR: eventsDir,
        NAMESPACE_ID: "default",
        ORG_ID: "default",
      },
      now: new Date("2026-06-26T00:00:00.000Z"),
    });

    expect(result.decision).toBe("quality-gate-failed");
    expect(existsSync(join(artifactsDir, "triage-result.json"))).toBe(true);
    expect(existsSync(join(artifactsDir, "draft-child-tasks.json"))).toBe(true);
    expect(readRunJson(runJsonPath)).toMatchObject({
      status: "failed",
      status_message: "agent summary status is failed",
    });
  });

  it("fails typed completion instead of silently accepting a malformed required summary artifact", () => {
    const root = tempRoot();
    const runDir = join(root, "runs", "run-123");
    const eventsDir = join(root, "events");
    const artifactsDir = join(runDir, "artifacts");
    mkdirSync(runDir, { recursive: true });
    mkdirSync(eventsDir, { recursive: true });
    mkdirSync(artifactsDir, { recursive: true });

    const chainPath = join(root, "chain.json");
    writeJson(chainPath, {
      id: "chain",
      name: "Build Chain",
      config: { project_root: root },
      agents: [
        { id: "validator", name: "Validator", emits: "validated" },
        { id: "deployer", name: "Deployer", triggers: ["validated"] },
      ],
    });
    const runJsonPath = join(runDir, "run.json");
    const run = createRunRecord({ chainName: "Build Chain", goal: "ship" });
    updateRunJson(runJsonPath, () => ({
      ...run,
      id: "run-123",
      taskId: "FEAT-1",
      status: "running",
      agents: [{ id: "validator", name: "Validator", session: "validator-run-123", status: "running" }],
      sessions: ["validator-run-123"],
    }));
    writeFileSync(join(artifactsDir, "validator-summary.json"), '{"status":"complete","nextAgentHints":["line one\nline two"]}');
    writeFileSync(join(eventsDir, "run-123-validator-validated.event"), runnerEventFixture({
      event: "validated",
      source: "validator-run-123",
      runId: "run-123",
      timestamp: "2026-06-26T00:00:00.000Z",
    }));

    const result = runRunnerV2CompletionEntrypoint({
      sessionName: "validator-run-123",
      chainPath,
      env: {
        MENTIKO_RUN_ID: "run-123",
        MENTIKO_RUN_DIR: runDir,
        EVENTS_DIR: eventsDir,
        NAMESPACE_ID: "default",
        ORG_ID: "default",
      },
      now: new Date("2026-06-26T00:00:00.000Z"),
    });

    expect(result.decision).toBe("quality-gate-failed");
    expect(existsSync(join(artifactsDir, "triage-result.json"))).toBe(true);
    expect(readRunJson(runJsonPath)).toMatchObject({
      status: "failed",
      status_message: "agent summary artifact is invalid JSON",
    });
  });

  it("preserves an agent-declared blocked summary as a non-retryable blocked run", () => {
    const root = tempRoot();
    const runDir = join(root, "runs", "run-123");
    const eventsDir = join(root, "events");
    const artifactsDir = join(runDir, "artifacts");
    mkdirSync(runDir, { recursive: true });
    mkdirSync(eventsDir, { recursive: true });
    mkdirSync(artifactsDir, { recursive: true });
    const chainPath = join(root, "chain.json");
    writeJson(chainPath, {
      id: "chain",
      name: "Build Chain",
      config: { project_root: root },
      agents: [{ id: "updater", name: "Updater", emits: "updated" }],
    });
    const runJsonPath = join(runDir, "run.json");
    const run = createRunRecord({ chainName: "Build Chain", goal: "ship" });
    updateRunJson(runJsonPath, () => ({
      ...run,
      id: "run-123",
      status: "running",
      agents: [{ id: "updater", name: "Updater", session: "updater-run-123", status: "running" }],
      sessions: ["updater-run-123"],
    }));
    writeFileSync(join(artifactsDir, "updater-summary.json"), JSON.stringify({
      status: "blocked",
      executiveSummary: "missing capability",
    }));

    const result = runRunnerV2CompletionEntrypoint({
      sessionName: "updater-run-123",
      chainPath,
      env: {
        MENTIKO_RUN_ID: "run-123",
        MENTIKO_RUN_DIR: runDir,
        EVENTS_DIR: eventsDir,
        NAMESPACE_ID: "default",
        ORG_ID: "default",
      },
      now: new Date("2026-07-16T00:00:00.000Z"),
    });

    expect(result.decision).toBe("quality-gate-failed");
    expect(readRunJson(runJsonPath)).toMatchObject({
      status: "blocked",
      status_message: "agent summary status is blocked",
    });
  });

  it("rolls back adopted and agent state when the quality-gate terminal write fails", () => {
    const root = tempRoot();
    const runDir = join(root, "runs", "run-123");
    const eventsDir = join(root, "events");
    const artifactsDir = join(runDir, "artifacts");
    mkdirSync(runDir, { recursive: true });
    mkdirSync(eventsDir, { recursive: true });
    mkdirSync(artifactsDir, { recursive: true });
    const chainPath = join(root, "chain.json");
    writeJson(chainPath, {
      id: "chain",
      name: "Build Chain",
      config: { project_root: root },
      agents: [{ id: "validator", name: "Validator", emits: "validated" }],
    });
    const runJsonPath = join(runDir, "run.json");
    const run = createRunRecord({ chainName: "Build Chain", goal: "ship" });
    updateRunJson(runJsonPath, () => ({
      ...run,
      id: "run-123",
      status: "running",
      agents: [{ id: "validator", name: "Validator", session: "validator-run-123", status: "running" }],
      sessions: ["validator-run-123"],
    }));
    writeJson(join(artifactsDir, "validator-summary.json"), { status: "failed" });

    let mutations = 0;
    expect(() => runRunnerV2CompletionEntrypoint({
      sessionName: "validator-run-123",
      chainPath,
      env: {
        MENTIKO_RUN_ID: "run-123",
        MENTIKO_RUN_DIR: runDir,
        EVENTS_DIR: eventsDir,
        NAMESPACE_ID: "default",
        ORG_ID: "default",
      },
      now: new Date("2026-06-26T00:00:00.000Z"),
      onRunMutation: () => {
        mutations += 1;
        if (mutations === 3) throw new Error("injected quality-gate status write failure");
      },
    })).toThrow("injected quality-gate status write failure");

    const restored = readRunJson(runJsonPath);
    expect(restored).toMatchObject({
      status: "running",
      agents: [expect.objectContaining({ id: "validator", status: "running" })],
    });
    expect(restored).not.toHaveProperty("status_message");
    expect((restored.runnerV2 as { attempts?: unknown[] } | undefined)?.attempts || []).toHaveLength(0);
  });

  it("handles core generation completion without an emitted event when a payload exists", () => {
    const root = tempRoot();
    const runDir = join(root, "runs", "run-123");
    const eventsDir = join(root, "events");
    const stateDir = join(root, "state");
    const artifactsDir = join(runDir, "artifacts");
    mkdirSync(runDir, { recursive: true });
    mkdirSync(eventsDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(artifactsDir, { recursive: true });

    const chainPath = join(root, "chain.json");
    writeJson(chainPath, {
      id: "chain-recommendation",
      name: "Chain Recommendation",
      metadata: { coreGenerationChain: true, generationKind: "chain_recommendation" },
      config: { project_root: root, on_complete: "stop" },
      agents: [{ id: "chain-recommender", name: "Chain Recommender", emits: "chain-recommendation-complete" }],
    });

    const runJsonPath = join(runDir, "run.json");
    const run = createRunRecord({ chainName: "Chain Recommendation", goal: "recommend" });
    updateRunJson(runJsonPath, () => ({
      ...run,
      id: "run-123",
      status: "running",
      metadata: {
        generationJobId: "job-1",
        generationKind: "chain_recommendation",
      },
      agents: [{ id: "chain-recommender", name: "Chain Recommender", session: "chain-recommender-run-123", status: "running" }],
      sessions: ["chain-recommender-run-123"],
    }));
    writeJson(join(artifactsDir, "generation-result.json"), {
      recommendation: {
        action: "no_action_needed",
        reasoning: "Already built.",
      },
    });

    const result = runRunnerV2CompletionEntrypoint({
      sessionName: "chain-recommender-run-123",
      chainPath,
      env: {
        MENTIKO_RUN_ID: "run-123",
        MENTIKO_RUN_DIR: runDir,
        EVENTS_DIR: eventsDir,
        STATE_DIR: stateDir,
        NAMESPACE_ID: "default",
        ORG_ID: "default",
      },
      dryRun: true,
      now: new Date("2026-06-26T00:00:00.000Z"),
    });

    expect(result).toMatchObject({
      decision: "generation-terminal",
      plan: {
        action: "generation-terminal",
        effects: [
          { type: "agent-completion", plan: { reason: "agent-complete" } },
          { type: "generation-import", plan: { jobId: "job-1", generationKind: "chain_recommendation" } },
          { type: "terminal" },
        ],
      },
    });
    expect(readRunJson(runJsonPath).agents[0]).toMatchObject({
      id: "chain-recommender",
      status: "running",
    });
  });

  it("does not terminalize or import a literal not-json generation artifact", () => {
    const fixture = seedGenerationArtifactFixture({
      generationKind: "task",
      rawPayload: "not-json",
    });

    expectNoGenerationImport(completeGenerationFixture(fixture));
  });

  it("does not terminalize or import a payload for the wrong generation kind", () => {
    const fixture = seedGenerationArtifactFixture({
      generationKind: "chain_recommendation",
      payload: { route: "task", task: { title: "Wrong shape" } },
    });

    expectNoGenerationImport(completeGenerationFixture(fixture));
  });

  it("does not terminalize or import an artifact older than the current attempt", () => {
    const fixture = seedGenerationArtifactFixture({
      generationKind: "task",
      payload: { route: "task", task: { title: "Stale task" } },
      attemptStartedAt: "2026-07-15T11:59:00.000Z",
      artifactMtime: new Date("2026-07-15T11:58:00.000Z"),
    });
    // A fresh lower-priority alias must not bypass the stale canonical file:
    // the import CLI would select the canonical contract-compatible payload.
    writeJson(join(fixture.runDir, "artifacts", "task-generator-output.json"), {
      route: "task",
      task: { title: "Fresh alias" },
    });

    expectNoGenerationImport(completeGenerationFixture(fixture));
  });

  it("returns an unsupported error before mutation when run context is incomplete", () => {
    const root = tempRoot();
    const chainPath = join(root, "chain.json");
    writeJson(chainPath, {
      id: "chain",
      agents: [{ id: "writer", emits: "draft-ready" }],
    });

    expect(() => runRunnerV2CompletionEntrypoint({
      sessionName: "writer-run-123",
      chainPath,
      env: { MENTIKO_RUN_ID: "run-123" },
      dryRun: true,
    })).toThrow(RunnerV2CompletionUnsupportedError);
  });

  // ---------------------------------------------------------------
  // routed-agent coverage: agents launched by shell chain-runner.sh
  // (including relaunches the typed bridge itself fired) have no
  // bootstrap-created AgentAttempt record.
  // ---------------------------------------------------------------

  function seedRoutedRun(root: string, options?: {
    downstream?: boolean;
    downstreamStatus?: AgentStatus;
    omitChainId?: boolean;
    runChainId?: string;
    runMetadata?: Record<string, unknown>;
  }) {
    const runDir = join(root, "runs", "run-123");
    const eventsDir = join(root, "events");
    const stateDir = join(root, "state");
    mkdirSync(runDir, { recursive: true });
    mkdirSync(eventsDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });

    const chainPath = join(root, "chain.json");
    writeJson(chainPath, {
      ...(options?.omitChainId ? {} : { id: "chain" }),
      name: "Build Chain",
      config: { project_root: root },
      agents: [
        { id: "verifier", name: "Verifier", emits: "verification-complete" },
        ...(options?.downstream
          ? [{
            id: "publisher",
            name: "Publisher",
            triggers: ["verification-complete"],
            ...(options.downstreamStatus ? { status: options.downstreamStatus } : {}),
          }]
          : []),
      ],
    });

    const runJsonPath = join(runDir, "run.json");
    const run = createRunRecord({ chainName: "Build Chain", goal: "verify" });
    updateRunJson(runJsonPath, () => ({
      ...run,
      id: "run-123",
      ...(options?.runChainId ? { chainId: options.runChainId } : {}),
      status: "running",
      taskId: "TASK-173",
      ...(options?.runMetadata ? { metadata: options.runMetadata } : {}),
      agents: [
        { id: "verifier", name: "Verifier", session: "verifier-run-123", status: "running" },
        ...(options?.downstream
          ? [{ id: "publisher", name: "Publisher", session: "", status: options.downstreamStatus || "pending" }]
          : []),
      ],
      sessions: ["verifier-run-123"],
    }));
    return { runDir, eventsDir, stateDir, chainPath, runJsonPath };
  }

  function emitVerifierEvent(eventsDir: string) {
    writeFileSync(join(eventsDir, "run-123-verifier-verification-complete.event"), runnerEventFixture({
      event: "verification-complete",
      source: "verifier-run-123",
      runId: "run-123",
      data: "ok",
    }));
  }

  function routedEnv(fixture: { runDir: string; eventsDir: string; stateDir: string }) {
    return {
      MENTIKO_RUN_ID: "run-123",
      MENTIKO_RUN_DIR: fixture.runDir,
      EVENTS_DIR: fixture.eventsDir,
      STATE_DIR: fixture.stateDir,
      NAMESPACE_ID: "ns-1",
      ORG_ID: "org-1",
      MENTIKO_RUNNER_V2: "1",
      MENTIKO_RUNNER_V2_COMPLETION: "1",
      MENTIKO_SESSION_ID: "chain-run-123",
      MENTIKO_SESSION_TOKEN: "run-scoped-test-token",
    };
  }

  it("adopts and completes a typed attempt for a routed agent's run-terminal completion, queuing external effects", () => {
    const root = tempRoot();
    const fixture = seedRoutedRun(root);
    emitVerifierEvent(fixture.eventsDir);

    const result = runRunnerV2CompletionEntrypoint({
      sessionName: "verifier-run-123",
      chainPath: fixture.chainPath,
      env: routedEnv(fixture),
      now: new Date("2026-07-04T00:00:00.000Z"),
    });

    expect(result).toMatchObject({
      status: "handled",
      decision: "route",
      plan: { action: "route", launches: [] },
    });

    // typed attempt record adopted at completion time and completed from the event
    const run = readRunJson(fixture.runJsonPath) as ReturnType<typeof readRunJson> & {
      runnerV2?: { attempts?: Array<Record<string, unknown>> };
    };
    expect(run.runnerV2?.attempts).toHaveLength(1);
    expect(run.runnerV2?.attempts?.[0]).toMatchObject({
      id: "run-123:verifier:1",
      agentId: "verifier",
      phase: "completed",
      terminalReason: "completed_from_declared_event",
      origin: "routed-completion-adoption",
      processEvidence: { ptySessionId: "verifier-run-123" },
    });

    // agent terminal status complete vs run status completed
    expect(run.agents?.[0]).toMatchObject({ id: "verifier", status: "complete" });
    expect(run.status).toBe("completed");

    const activeEventPath = join(fixture.eventsDir, "run-123-verifier-verification-complete.event");
    const archivedEventPath = join(fixture.eventsDir, "archive", "run-123-verifier-verification-complete.event");
    expect(existsSync(activeEventPath)).toBe(false);
    expect(parseRunnerEvent(readFileSync(archivedEventPath, "utf8"))).toMatchObject({
      event: "verification-complete",
      runId: "run-123",
      processed: true,
    });

    // run-terminal external side effects queued to the outbox with tenant identity
    const outbox = readFileSync(join(fixture.stateDir, "external-effects.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; namespaceId?: string; orgId?: string; operation?: { event?: string; taskId?: string; chainId?: string } });
    const types = outbox.map((record) => record.type);
    expect(types).toEqual(expect.arrayContaining(["task-status", "webhook", "plugin", "notification", "metadata-webhooks"]));
    expect(outbox.find((record) => record.type === "task-status")?.operation?.taskId).toBe("TASK-173");
    expect(outbox.every((record) => record.namespaceId === "ns-1" && record.orgId === "org-1")).toBe(true);
    // per-agent effects ride the same outbox
    expect(outbox.some((record) => record.type === "plugin" && record.operation?.event === "agent-completed")).toBe(true);
    expect(outbox.some((record) => record.type === "notification" && record.operation?.event === "agent-completed")).toBe(true);

    const outboxBeforeReplay = readFileSync(join(fixture.stateDir, "external-effects.jsonl"), "utf8");
    const replay = runRunnerV2CompletionEntrypoint({
      sessionName: "verifier-run-123",
      chainPath: fixture.chainPath,
      env: routedEnv(fixture),
      now: new Date("2026-07-04T00:01:00.000Z"),
    });
    expect(replay).toMatchObject({
      status: "handled",
      decision: "already-completed",
      plan: { action: "already-completed", effects: [], launches: [] },
    });
    expect(readFileSync(join(fixture.stateDir, "external-effects.jsonl"), "utf8")).toBe(outboxBeforeReplay);
  });

  it("uses run.chainId for terminal external effects when run-local chain.json has no id", () => {
    const root = tempRoot();
    const fixture = seedRoutedRun(root, { omitChainId: true, runChainId: "e2e-fixture-execution-stream" });
    emitVerifierEvent(fixture.eventsDir);

    runRunnerV2CompletionEntrypoint({
      sessionName: "verifier-run-123",
      chainPath: fixture.chainPath,
      env: routedEnv(fixture),
      now: new Date("2026-07-04T00:00:00.000Z"),
    });

    const outbox = readFileSync(join(fixture.stateDir, "external-effects.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; operation?: { chainId?: string } });

    expect(outbox.find((record) => record.type === "metadata-webhooks")?.operation?.chainId)
      .toBe("e2e-fixture-execution-stream");
  });

  it("does not queue task status for a run-summary generation completion", () => {
    const root = tempRoot();
    const fixture = seedRoutedRun(root, {
      runMetadata: {
        generationKind: "run_summary",
        generationJobId: "job-summary-1",
        taskOutcomeSummary: true,
      },
    });
    emitVerifierEvent(fixture.eventsDir);

    runRunnerV2CompletionEntrypoint({
      sessionName: "verifier-run-123",
      chainPath: fixture.chainPath,
      env: routedEnv(fixture),
      now: new Date("2026-07-04T00:00:00.000Z"),
    });

    const outbox = readFileSync(join(fixture.stateDir, "external-effects.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string });
    expect(outbox.some((record) => record.type === "task-status")).toBe(false);
    expect(outbox.some((record) => record.type === "notification")).toBe(true);
  });

  it("does not queue task status when a decision-system run exhausts retries", () => {
    const root = tempRoot();
    const fixture = seedRoutedRun(root, {
      runMetadata: { decisionId: "decision-1", decisionPhase: "research" },
    });

    runRunnerV2CompletionEntrypoint({
      sessionName: "verifier-run-123",
      chainPath: fixture.chainPath,
      env: routedEnv(fixture),
      now: new Date("2026-07-04T00:00:00.000Z"),
    });

    const outbox = readFileSync(join(fixture.stateDir, "external-effects.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; operation?: { event?: string } });
    expect(outbox.some((record) => record.type === "task-status")).toBe(false);
    expect(outbox.some((record) => record.operation?.event === "agent-failed")).toBe(true);
  });

  describe("decision import on completion", () => {
    const originalFetch = global.fetch;
    const originalSecret = process.env.BETTER_AUTH_SECRET;

    beforeEach(() => {
      process.env.BETTER_AUTH_SECRET = "test-completion-secret";
    });

    afterEach(() => {
      global.fetch = originalFetch;
      if (originalSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
      else process.env.BETTER_AUTH_SECRET = originalSecret;
    });

    it("triggers the decision import when a decision-phase run completes with an unimported result", async () => {
      const root = tempRoot();
      const fixture = seedRoutedRun(root, {
        runMetadata: {
          decisionId: "decision-completion-1",
          decisionPhase: "plan",
          selectedOptionId: "opt-a",
          workspacePath: "/ws/repo",
        },
      });
      mkdirSync(join(fixture.runDir, "artifacts"), { recursive: true });
      writeJson(join(fixture.runDir, "artifacts", "decision-result.json"), { summary: "s", tasks: [], dependencies: [] });
      emitVerifierEvent(fixture.eventsDir);
      const fetchMock = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
      global.fetch = fetchMock;

      const result = runRunnerV2CompletionEntrypoint({
        sessionName: "verifier-run-123",
        chainPath: fixture.chainPath,
        env: routedEnv(fixture),
        now: new Date("2026-07-04T00:00:00.000Z"),
      });
      expect(readRunJson(fixture.runJsonPath).status).toBe("completed");
      // The completion path fires the import as an unawaited side effect; let
      // its microtask run before asserting on it.
      await Promise.resolve();
      await Promise.resolve();

      expect(result.decision).toBe("route");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toContain("/api/decisions/decision-completion-1/import");
      expect(JSON.parse(init.body)).toEqual({
        phase: "plan",
        runId: "run-123",
        selectedOptionId: "opt-a",
      });
    });

    it("does not trigger a decision import when a completed run carries no decision metadata", async () => {
      const root = tempRoot();
      const fixture = seedRoutedRun(root);
      // Same artifact present as the positive case above -- proves the metadata
      // gate, not artifact absence, is what suppresses the trigger here.
      mkdirSync(join(fixture.runDir, "artifacts"), { recursive: true });
      writeJson(join(fixture.runDir, "artifacts", "decision-result.json"), { summary: "s", tasks: [], dependencies: [] });
      emitVerifierEvent(fixture.eventsDir);
      const fetchMock = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
      global.fetch = fetchMock;

      runRunnerV2CompletionEntrypoint({
        sessionName: "verifier-run-123",
        chainPath: fixture.chainPath,
        env: routedEnv(fixture),
        now: new Date("2026-07-04T00:00:00.000Z"),
      });
      expect(readRunJson(fixture.runJsonPath).status).toBe("completed");
      await Promise.resolve();
      await Promise.resolve();

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("adopts and fails the typed attempt when a routed agent completes without its event", () => {
    const root = tempRoot();
    const fixture = seedRoutedRun(root);

    const result = runRunnerV2CompletionEntrypoint({
      sessionName: "verifier-run-123",
      chainPath: fixture.chainPath,
      env: routedEnv(fixture),
      now: new Date("2026-07-04T00:00:00.000Z"),
    });

    // the entrypoint always provides retry context, so a no-event completion
    // without a policy resolves as retries-exhausted (0 allowed attempts)
    expect(result).toMatchObject({ status: "handled", decision: "exhausted" });

    const run = readRunJson(fixture.runJsonPath) as ReturnType<typeof readRunJson> & {
      runnerV2?: { attempts?: Array<Record<string, unknown>> };
    };
    expect(run.runnerV2?.attempts?.[0]).toMatchObject({
      agentId: "verifier",
      phase: "completion_failed",
      terminalReason: "retries_exhausted",
      origin: "routed-completion-adoption",
    });
    expect(run.status).toBe("stopped");

    // failure external side effects queued (exhausted-path parity)
    const outbox = readFileSync(join(fixture.stateDir, "external-effects.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; operation?: { event?: string; status?: string } });
    expect(outbox.some((record) => record.type === "task-status" && record.operation?.status === "stopped")).toBe(true);
    expect(outbox.some((record) => record.type === "notification" && record.operation?.event === "agent-failed")).toBe(true);
    // no agent-completed effects for a failed verdict
    expect(outbox.some((record) => record.operation?.event === "agent-completed")).toBe(false);
  });

  it("hydrates the run-scoped typed retry count and cannot exceed max_retries without retry env", () => {
    const root = tempRoot();
    const fixture = seedRoutedRun(root);
    writeJson(fixture.chainPath, {
      id: "chain",
      name: "Build Chain",
      config: { project_root: root },
      agents: [{
        id: "verifier",
        name: "Verifier",
        emits: "verification-complete",
        retry: { max_retries: 1, base_delay_ms: 0, max_delay_ms: 0 },
      }],
    });
    const retryDir = join(fixture.stateDir, "retry");
    mkdirSync(retryDir, { recursive: true });
    writeJson(join(retryDir, "retry_run-123_verifier.json"), {
      version: 1,
      runId: "run-123",
      agentId: "verifier",
      attempt: 1,
      status: "active",
    });

    const result = runRunnerV2CompletionEntrypoint({
      sessionName: "verifier-run-123",
      chainPath: fixture.chainPath,
      env: routedEnv(fixture),
      now: new Date("2026-07-04T00:00:00.000Z"),
    });

    expect(result).toMatchObject({
      status: "handled",
      decision: "exhausted",
      plan: {
        effects: expect.arrayContaining([
          expect.objectContaining({
            type: "retry",
            plan: expect.objectContaining({ action: "exhausted", currentAttempt: 1, maxRetries: 1 }),
          }),
        ]),
      },
    });
    expect(JSON.parse(readFileSync(join(retryDir, "retry_run-123_verifier.json"), "utf8"))).toMatchObject({
      attempt: 1,
      status: "exhausted",
    });
    const replay = runRunnerV2CompletionEntrypoint({
      sessionName: "verifier-run-123",
      chainPath: fixture.chainPath,
      env: routedEnv(fixture),
      now: new Date("2026-07-04T00:00:01.000Z"),
    });
    expect(replay).toMatchObject({ decision: "exhausted" });
    expect(replay.plan.launches).toHaveLength(0);
  });

  it("fails closed on corrupt typed retry state", () => {
    const root = tempRoot();
    const fixture = seedRoutedRun(root);
    const retryDir = join(fixture.stateDir, "retry");
    mkdirSync(retryDir, { recursive: true });
    writeFileSync(join(retryDir, "retry_run-123_verifier.json"), "not-json\n");

    expect(() => runRunnerV2CompletionEntrypoint({
      sessionName: "verifier-run-123",
      chainPath: fixture.chainPath,
      env: routedEnv(fixture),
      now: new Date("2026-07-04T00:00:00.000Z"),
    })).toThrow(/corrupt typed retry state.*run-123.*verifier/);
  });

  it("plans mid-chain routed completions with adoption, launches, and per-agent effects (dry run leaves no trace)", () => {
    const root = tempRoot();
    const fixture = seedRoutedRun(root, { downstream: true });
    emitVerifierEvent(fixture.eventsDir);

    const result = runRunnerV2CompletionEntrypoint({
      sessionName: "verifier-run-123",
      chainPath: fixture.chainPath,
      env: routedEnv(fixture),
      dryRun: true,
      now: new Date("2026-07-04T00:00:00.000Z"),
    });

    expect(result).toMatchObject({
      status: "handled",
      decision: "route",
      plan: {
        action: "route",
        launches: [{ kind: "single" }],
      },
    });
    expect(result.plan.effects.some((effect) => effect.type === "agent-completion")).toBe(true);
    // mid-chain completions do not plan run-terminal effects
    expect(result.plan.effects.some((effect) => effect.type === "terminal" || effect.type === "run-terminal")).toBe(false);
    expect(result.adapter.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "plugin", event: "agent-completed", agentId: "verifier" }),
      expect.objectContaining({ type: "notification", event: "agent-completed", agentId: "verifier" }),
    ]));
    expect(result.plan.launches[0]?.env).toMatchObject({
      MENTIKO_SESSION_ID: "chain-run-123",
      MENTIKO_SESSION_TOKEN: "run-scoped-test-token",
    });

    // Capabilities may cross the private completion handoff, but are never
    // persisted in the durable run receipt.
    expect(JSON.stringify(readRunJson(fixture.runJsonPath))).not.toContain("run-scoped-test-token");

    // dry run restored the snapshot: no adopted attempt persists
    const run = readRunJson(fixture.runJsonPath) as ReturnType<typeof readRunJson> & {
      runnerV2?: { attempts?: Array<Record<string, unknown>> };
    };
    expect(run.runnerV2?.attempts || []).toHaveLength(0);
    expect(run.status).toBe("running");
    expect(existsSync(join(fixture.runDir, "chain-loop-state.json"))).toBe(false);
    expect(existsSync(shellLoopStatePath(fixture.runDir))).toBe(false);
  });

  it("rolls back completion-owned writes when attempt completion fails mid-pipeline", () => {
    const root = tempRoot();
    const fixture = seedRoutedRun(root, { downstream: true });
    emitVerifierEvent(fixture.eventsDir);
    let mutations = 0;
    expect(() => runRunnerV2CompletionEntrypoint({
      sessionName: "verifier-run-123",
      chainPath: fixture.chainPath,
      env: routedEnv(fixture),
      now: new Date("2026-07-04T00:00:00.000Z"),
      onRunMutation: () => {
        mutations += 1;
        if (mutations === 3) throw new Error("injected attempt completion failure");
      },
    })).toThrow("injected attempt completion failure");

    const restored = readRunJson(fixture.runJsonPath);
    expect(restored).toMatchObject({
      status: "running",
      agents: expect.arrayContaining([expect.objectContaining({ id: "verifier", status: "running" })]),
    });
    expect((restored.runnerV2 as { attempts?: unknown[] } | undefined)?.attempts || []).toHaveLength(0);
    expect(existsSync(join(fixture.runDir, "chain-loop-state.json"))).toBe(false);
    expect(existsSync(shellLoopStatePath(fixture.runDir))).toBe(false);
  });

  it("keeps one occurrence stable on replay and separates event content and loop rounds", () => {
    const root = tempRoot();
    const fixture = seedRoutedRun(root, { downstream: true });
    const eventPath = join(fixture.eventsDir, "run-123-verifier-verification-complete.event");
    const complete = () => runRunnerV2CompletionEntrypoint({
      sessionName: "verifier-run-123",
      chainPath: fixture.chainPath,
      env: routedEnv(fixture),
      dryRun: true,
      now: new Date("2026-07-04T00:00:00.000Z"),
    });
    const occurrence = (result: ReturnType<typeof complete>) => {
      const ids = result.adapter.operations
        .filter((operation) => operation.type === "plugin" && operation.event === "agent-completed")
        .map((operation) => operation.occurrenceId);
      expect(ids).toHaveLength(1);
      return ids[0];
    };
    writeFileSync(eventPath, runnerEventFixture({
      event: "verification-complete",
      source: "verifier-run-123",
      runId: "run-123",
      timestamp: "2026-07-04T00:00:00.000Z",
      data: "first",
    }));

    const first = occurrence(complete());
    expect(occurrence(complete())).toBe(first);

    writeFileSync(eventPath, runnerEventFixture({
      event: "verification-complete",
      source: "verifier-run-123",
      runId: "run-123",
      timestamp: "2026-07-04T00:01:00.000Z",
      data: "second",
    }));
    const changedEvent = occurrence(complete());
    expect(changedEvent).not.toBe(first);

    writeLoopState(fixture.runDir, { visited: ["verifier:verification-complete"], round: 2 });
    expect(occurrence(complete())).not.toBe(changedEvent);
  });

  it("treats duplicate processed completions as idempotent no-ops", () => {
    const root = tempRoot();
    const fixture = seedRoutedRun(root, { downstream: true, downstreamStatus: "running" });
    const runBefore = readRunJson(fixture.runJsonPath);
    updateRunJson(fixture.runJsonPath, () => ({
      ...runBefore,
      agents: [
        { id: "verifier", name: "Verifier", session: "verifier-run-123", status: "complete" },
        { id: "publisher", name: "Publisher", session: "publisher-run-123", status: "running" },
      ],
      sessions: ["verifier-run-123", "publisher-run-123"],
    }));
    writeFileSync(join(fixture.eventsDir, "run-123-verifier-verification-complete.event"), runnerEventFixture({
      event: "verification-complete",
      source: "verifier-run-123",
      runId: "run-123",
      processed: true,
      data: "ok",
    }));

    const before = readFileSync(fixture.runJsonPath, "utf8");
    const result = runRunnerV2CompletionEntrypoint({
      sessionName: "verifier-run-123",
      chainPath: fixture.chainPath,
      env: routedEnv(fixture),
      now: new Date("2026-07-04T00:00:00.000Z"),
    });

    expect(result).toMatchObject({
      status: "handled",
      decision: "already-completed",
      plan: { action: "already-completed", launches: [], effects: [] },
      adapter: { effectsApplied: [], operations: [], launchesStarted: [] },
    });
    expect(readFileSync(fixture.runJsonPath, "utf8")).toBe(before);
  });

  // regression test for the alreadyCompletedVerdict dupe guard: the OLD guard was
  // `!event.source || event.source === sessionName`. Canonical event source is
  // the bare AGENT ID (the real `mentiko emit`/MENTIKO_AGENT_ID convention), not
  // the session name, so a `source: verifier` event next to
  // `sessionName: verifier-run-123` (never equal) fell through the guard and let
  // an already-completed agent get re-routed/retried/failed. agentOwnsEvent
  // fixes this by treating the agent id, its session prefix, and the session
  // name as independent exact-match owners.
  it("detects an already-completed agent by source: <agent id> when sessionName is the distinct full session id", () => {
    const root = tempRoot();
    const fixture = seedRoutedRun(root);
    const runBefore = readRunJson(fixture.runJsonPath);
    updateRunJson(fixture.runJsonPath, () => ({
      ...runBefore,
      agents: [{ id: "verifier", name: "Verifier", session: "verifier-run-123", status: "complete" }],
      sessions: ["verifier-run-123"],
    }));
    writeFileSync(join(fixture.eventsDir, "run-123-verifier-verification-complete.event"), runnerEventFixture({
      event: "verification-complete",
      source: "verifier",
      runId: "run-123",
      processed: true,
      data: "ok",
    }));

    const before = readFileSync(fixture.runJsonPath, "utf8");
    const result = runRunnerV2CompletionEntrypoint({
      sessionName: "verifier-run-123",
      chainPath: fixture.chainPath,
      env: routedEnv(fixture),
      now: new Date("2026-07-04T00:00:00.000Z"),
    });

    expect(result).toMatchObject({
      status: "handled",
      decision: "already-completed",
      plan: { action: "already-completed", launches: [], effects: [] },
      adapter: { effectsApplied: [], operations: [], launchesStarted: [] },
    });
    expect(readFileSync(fixture.runJsonPath, "utf8")).toBe(before);
  });

  it("stays quiet when the routed completion's downstream target is already active", () => {
    const root = tempRoot();
    const fixture = seedRoutedRun(root, { downstream: true, downstreamStatus: "running" });
    emitVerifierEvent(fixture.eventsDir);

    const result = runRunnerV2CompletionEntrypoint({
      sessionName: "verifier-run-123",
      chainPath: fixture.chainPath,
      env: routedEnv(fixture),
      now: new Date("2026-07-04T00:00:00.000Z"),
    });

    expect(result).toMatchObject({ status: "handled", decision: "route", plan: { launches: [] } });
    const run = readRunJson(fixture.runJsonPath);
    // run must NOT be finalized while the sibling is still running (v1 quiet-exit parity)
    expect(run.status).toBe("running");
    expect(run.agents?.[0]).toMatchObject({ id: "verifier", status: "complete" });
  });

  it("fails closed on a legacy fan-group state file", () => {
    const root = tempRoot();
    const fixture = seedRoutedRun(root);
    emitVerifierEvent(fixture.eventsDir);

    const groupsDir = join(fixture.stateDir, "fan-groups");
    mkdirSync(groupsDir, { recursive: true });
    writeFileSync(join(groupsDir, "review-fan-1.state"), "status: running\n");

    expect(() => runRunnerV2CompletionEntrypoint({
      sessionName: "verifier-run-123",
      chainPath: fixture.chainPath,
      env: routedEnv(fixture),
      now: new Date("2026-07-04T00:00:00.000Z"),
    })).toThrow(/unsupported legacy fan-group state/);
    expect(readRunJson(fixture.runJsonPath).status).toBe("running");
  });

  it("ignores fan groups that are no longer running or belong to another run", () => {
    const root = tempRoot();
    const fixture = seedRoutedRun(root);
    emitVerifierEvent(fixture.eventsDir);

    const groupsDir = join(fixture.stateDir, "fan-groups");
    mkdirSync(groupsDir, { recursive: true });
    // Triggered group: fan-in already claimed, completion must proceed typed.
    writeJson(join(groupsDir, "done-fan.json"), {
      id: "done-fan",
      status: "complete",
      event: "fan-out-review",
      fanOutAgents: ["verifier"],
      fanInAgent: "merger",
      waitFor: "all",
      quorum: 0,
      completed: 1,
      failed: 0,
      total: 1,
      members: { verifier: "complete" },
    });
    // typed-format group scoped to another run
    writeJson(join(groupsDir, "other-run.json"), {
      id: "other-run",
      status: "running",
      event: "fan-out-review",
      fanOutAgents: ["verifier"],
      fanInAgent: "merger",
      waitFor: "all",
      quorum: 0,
      runId: "run-999",
      completed: 0,
      failed: 0,
      total: 1,
      members: {},
    });

    const result = runRunnerV2CompletionEntrypoint({
      sessionName: "verifier-run-123",
      chainPath: fixture.chainPath,
      env: routedEnv(fixture),
      now: new Date("2026-07-04T00:00:00.000Z"),
    });
    expect(result).toMatchObject({ status: "handled", decision: "route" });
  });

  it("accounts typed-store fan-group members too", () => {
    const root = tempRoot();
    const fixture = seedRoutedRun(root);
    emitVerifierEvent(fixture.eventsDir);

    const groupsDir = join(fixture.stateDir, "fan-groups");
    mkdirSync(groupsDir, { recursive: true });
    writeJson(join(groupsDir, "typed-fan.json"), {
      id: "typed-fan",
      status: "running",
      event: "fan-out-review",
      fanOutAgents: ["verifier", "other"],
      fanInAgent: "merger",
      waitFor: "all",
      quorum: 0,
      runId: "run-123",
      completed: 0,
      failed: 0,
      total: 2,
      members: {},
    });

    const result = runRunnerV2CompletionEntrypoint({
      sessionName: "verifier-run-123",
      chainPath: fixture.chainPath,
      env: routedEnv(fixture),
      now: new Date("2026-07-04T00:00:00.000Z"),
    });
    expect(result).toMatchObject({ status: "handled", decision: "fan-group-member" });
    expect(JSON.parse(readFileSync(join(groupsDir, "typed-fan.json"), "utf8"))).toMatchObject({
      completed: 1,
      members: { verifier: "complete" },
    });
  });

  it("keeps bootstrap-created attempts untouched instead of adopting a second record", () => {
    const root = tempRoot();
    const fixture = seedRoutedRun(root);
    emitVerifierEvent(fixture.eventsDir);
    updateRunJson(fixture.runJsonPath, (current) => ({
      ...(current || {}),
      runnerV2: {
        attempts: [{
          id: "run-123:verifier:1",
          runId: "run-123",
          agentId: "verifier",
          phase: "instructions_submitted",
          instructionLedger: [],
          recoveryDecisionCount: 0,
          createdAt: "2026-07-04T00:00:00.000Z",
          updatedAt: "2026-07-04T00:00:00.000Z",
          transitions: [],
        }],
      },
    } as Parameters<Parameters<typeof updateRunJson>[1]>[0] & object));

    const result = runRunnerV2CompletionEntrypoint({
      sessionName: "verifier-run-123",
      chainPath: fixture.chainPath,
      env: routedEnv(fixture),
      now: new Date("2026-07-04T00:00:00.000Z"),
    });

    expect(result).toMatchObject({ status: "handled", decision: "route" });
    const run = readRunJson(fixture.runJsonPath) as ReturnType<typeof readRunJson> & {
      runnerV2?: { attempts?: Array<Record<string, unknown>> };
    };
    expect(run.runnerV2?.attempts).toHaveLength(1);
    expect(run.runnerV2?.attempts?.[0]).toMatchObject({
      id: "run-123:verifier:1",
      phase: "completed",
      terminalReason: "completed_from_declared_event",
    });
    expect(run.runnerV2?.attempts?.[0]?.origin).toBeUndefined();
  });
});
