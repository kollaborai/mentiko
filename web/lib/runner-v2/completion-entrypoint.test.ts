import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  RunnerV2CompletionUnsupportedError,
  runRunnerV2CompletionEntrypoint,
} from "@/lib/runner-v2/completion-entrypoint";
import { shellLoopStatePath } from "@/lib/runner-v2/loop-state";
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

  it("matches an event emitted into the run-dir events dir when env EVENTS_DIR points elsewhere", () => {
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
    writeFileSync(join(runEventsDir, "run-123-writer-draft-ready.event"), [
      "event: draft-ready",
      "source: writer-run-123",
      "run_id: run-123",
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
      decision: "route",
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

  function seedRoutedRun(root: string, options?: { downstream?: boolean; downstreamStatus?: string; omitChainId?: boolean; runChainId?: string }) {
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
    writeFileSync(join(eventsDir, "run-123-verifier-verification-complete.event"), [
      "event: verification-complete",
      "source: verifier-run-123",
      "run_id: run-123",
      "processed: false",
      "data: ok",
      "",
    ].join("\n"));
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
      terminalReason: "completed_from_event",
      origin: "routed-completion-adoption",
      processEvidence: { ptySessionId: "verifier-run-123" },
    });

    // agent terminal status complete vs run status completed
    expect(run.agents?.[0]).toMatchObject({ id: "verifier", status: "complete" });
    expect(run.status).toBe("completed");

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
        launches: [{ kind: "single", detached: true }],
      },
    });
    expect(result.plan.effects.some((effect) => effect.type === "agent-completion")).toBe(true);
    // mid-chain completions do not plan run-terminal effects
    expect(result.plan.effects.some((effect) => effect.type === "terminal" || effect.type === "run-terminal")).toBe(false);
    expect(result.adapter.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "plugin", event: "agent-completed", agentId: "verifier" }),
      expect.objectContaining({ type: "notification", event: "agent-completed", agentId: "verifier" }),
    ]));

    // dry run restored the snapshot: no adopted attempt persists
    const run = readRunJson(fixture.runJsonPath) as ReturnType<typeof readRunJson> & {
      runnerV2?: { attempts?: Array<Record<string, unknown>> };
    };
    expect(run.runnerV2?.attempts || []).toHaveLength(0);
    expect(run.status).toBe("running");
    expect(existsSync(join(fixture.runDir, "chain-loop-state.json"))).toBe(false);
    expect(existsSync(shellLoopStatePath(fixture.runDir))).toBe(false);
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
    writeFileSync(join(fixture.eventsDir, "run-123-verifier-verification-complete.event"), [
      "event: verification-complete",
      "source: verifier-run-123",
      "run_id: run-123",
      "processed: true",
      "data: ok",
      "",
    ].join("\n"));

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

  it("accounts shell-state fan-group members through typed completion without normal routing", () => {
    const root = tempRoot();
    const fixture = seedRoutedRun(root);
    emitVerifierEvent(fixture.eventsDir);

    // v1-format fan-group state file listing this agent as a running member
    const groupsDir = join(fixture.stateDir, "fan-groups");
    mkdirSync(groupsDir, { recursive: true });
    writeFileSync(join(groupsDir, "review-fan-1.state"), [
      "status: running",
      "started: 2026-07-04T00:00:00Z",
      "event: fan-out-review",
      "fan_out_agents: verifier other-agent",
      "fan_in_agent: merger",
      "wait_for: all",
      "quorum: 0",
      "on_error: ",
      "completed: 0",
      "failed: 0",
      "total: 2",
      "",
    ].join("\n"));

    const result = runRunnerV2CompletionEntrypoint({
      sessionName: "verifier-run-123",
      chainPath: fixture.chainPath,
      env: routedEnv(fixture),
      now: new Date("2026-07-04T00:00:00.000Z"),
    });
    expect(result).toMatchObject({ status: "handled", decision: "fan-group-member" });
    expect(readFileSync(join(groupsDir, "review-fan-1.state"), "utf8")).toContain("completed: 1");
    expect(readFileSync(join(groupsDir, "review-fan-1.state"), "utf8")).toContain("member_verifier: complete");
    expect(readRunJson(fixture.runJsonPath).status).toBe("running");
  });

  it("ignores fan groups that are no longer running or belong to another run", () => {
    const root = tempRoot();
    const fixture = seedRoutedRun(root);
    emitVerifierEvent(fixture.eventsDir);

    const groupsDir = join(fixture.stateDir, "fan-groups");
    mkdirSync(groupsDir, { recursive: true });
    // triggered group: fan-in already claimed, completion must proceed typed
    writeFileSync(join(groupsDir, "done-fan.state"), [
      "status: triggered",
      "fan_out_agents: verifier",
      "",
    ].join("\n"));
    // typed-format group scoped to another run
    writeJson(join(groupsDir, "other-run.json"), {
      id: "other-run",
      status: "running",
      fanOutAgents: ["verifier"],
      runId: "run-999",
      completed: 0,
      failed: 0,
      total: 1,
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
      fanOutAgents: ["verifier", "other"],
      runId: "run-123",
      completed: 0,
      failed: 0,
      total: 2,
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
      terminalReason: "completed_from_event",
    });
    expect(run.runnerV2?.attempts?.[0]?.origin).toBeUndefined();
  });
});
