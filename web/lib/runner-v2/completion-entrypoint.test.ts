import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  RunnerV2CompletionUnsupportedError,
  runRunnerV2CompletionEntrypoint,
} from "@/lib/runner-v2/completion-entrypoint";
import { createRunRecord, readRunJson, updateRunJson } from "@/lib/runner-v2/run-state";

function tempRoot() {
  return mkdtempSync(join(tmpdir(), "runner-v2-completion-entrypoint-"));
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
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
    writeFileSync(eventPath, [
      "event: draft-ready",
      "source: writer-run-123",
      "run_id: run-123",
      "timestamp: 2026-06-26T00:00:00.000Z",
      "processed: false",
      "data: ready",
      "",
    ].join("\n"));

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
    writeFileSync(join(eventsDir, "run-123-validator-validated.event"), [
      "event: validated",
      "source: validator-run-123",
      "run_id: run-123",
      "timestamp: 2026-06-26T00:00:00.000Z",
      "processed: false",
      "",
    ].join("\n"));

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
});
