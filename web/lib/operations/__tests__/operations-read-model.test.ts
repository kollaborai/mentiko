import type { TaskRecord } from "@/lib/tasks/task-store-types";
import type { MonitorStatusDigest } from "@/lib/monitor/status-digest";
import type { BackgroundWorkerStatus } from "@/lib/system/background-worker-state";

// canAdmitAutoRun (inside the read model) resolves dependency readiness through
// taskGet — mock the whole task store onto the test fixture so admission sees
// EXACTLY the fixture tasks and never touches a real tasks.db.
const fixture: {
  tasks: TaskRecord[];
  edges: Array<{ task_id: string; depends_on_id: string; type: string }>;
} = { tasks: [], edges: [] };

jest.mock("@/lib/tasks/task-store", () => {
  const taskStatus = jest.requireActual("@/lib/tasks/task-status");
  const depRow = (taskId: string, edge: { task_id: string; depends_on_id: string; type: string }, otherId: string) => ({
    id: otherId,
    task_id: edge.task_id,
    depends_on_id: edge.depends_on_id,
    type: edge.type,
    created_at: "2026-07-20T00:00:00Z",
    created_by: "",
    title: otherId,
    status: fixture.tasks.find((t) => t.id === otherId)?.status ?? "open",
  });
  return {
    taskGet: (_orgId: string, id: string) => {
      const task = fixture.tasks.find((t) => t.id === id);
      if (!task) return null;
      return {
        ...task,
        dependencies: fixture.edges
          .filter((e) => e.task_id === id)
          .map((e) => depRow(id, e, e.depends_on_id)),
        dependents: fixture.edges
          .filter((e) => e.depends_on_id === id)
          .map((e) => depRow(id, e, e.task_id)),
      };
    },
    taskList: () => fixture.tasks,
    taskGetAllDeps: () => fixture.edges,
    taskUpdate: jest.fn(),
    taskCount: () => 0,
    isTerminalTaskStatus: taskStatus.isTerminalTaskStatus,
    TERMINAL_TASK_STATUSES: taskStatus.TERMINAL_TASK_STATUSES,
  };
});

import { buildOperationsView, type OperationsSources } from "../operations-read-model";

const NOW = Date.parse("2026-07-21T12:00:00Z");

function task(overrides: Partial<TaskRecord> & { id: string }): TaskRecord {
  return {
    org_id: "default",
    workspace_id: "/ws/main",
    title: overrides.id,
    description: "",
    status: "open",
    priority: 2,
    issue_type: "task",
    owner: "",
    assignee: null,
    parent_id: null,
    labels: [],
    metadata: {},
    acceptance_criteria: null,
    design: null,
    notes: null,
    estimated_minutes: null,
    due_at: null,
    created_at: "2026-07-20T00:00:00Z",
    created_by: "",
    updated_at: "2026-07-20T00:00:00Z",
    closed_at: null,
    ...overrides,
  };
}

function digest(overrides: Partial<MonitorStatusDigest> = {}): MonitorStatusDigest {
  return {
    generatedAt: new Date(NOW).toISOString(),
    mode: "development",
    overall: "ok",
    headline: "all clear",
    health: { status: "healthy", failing: [], warning: [] },
    loops: { worker: "running" },
    runs: { total: 0, active: 0, recentFailures: [], recentlyReaped: [] },
    tasks: { open: 0, inProgress: 0, blocked: 0 },
    sessions: { daemonUp: true, alive: 0, dead: 0 },
    webhooks: { total: 0, delivered: 0, failed: 0, pending: 0, recentFailures: [] },
    schedules: { circuitBreaker: { enabled: false, tripped: false, activeRuns: 0, maxConcurrentRuns: 3 } },
    autoFixes: [],
    errorsRecent: [],
    attention: [],
    ...overrides,
  };
}

function worker(overrides: Partial<BackgroundWorkerStatus> = {}): BackgroundWorkerStatus {
  return {
    status: "running",
    lastCheck: new Date(NOW - 30_000).toISOString(),
    autoRun: { status: "running", lastCheck: new Date(NOW - 30_000).toISOString() },
    watchdog: { status: "running", lastCheck: new Date(NOW - 30_000).toISOString() },
    chainWatcher: { status: "running", lastCheck: new Date(NOW - 30_000).toISOString() },
    decisionReconciler: { status: "running", lastCheck: new Date(NOW - 30_000).toISOString() },
    ...overrides,
  } as BackgroundWorkerStatus;
}

interface SourcesOptions {
  tasks?: TaskRecord[];
  edges?: Array<{ task_id: string; depends_on_id: string; type: string }>;
  activeRuns?: Array<{ runId: string; taskId?: string; chainId?: string; chain?: string; admissionRelevant?: boolean; started?: string; agents?: Array<{ status?: string }> }>;
  digest?: MonitorStatusDigest;
  worker?: BackgroundWorkerStatus;
  maxConcurrent?: number;
  timelineRuns?: Array<Record<string, unknown>>;
  corrupt?: string[];
}

function makeSources(options: SourcesOptions = {}): { sources: OperationsSources; calls: Record<string, number> } {
  fixture.tasks = options.tasks ?? [];
  fixture.edges = options.edges ?? [];
  const calls: Record<string, number> = {
    listTasks: 0, listDeps: 0, buildSnapshot: 0, buildDigest: 0, scanRuns: 0, runArtifacts: 0,
  };
  const activeRuns = (options.activeRuns ?? []).map((run) => ({
    runPath: `/runs/${run.runId}/run.json`,
    taskId: run.taskId,
    admissionRelevant: run.admissionRelevant ?? true,
    active: {
      id: run.runId,
      status: "running",
      chainId: run.chainId,
      chain: run.chain,
      started: run.started ?? "2026-07-21T11:00:00Z",
    },
    raw: { agents: run.agents ?? [] } as Record<string, unknown>,
  }));
  const activeRunByTask = new Map<string, (typeof activeRuns)[number]["active"]>();
  for (const run of activeRuns) {
    if (run.taskId && run.admissionRelevant) activeRunByTask.set(run.taskId, run.active);
  }
  const sources: OperationsSources = {
    listTasks: (() => { calls.listTasks += 1; return options.tasks ?? []; }) as OperationsSources["listTasks"],
    listDeps: (() => { calls.listDeps += 1; return options.edges ?? []; }) as OperationsSources["listDeps"],
    buildSnapshot: (() => {
      calls.buildSnapshot += 1;
      return { namespaceId: "default", activeRuns, activeRunByTask };
    }) as unknown as OperationsSources["buildSnapshot"],
    buildDigest: (async () => { calls.buildDigest += 1; return options.digest ?? digest(); }) as OperationsSources["buildDigest"],
    workerStatus: () => options.worker ?? worker(),
    maxConcurrent: () => options.maxConcurrent ?? 3,
    decisions: () => [],
    scanRuns: (() => {
      calls.scanRuns += 1;
      return { runs: (options.timelineRuns ?? []) as never, corrupt: options.corrupt ?? [] };
    }) as unknown as OperationsSources["scanRuns"],
    workspaceAutoRunDefault: () => true,
    runArtifacts: (() => { calls.runArtifacts += 1; return { disk: [{ name: "report.md", path: "artifacts/report.md" }] }; }) as unknown as OperationsSources["runArtifacts"],
    now: () => NOW,
  };
  return { sources, calls };
}

describe("buildOperationsView", () => {
  it("aggregates with a constant number of source reads — no per-task fan-out", async () => {
    const tasks = Array.from({ length: 40 }, (_, i) => task({ id: `TASK-${String(i + 1).padStart(3, "0")}` }));
    const { sources, calls } = makeSources({ tasks });
    await buildOperationsView("default", "default", undefined, sources);
    expect(calls.listTasks).toBe(1);
    expect(calls.listDeps).toBe(1);
    expect(calls.buildSnapshot).toBe(1);
    expect(calls.buildDigest).toBe(1);
    expect(calls.scanRuns).toBe(1);
    expect(calls.runArtifacts).toBe(0); // no audited accomplishments in this fixture
  });

  it("running now comes from live run claims, expected-next ordering is deterministic, overflow queues on capacity", async () => {
    const tasks = [
      task({ id: "TASK-001", priority: 1, metadata: { auto_run: true } }),
      task({ id: "TASK-002", priority: 2, metadata: { auto_run: true } }),
      task({ id: "TASK-003", priority: 2, created_at: "2026-07-19T00:00:00Z", metadata: { auto_run: true } }),
      task({ id: "TASK-004", status: "in_progress", metadata: { auto_run: true, last_run_id: "run-live" } }),
    ];
    const { sources } = makeSources({
      tasks,
      maxConcurrent: 3,
      activeRuns: [
        { runId: "run-live", taskId: "TASK-004", chain: "Deploy", agents: [{ status: "running" }, { status: "complete" }] },
      ],
    });
    const view = await buildOperationsView("default", "default", undefined, sources);

    expect(view.runningNow).toHaveLength(1);
    expect(view.runningNow[0]).toMatchObject({
      runId: "run-live", taskId: "TASK-004", agentsTotal: 2, agentsActive: 1, agentsComplete: 1, kind: "execution",
    });
    const running = view.taskStates.find((state) => state.taskId === "TASK-004");
    expect(running?.reason).toBe("running");

    // Dispatch order: priority first, then created_at, then id. 2 slots free (3-1).
    expect(view.upNext.map((item) => item.taskId)).toEqual(["TASK-001", "TASK-003", "TASK-002"]);
    expect(view.upNext[0].reason).toBe("ready");
    expect(view.upNext[1].reason).toBe("ready");
    expect(view.upNext[2].reason).toBe("queued_capacity");
    expect(view.counts.availableSlots).toBe(2);
  });

  it("failed task blocks descendants; closed dependencies never count; causal path is reported", async () => {
    const tasks = [
      task({ id: "TASK-001", status: "in_progress", metadata: { auto_run: true, last_run_id: "run-f", last_run_status: "failed", chain_id: "c1" } }),
      task({ id: "TASK-002", metadata: { auto_run: true } }),
      task({ id: "TASK-003", metadata: { auto_run: true } }),
      task({ id: "TASK-990", status: "closed", closed_at: "2026-07-20T01:00:00Z" }),
      task({ id: "TASK-005", metadata: { auto_run: true } }),
    ];
    const edges = [
      { task_id: "TASK-002", depends_on_id: "TASK-001", type: "blocks" },
      { task_id: "TASK-003", depends_on_id: "TASK-002", type: "blocks" },
      { task_id: "TASK-005", depends_on_id: "TASK-990", type: "blocks" }, // closed blocker
    ];
    const { sources } = makeSources({ tasks, edges });
    const view = await buildOperationsView("default", "default", undefined, sources);

    const failed = view.taskStates.find((state) => state.taskId === "TASK-001");
    expect(failed?.reason).toBe("blocked_error");
    expect(failed?.directBlockedTaskIds).toEqual(["TASK-002"]);
    expect(failed?.blockedDownstreamTaskIds.sort()).toEqual(["TASK-002", "TASK-003"]);

    const blockedDirect = view.taskStates.find((state) => state.taskId === "TASK-002");
    expect(blockedDirect?.reason).toBe("blocked_failed_dependency");

    const blockedTransitive = view.taskStates.find((state) => state.taskId === "TASK-003");
    expect(blockedTransitive?.reason).toBe("blocked_dependency");
    expect(blockedTransitive?.causalPath).toEqual(["TASK-001", "TASK-002"]);

    // Closed dependency is not a blocker.
    const clear = view.taskStates.find((state) => state.taskId === "TASK-005");
    expect(clear?.reason).toBe("ready");
    expect(clear?.blockingTaskIds).toEqual([]);

    const errorAttention = view.attention.find((item) => item.taskId === "TASK-001");
    expect(errorAttention?.severity).toBe("critical");
    expect(errorAttention?.blockedDownstreamTaskIds).toHaveLength(2);
  });

  it("dependency cycles are reported as an error, not a queue", async () => {
    const tasks = [
      task({ id: "TASK-001", metadata: { auto_run: true } }),
      task({ id: "TASK-002", metadata: { auto_run: true } }),
    ];
    const edges = [
      { task_id: "TASK-001", depends_on_id: "TASK-002", type: "blocks" },
      { task_id: "TASK-002", depends_on_id: "TASK-001", type: "blocks" },
    ];
    const { sources } = makeSources({ tasks, edges });
    const view = await buildOperationsView("default", "default", undefined, sources);
    expect(view.dependencyCycleTaskIds).toEqual(["TASK-001", "TASK-002"]);
    expect(view.attention.some((item) => item.reason === "dependency_cycle")).toBe(true);
    expect(view.upNext).toHaveLength(0);
  });

  it("human decision gate from a decision task", async () => {
    const tasks = [
      task({ id: "DEC-001", issue_type: "decision", metadata: { decision_id: "DEC-X" } }),
    ];
    const { sources } = makeSources({ tasks });
    const view = await buildOperationsView("default", "default", undefined, sources);
    expect(view.humanGates).toHaveLength(1);
    expect(view.humanGates[0]).toMatchObject({ kind: "decision", decisionId: "DEC-X", actionUrl: "/decisions?id=DEC-X" });
  });

  it("accomplishments require an applied audited close; unlocked tasks come from the dep store", async () => {
    const audited = task({
      id: "TASK-001",
      status: "closed",
      closed_at: "2026-07-21T10:00:00Z",
      metadata: {
        chain_id: "c1",
        last_audit_verdict: "close",
        completion_audit_apply_status: "applied",
        task_outcome_summary_source_run_id: "run-done",
        task_outcome_summary: {
          headline: "Shipped the feature",
          narrative: "Everything landed.",
          what_happened: ["built it"],
          evidence: ["artifacts/report.md"],
        },
      },
    });
    const unaudited = task({
      id: "TASK-002",
      status: "closed",
      closed_at: "2026-07-21T11:00:00Z",
      metadata: { task_outcome_summary: { headline: "no audit" } },
    });
    const auditFailed = task({
      id: "TASK-003",
      status: "closed",
      closed_at: "2026-07-21T11:30:00Z",
      metadata: {
        chain_id: "c3",
        last_audit_verdict: "decision",
        completion_audit_apply_status: "applied",
        task_outcome_summary: { headline: "needs review" },
      },
    });
    const downstream = task({ id: "TASK-010", metadata: { auto_run: true } });
    const { sources, calls } = makeSources({
      tasks: [audited, unaudited, auditFailed, downstream],
      edges: [{ task_id: "TASK-010", depends_on_id: "TASK-001", type: "blocks" }],
    });
    const view = await buildOperationsView("default", "default", undefined, sources);

    expect(view.recentAccomplishments).toHaveLength(1);
    expect(view.recentAccomplishments[0]).toMatchObject({
      taskId: "TASK-001",
      headline: "Shipped the feature",
      sourceRunId: "run-done",
      unlockedTaskIds: ["TASK-010"],
      artifacts: [{ name: "report.md", path: "artifacts/report.md" }],
    });
    expect(calls.runArtifacts).toBe(1); // only the surfaced accomplishment, never per-task
  });

  it("worker stopped and stale loops are reported, recoveries flow into the timeline", async () => {
    const { sources } = makeSources({
      worker: worker({ status: "stopped" }),
      digest: digest({
        overall: "degraded",
        attention: [{ severity: "critical", message: "background worker is stopped — reconciler, watchdog, and auto-run are not running" }],
        autoFixes: [{ kind: "reaped-dead-run", detail: "run run-9 had a dead session — terminalized and freed its slot", at: "2026-07-21T09:00:00Z" }],
      }),
    });
    const view = await buildOperationsView("default", "default", undefined, sources);
    expect(view.system.worker.status).toBe("stopped");
    expect(view.system.autoRun.status).toBe("stopped");
    expect(view.attention.some((item) => item.message.includes("background worker is stopped"))).toBe(true);
    expect(view.timeline.some((item) => item.kind === "system_recovery")).toBe(true);

    const staleView = await buildOperationsView("default", "default", undefined, makeSources({
      worker: worker({ lastCheck: new Date(NOW - 10 * 60 * 1000).toISOString() }),
    }).sources);
    expect(staleView.system.worker.stale).toBe(true);
  });

  it("stale run scope surfaces as its own reason", async () => {
    const tasks = [
      task({
        id: "TASK-001",
        metadata: {
          auto_run: true,
          task_run_scope: { taskId: "TASK-OTHER", runId: "run-1" },
          last_run_id: "run-1",
        },
      }),
    ];
    const { sources } = makeSources({ tasks });
    const view = await buildOperationsView("default", "default", undefined, sources);
    expect(view.taskStates[0].reason).toBe("stale_run_scope");
  });

  it("workspace isolation: states, timeline, and accomplishments are scoped, but cross-workspace blockers still block", async () => {
    const blocker = task({ id: "TASK-001", workspace_id: "/ws/other", metadata: { auto_run: true } });
    const blocked = task({ id: "TASK-002", workspace_id: "/ws/main", metadata: { auto_run: true } });
    const { sources } = makeSources({
      tasks: [blocker, blocked],
      edges: [{ task_id: "TASK-002", depends_on_id: "TASK-001", type: "blocks" }],
    });
    const view = await buildOperationsView("default", "default", "/ws/main", sources);
    expect(view.taskStates.map((state) => state.taskId)).toEqual(["TASK-002"]);
    expect(view.taskStates[0].reason).toBe("blocked_dependency");
    expect(view.taskStates[0].blockingTaskIds).toEqual(["TASK-001"]);
    expect(view.timeline.every((item) => item.taskId !== "TASK-001")).toBe(true);
  });

  it("corrupt run records are diagnostic, never fatal", async () => {
    const { sources } = makeSources({ corrupt: ["run-broken"] });
    const view = await buildOperationsView("default", "default", undefined, sources);
    expect(view.attention.some((item) => item.reason === "corrupt_run_record" && item.message.includes("run-broken"))).toBe(true);
  });

  it("overall verdict: blocked when nothing can progress, idle when clean", async () => {
    const blockedView = await buildOperationsView("default", "default", undefined, makeSources({
      tasks: [task({ id: "TASK-001", status: "in_progress", metadata: { auto_run: true, last_run_status: "failed", last_run_id: "run-x" } })],
    }).sources);
    expect(blockedView.overall).toBe("blocked");

    const idleView = await buildOperationsView("default", "default", undefined, makeSources({}).sources);
    expect(idleView.overall).toBe("idle");
  });
});
