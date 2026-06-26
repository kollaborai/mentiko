import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runCompletionPipeline } from "@/lib/runner-v2/completion-pipeline";
import { buildTypedExecutorPlan } from "@/lib/runner-v2/executor";
import { parseRunnerEvent } from "@/lib/runner-v2/events";
import { createFanGroupState } from "@/lib/runner-v2/fan-group";
import { createRunRecord, updateRunJson } from "@/lib/runner-v2/run-state";

jest.mock("@/lib/config", () => ({
  __esModule: true,
  default: {
    codeRoot: "/repo",
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
      events: ["event: draft-ready\nsource: writer-run-123\nrun_id: run-123\nprocessed: false\n"],
    });

    expect(buildTypedExecutorPlan({ pipeline, routeContext: routeContext(dir) })).toMatchObject({
      action: "route",
      effects: [{ type: "event-side-effects" }],
      launches: [{
        kind: "single",
        command: expect.stringContaining("--start 'reviewer'"),
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
        policy: { max_retries: 2 },
        currentAttempt: 0,
      },
    });

    expect(buildTypedExecutorPlan({ pipeline, routeContext: routeContext(dir) })).toMatchObject({
      action: "retry",
      effects: [{ type: "retry" }],
      launches: [{
        kind: "single",
        command: expect.stringContaining("--start 'writer'"),
      }],
    });
  });

  it("turns fan-group on_error claims into fan-in launch plans", () => {
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
      launches: [{
        kind: "single",
        command: expect.stringContaining("--start 'recover'"),
        env: { MENTIKO_RUN_ID: "run-123", AGENT_FAN_GROUP_ID: "group-1" },
      }],
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
      events: ["event: done\nsource: writer-run-123\nrun_id: run-123\nprocessed: false\n"],
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

  it("keeps wait routes launchless and non-failed", () => {
    const dir = runDir();
    const pipeline = runCompletionPipeline({
      runDir: dir,
      runJsonPath: seedRun(dir),
      runId: "run-123",
      agent: { id: "writer", emits: "draft-ready" },
      chain: {
        agents: [{ id: "writer", emits: "draft-ready" }],
      },
      events: ["event: draft-ready\nsource: writer-run-123\nrun_id: run-123\nprocessed: false\n"],
    });

    expect(buildTypedExecutorPlan({ pipeline, routeContext: routeContext(dir) })).toMatchObject({
      action: "route",
      effects: [
        { type: "event-side-effects" },
        { type: "run-terminal", status: "completed", reason: "no downstream target" },
      ],
      launches: [],
    });
  });

  it("uses all events for owned archive side effects", () => {
    const dir = runDir();
    const owner = parseRunnerEvent("event: draft-ready\nsource: writer-run-123\nrun_id: run-123\nprocessed: false\n");
    const owned = parseRunnerEvent("event: extra\nsource: writer-run-123\nrun_id: run-123\nprocessed: false\n");
    const otherRun = parseRunnerEvent("event: extra\nsource: writer-run-999\nrun_id: run-999\nprocessed: false\n");
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
    });

    expect(plan.effects[0]).toMatchObject({
      type: "event-side-effects",
      plan: {
        markProcessed: owner,
        archiveOwned: [owner, owned],
      },
    });
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
      events: ["event: draft-ready\nsource: writer-run-123\nrun_id: run-123\nprocessed: false\n"],
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
