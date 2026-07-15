import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runCompletionPipeline } from "@/lib/runner-v2/completion-pipeline";
import { buildTypedExecutorPlan } from "@/lib/runner-v2/executor";
import { parseRunnerEvent, serializeRunnerEvent } from "@/lib/runner-v2/events";
import { createFanGroupState } from "@/lib/runner-v2/fan-group";
import { createRunRecord, updateRunJson } from "@/lib/runner-v2/run-state";

jest.mock("@/lib/config", () => ({
  __esModule: true,
  default: {
    codeRoot: "/repo",
    libDir: `${process.cwd()}/../lib`,
  },
}));

jest.mock("@/lib/api/audit-exec", () => ({
  shellEscape: (value: string) => `'${value.replace(/'/g, "'\\''")}'`,
}));

function runDir() {
  return mkdtempSync(join(tmpdir(), "runner-v2-executor-"));
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

function routeContext(dir: string) {
  return {
    chainPath: join(dir, "chain.json"),
    workspacePath: "/workspace",
    taskId: "task-1",
    runDir: dir,
    env: { MENTIKO_RUN_ID: "run-123" },
  };
}

function eventContent(event: string, source: string, runId: string): string {
  return serializeRunnerEvent({
    event,
    source,
    runId,
    timestamp: "2026-07-14T12:00:00.000Z",
    data: "",
  });
}

describe("runner-v2 typed executor plan", () => {
  it("turns a route decision into event side effects and launch plans", () => {
    const dir = runDir();
    const pipeline = runCompletionPipeline({
      runDir: dir,
      runJsonPath: seedRun(dir),
      runId: "run-123",
      agent: { id: "writer", emits: "draft-ready" },
      chain: {
        agents: [
          { id: "writer", emits: "draft-ready" },
          { id: "reviewer", triggers: ["draft-ready"] },
        ],
      },
      events: [eventContent("draft-ready", "writer-run-123", "run-123")],
    });

    expect(buildTypedExecutorPlan({ pipeline, routeContext: routeContext(dir) })).toMatchObject({
      action: "route",
      effects: [{ type: "event-side-effects" }],
      launches: [{
        kind: "single",
        command: expect.stringMatching(/runner-v2-launch-agent.*'reviewer'/),
        env: { MENTIKO_RUN_ID: "run-123" },
      }],
    });
  });

  it("turns retry decisions into same-agent relaunch plans", () => {
    const dir = runDir();
    const pipeline = runCompletionPipeline({
      runDir: dir,
      runJsonPath: seedRun(dir),
      runId: "run-123",
      agent: { id: "writer", emits: "draft-ready" },
      chain: { agents: [{ id: "writer", emits: "draft-ready" }] },
      events: [],
      retry: {
        policy: { max_retries: 2, base_delay_ms: 1500 },
        currentAttempt: 0,
      },
    });

    expect(buildTypedExecutorPlan({ pipeline, routeContext: routeContext(dir) })).toMatchObject({
      action: "retry",
      effects: [{ type: "retry" }],
      launches: [{
        kind: "single",
        command: expect.stringMatching(/^sleep '1\.5'; .*runner-v2-launch-agent.*'writer'/),
        env: expect.objectContaining({
          MENTIKO_RETRY_ATTEMPT: "1",
          RETRY_ATTEMPT: "1",
        }),
      }],
    });
  });

  it("keeps fan-group launch out of executor planning so the adapter lock decides the winner", () => {
    const dir = runDir();
    const pipeline = runCompletionPipeline({
      runDir: dir,
      runJsonPath: seedRun(dir),
      runId: "run-123",
      agent: { id: "writer", emits: "draft-ready" },
      chain: { agents: [{ id: "writer", emits: "draft-ready" }] },
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
          runId: "run-123",
        }),
        completed: 1,
      },
    });

    expect(buildTypedExecutorPlan({ pipeline, routeContext: routeContext(dir) })).toMatchObject({
      action: "exhausted",
      effects: [{ type: "fan-group" }, { type: "retry" }],
      launches: [],
    });
  });

  it("turns terminal decisions into terminal effect plans with no launch", () => {
    const dir = runDir();
    const pipeline = runCompletionPipeline({
      runDir: dir,
      runJsonPath: seedRun(dir),
      runId: "run-123",
      agent: { id: "writer" },
      chain: { name: "Build Chain", agents: [{ id: "writer" }] },
      events: [],
      terminal: {
        runId: "run-123",
        chainName: "Build Chain",
        lastAgentId: "writer",
      },
    });

    expect(buildTypedExecutorPlan({ pipeline, routeContext: routeContext(dir) })).toMatchObject({
      action: "terminal",
      effects: [{ type: "terminal" }],
      launches: [],
    });
  });

  it("turns explicit stop branches into completed terminal plans", () => {
    const dir = runDir();
    const pipeline = runCompletionPipeline({
      runDir: dir,
      runJsonPath: seedRun(dir),
      runId: "run-123",
      agent: { id: "writer", emits: "done" },
      chain: {
        name: "Build Chain",
        branches: { done: "stop" },
        agents: [{ id: "writer", emits: "done" }],
      },
      events: [eventContent("done", "writer-run-123", "run-123")],
    });

    expect(buildTypedExecutorPlan({
      pipeline,
      routeContext: routeContext(dir),
      terminal: { runId: "run-123", chainName: "Build Chain", chainPath: join(dir, "chain.json") },
    })).toMatchObject({
      action: "route",
      effects: [
        { type: "event-side-effects" },
        { type: "terminal", plan: { reason: "explicit-stop" } },
      ],
      launches: [],
    });
  });

  it("plans full terminal completion for no-downstream waits", () => {
    const dir = runDir();
    const pipeline = runCompletionPipeline({
      runDir: dir,
      runJsonPath: seedRun(dir),
      runId: "run-123",
      agent: { id: "writer", emits: "draft-ready" },
      chain: {
        agents: [{ id: "writer", emits: "draft-ready" }],
      },
      events: [eventContent("draft-ready", "writer-run-123", "run-123")],
    });

    const plan = buildTypedExecutorPlan({
      pipeline,
      routeContext: routeContext(dir),
      terminal: {
        runId: "run-123",
        chainId: "build-chain",
        chainName: "Test Chain",
        taskId: "TASK-9",
      },
    });
    expect(plan).toMatchObject({
      action: "route",
      effects: [
        { type: "event-side-effects" },
        { type: "terminal", plan: { reason: "no-downstream" } },
      ],
      launches: [],
    });
    const terminal = plan.effects.find((effect) => effect.type === "terminal");
    const steps = terminal?.type === "terminal" ? terminal.plan.steps : [];
    // shell parity: the no-downstream finalization carries the full external
    // side-effect set, and last_event comes from the completion event.
    expect(steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "run-status", status: "completed" }),
      expect.objectContaining({ type: "task-status", status: "completed", taskId: "TASK-9" }),
      expect.objectContaining({ type: "webhook", event: "chain_complete", lastEvent: "draft-ready" }),
      expect.objectContaining({ type: "plugin", event: "chain-completed" }),
      expect.objectContaining({ type: "notification", event: "chain-completed" }),
      expect.objectContaining({ type: "metadata-webhooks", event: "completed", chainId: "build-chain" }),
    ]));
  });

  it("applies no run-terminal effects when downstream targets are still pending", () => {
    const dir = runDir();
    const pipeline = runCompletionPipeline({
      runDir: dir,
      runJsonPath: seedRun(dir),
      runId: "run-123",
      agent: { id: "writer", emits: "draft-ready" },
      chain: {
        agents: [
          { id: "writer", emits: "draft-ready" },
          { id: "reviewer", triggers: ["draft-ready"], status: "running" },
        ],
      },
      events: [eventContent("draft-ready", "writer-run-123", "run-123")],
    });

    // v1 parity: the shell handler exits quietly when the downstream agent is
    // already active — the run stays running and the sibling finalizes it.
    expect(buildTypedExecutorPlan({ pipeline, routeContext: routeContext(dir) })).toMatchObject({
      action: "route",
      effects: [
        { type: "event-side-effects" },
      ],
      launches: [],
    });
  });

  it("queues per-agent completion side effects for completions that mark the agent complete", () => {
    const dir = runDir();
    const pipeline = runCompletionPipeline({
      runDir: dir,
      runJsonPath: seedRun(dir),
      runId: "run-123",
      agent: { id: "writer", emits: "draft-ready" },
      chain: {
        agents: [
          { id: "writer", emits: "draft-ready" },
          { id: "reviewer", triggers: ["draft-ready"] },
        ],
      },
      events: [eventContent("draft-ready", "writer-run-123", "run-123")],
    });

    const plan = buildTypedExecutorPlan({
      pipeline,
      routeContext: routeContext(dir),
      agentCompletion: {
        runId: "run-123",
        chainName: "Test Chain",
        agentId: "writer",
        agentName: "Writer",
        sessionName: "writer-run-123",
        chainWebhooks: { enabled: true, urls: ["https://example.com/hook"], events: ["agent_complete"] },
      },
    });

    const agentCompletion = plan.effects.find((effect) => effect.type === "agent-completion");
    expect(agentCompletion?.type === "agent-completion" ? agentCompletion.plan.steps : []).toEqual([
      { type: "plugin", event: "agent-completed", chainName: "Test Chain", runId: "run-123", agentId: "writer" },
      { type: "notification", event: "agent-completed", chainName: "Test Chain", runId: "run-123", agentId: "writer" },
      {
        type: "legacy-webhook",
        url: "https://example.com/hook",
        payload: {
          event: "agent_complete",
          chain: "Test Chain",
          agent_id: "writer",
          agent_name: "Writer",
          session: "writer-run-123",
        },
      },
    ]);
  });

  it("skips per-agent completion side effects for verdicts that fail the agent", () => {
    const dir = runDir();
    const pipeline = runCompletionPipeline({
      runDir: dir,
      runJsonPath: seedRun(dir),
      runId: "run-123",
      agent: { id: "writer", emits: "draft-ready" },
      chain: {
        agents: [
          { id: "writer", emits: "draft-ready" },
          { id: "reviewer", triggers: ["draft-ready"] },
        ],
      },
      events: [],
    });

    const plan = buildTypedExecutorPlan({
      pipeline,
      routeContext: routeContext(dir),
      agentCompletion: {
        runId: "run-123",
        chainName: "Test Chain",
        agentId: "writer",
      },
    });

    expect(plan.action).toBe("fail");
    expect(plan.effects.some((effect) => effect.type === "agent-completion")).toBe(false);
  });

  it("emits failure side-effect steps for a plain fail decision", () => {
    const dir = runDir();
    const pipeline = runCompletionPipeline({
      runDir: dir,
      runJsonPath: seedRun(dir),
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
    });

    const plan = buildTypedExecutorPlan({
      pipeline,
      routeContext: routeContext(dir),
      terminal: {
        runId: "run-123",
        chainId: "build-chain",
        chainName: "Build Chain",
        chainPath: join(dir, "chain.json"),
        taskId: "task-1",
        lastAgentId: "writer",
      },
    });

    expect(plan.action).toBe("fail");
    expect(plan.launches).toEqual([]);
    expect(plan.effects).toEqual(expect.arrayContaining([
      { type: "run-terminal", status: "failed", reason: expect.any(String) },
      expect.objectContaining({
        type: "terminal-failure",
        plan: expect.objectContaining({
          reason: "no-completion-event",
          steps: expect.arrayContaining([
            { type: "task-status", status: "failed", taskId: "task-1", runId: "run-123" },
            expect.objectContaining({ type: "circuit-breaker", action: "record-failure", agentId: "writer", threshold: 5, timeout: 300 }),
            expect.objectContaining({ type: "notification", event: "agent-failed", chainName: "Build Chain", runId: "run-123", agentId: "writer" }),
            expect.objectContaining({ type: "metadata-webhooks", event: "failed", chainId: "build-chain", chainName: "Build Chain", runId: "run-123" }),
          ]),
        }),
      }),
    ]));
  });

  it("does not recover a system run task id from route context on plain failure", () => {
    const dir = runDir();
    const pipeline = runCompletionPipeline({
      runDir: dir,
      runJsonPath: seedRun(dir),
      runId: "run-123",
      agent: { id: "writer", emits: "draft-ready" },
      chain: { name: "System Chain", agents: [{ id: "writer", emits: "draft-ready" }] },
      events: [],
    });

    const plan = buildTypedExecutorPlan({
      pipeline,
      routeContext: routeContext(dir),
      terminal: {
        runId: "run-123",
        chainName: "System Chain",
        taskId: undefined,
        lastAgentId: "writer",
      },
    });
    const failure = plan.effects.find((effect) => effect.type === "terminal-failure");

    expect(failure?.type === "terminal-failure"
      ? failure.plan.steps.some((step) => step.type === "task-status")
      : true).toBe(false);
  });

  it("carries the verified physical trigger and full identities into event lifecycle side effects", () => {
    const dir = runDir();
    const eventsDir = join(dir, "events");
    mkdirSync(eventsDir);
    const ownerContent = eventContent("draft-ready", "writer-run-123", "run-123");
    writeFileSync(join(eventsDir, "owner.event"), ownerContent);
    const owner = {
      ...parseRunnerEvent(ownerContent),
      path: join(eventsDir, "owner.event"),
    };
    const owned = {
      ...parseRunnerEvent(eventContent("extra", "writer-run-123", "run-123")),
      path: join(dir, "events", "owned.event"),
    };
    const otherRun = {
      ...parseRunnerEvent(eventContent("extra", "writer-run-999", "run-999")),
      path: join(dir, "events", "other-run.event"),
    };
    const pipeline = runCompletionPipeline({
      runDir: dir,
      runJsonPath: seedRun(dir),
      runId: "run-123",
      agent: { id: "writer", emits: "draft-ready" },
      chain: {
        agents: [
          { id: "writer", emits: "draft-ready" },
          { id: "reviewer", triggers: ["draft-ready"] },
        ],
      },
      events: [owner],
    });

    const plan = buildTypedExecutorPlan({
      pipeline,
      routeContext: routeContext(dir),
      allEvents: [owner, owned, otherRun],
      allAgentIds: ["writer", "reviewer"],
    });

    expect(plan.effects[0]).toMatchObject({
      type: "event-side-effects",
      plan: {
        markProcessed: owner,
        triggeredPath: owner.path,
        allAgentIds: ["writer", "reviewer"],
        acceptedTrigger: expect.objectContaining({
          sourceFilename: "owner.event",
          occurrenceToken: expect.stringMatching(/^[a-f0-9]{64}$/),
          rawContentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          normalizedRecordSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      },
    });
    expect(plan.launches[0].env.MENTIKO_COMPLETION_OCCURRENCE_ID)
      .toMatch(/^runner-v2-event-occurrence:[a-f0-9]{32}:v1$/);
  });

  it("creates fan-group state before fan-out child launch plans", () => {
    const dir = runDir();
    const pipeline = runCompletionPipeline({
      runDir: dir,
      runJsonPath: seedRun(dir),
      runId: "run-123",
      agent: { id: "writer", emits: "draft-ready" },
      chain: {
        branches: {
          "draft-ready": {
            fan_out: ["designer", "editor"],
            fan_in: "merge",
            wait_for: "all",
            quorum: 0,
            on_error: "recover",
          },
        },
        agents: [
          { id: "writer", emits: "draft-ready" },
          { id: "designer" },
          { id: "editor" },
        ],
      },
      events: [eventContent("draft-ready", "writer-run-123", "run-123")],
    });

    expect(buildTypedExecutorPlan({
      pipeline,
      routeContext: {
        ...routeContext(dir),
        fanGroupId: "draft-ready-fixed",
      },
    })).toMatchObject({
      action: "route",
      effects: [
        { type: "event-side-effects" },
        {
          type: "fan-group-create",
          group: {
            id: "draft-ready-fixed",
            event: "draft-ready",
            fanOutAgents: ["designer", "editor"],
            fanInAgent: "merge",
            waitFor: "all",
            onError: "recover",
          },
        },
      ],
      launches: [
        { kind: "fan-out", env: { AGENT_FAN_GROUP_ID: "draft-ready-fixed", AGENT_FAN_GROUP_AGENT_ID: "designer" } },
        { kind: "fan-out", env: { AGENT_FAN_GROUP_ID: "draft-ready-fixed", AGENT_FAN_GROUP_AGENT_ID: "editor" } },
      ],
    });
  });
});
