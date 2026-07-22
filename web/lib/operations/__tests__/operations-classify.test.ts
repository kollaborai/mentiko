import {
  buildOperationsNotifications,
  classifyTaskOperation,
  computeDownstreamImpact,
  computeOverall,
  detectDependencyCycles,
  isTaskMetadataErrored,
  shortestCausalPath,
  type ClassifyTaskInput,
} from "../operations-classify";

function input(overrides: Partial<ClassifyTaskInput> = {}): ClassifyTaskInput {
  return {
    taskId: "TASK-001",
    status: "open",
    issueType: "task",
    metadata: {},
    admission: { admit: true, reason: "ready" },
    autoRunEnabled: true,
    autoRunRetries: 0,
    autoRunUserPaused: false,
    autoRunRetriesExhausted: false,
    blockingDeps: [],
    ...overrides,
  };
}

describe("classifyTaskOperation", () => {
  it("closed for terminal statuses", () => {
    for (const status of ["closed", "resolved", "done", "complete"]) {
      expect(classifyTaskOperation(input({ status })).reason).toBe("closed");
    }
  });

  it("epic container", () => {
    expect(classifyTaskOperation(input({ issueType: "epic" })).reason).toBe("epic_container");
  });

  it("decision task is a human gate with decision id", () => {
    const result = classifyTaskOperation(input({
      issueType: "decision",
      metadata: { decision_id: "DEC-016" },
      admission: { admit: false, reason: "decision tasks advance via the decision pipeline", action: "not_runnable" },
    }));
    expect(result.reason).toBe("waiting_human_decision");
    expect(result.decisionId).toBe("DEC-016");
    expect(result.detail).toContain("DEC-016");
  });

  it("stale run scope wins over everything but terminal", () => {
    const result = classifyTaskOperation(input({
      admission: { admit: false, reason: "task run scope is invalid", action: "task_run_scope_invalid" },
      metadata: { last_run_status: "failed" },
    }));
    expect(result.reason).toBe("stale_run_scope");
  });

  it("running from a live execution run", () => {
    const result = classifyTaskOperation(input({
      activeExecutionRunId: "run-123",
      metadata: { chain_name: "Deploy Chain" },
      admission: { admit: false, reason: "a run for this task is already active", action: "active_run_exists" },
    }));
    expect(result.reason).toBe("running");
    expect(result.runId).toBe("run-123");
    expect(result.detail).toContain("Deploy Chain");
  });

  it("awaiting recommendation / generation / audit from live system runs", () => {
    expect(classifyTaskOperation(input({
      liveSystemRun: { kind: "recommendation", runId: "run-r" },
    })).reason).toBe("awaiting_recommendation");
    expect(classifyTaskOperation(input({
      liveSystemRun: { kind: "generation", runId: "run-g" },
    })).reason).toBe("awaiting_generation");
    expect(classifyTaskOperation(input({
      liveSystemRun: { kind: "audit", runId: "run-a" },
    })).reason).toBe("outcome_audit_pending");
  });

  it("run review required is a human gate", () => {
    const result = classifyTaskOperation(input({
      metadata: { last_run_decision_required: true, last_run_id: "run-9" },
      admission: { admit: false, reason: "last run requires review", action: "decision_required" },
    }));
    expect(result.reason).toBe("waiting_human_decision");
    expect(result.runId).toBe("run-9");
  });

  it("outcome audit failed", () => {
    const result = classifyTaskOperation(input({
      metadata: {
        task_outcome_summary_status: "failed",
        task_outcome_summary_error: "generation run died",
        task_outcome_summary_source_run_id: "run-src",
      },
    }));
    expect(result.reason).toBe("outcome_audit_failed");
    expect(result.detail).toContain("generation run died");
    expect(result.runId).toBe("run-src");
  });

  it("outcome audit pending from metadata (no live run)", () => {
    expect(classifyTaskOperation(input({
      metadata: { task_outcome_summary_status: "running" },
    })).reason).toBe("outcome_audit_pending");
    expect(classifyTaskOperation(input({
      metadata: { lifecycle_phase: "summarizing" },
    })).reason).toBe("outcome_audit_pending");
  });

  it("retries exhausted pauses auto-run", () => {
    const result = classifyTaskOperation(input({
      autoRunRetries: 3,
      autoRunRetriesExhausted: true,
      admission: { admit: false, reason: "max auto-run retries reached", action: "max_retries" },
    }));
    expect(result.reason).toBe("paused_retries_exhausted");
    expect(result.detail).toContain("3");
  });

  it("manual pause is distinct from retry exhaustion", () => {
    const result = classifyTaskOperation(input({
      autoRunUserPaused: true,
      metadata: { auto_run_paused: true, auto_run_paused_reason: "waiting on infra" },
      admission: { admit: false, reason: "auto-run is paused for this task", action: "paused" },
    }));
    expect(result.reason).toBe("paused_manual");
    expect(result.detail).toContain("waiting on infra");
  });

  it("own failed run is blocked_error, with retry-pending note when the lifecycle will relaunch", () => {
    const failed = classifyTaskOperation(input({
      status: "in_progress",
      metadata: { last_run_status: "failed", last_run_id: "run-x", last_run_error: "exit 1" },
      admission: { admit: false, reason: "task status 'in_progress' is not runnable", action: "not_runnable" },
    }));
    expect(failed.reason).toBe("blocked_error");
    expect(failed.runId).toBe("run-x");

    const retrying = classifyTaskOperation(input({
      status: "in_progress",
      metadata: { last_run_status: "failed", last_run_id: "run-x" },
      admission: { admit: false, reason: "not runnable", action: "not_runnable" },
      retryPending: true,
    }));
    expect(retrying.detail).toContain("automatic retry pending");
  });

  it("blocked by healthy vs failed dependency", () => {
    const healthy = classifyTaskOperation(input({
      admission: { admit: false, reason: "dependencies are not ready", action: "deps_not_ready" },
      blockingDeps: [{ id: "TASK-100", errored: false }],
    }));
    expect(healthy.reason).toBe("blocked_dependency");
    expect(healthy.detail).toBe("Waiting for TASK-100");

    const failed = classifyTaskOperation(input({
      admission: { admit: false, reason: "dependencies are not ready", action: "deps_not_ready" },
      blockingDeps: [
        { id: "TASK-100", errored: true },
        { id: "TASK-101", errored: false },
      ],
    }));
    expect(failed.reason).toBe("blocked_failed_dependency");
    expect(failed.detail).toContain("TASK-100 failed");
  });

  it("ready when admissible; chainless ready explains the recommendation path", () => {
    const withChain = classifyTaskOperation(input({
      metadata: { chain_id: "my-chain", chain_name: "My Chain" },
    }));
    expect(withChain.reason).toBe("ready");
    expect(withChain.detail).toContain("My Chain");

    const withoutChain = classifyTaskOperation(input({}));
    expect(withoutChain.reason).toBe("ready");
    expect(withoutChain.detail).toContain("recommend");
  });

  it("auto-run off: chain assigned waits for manual start, chainless is auto_run_off", () => {
    const chained = classifyTaskOperation(input({
      autoRunEnabled: false,
      metadata: { chain_id: "c1" },
      admission: { admit: false, reason: "auto-run is disabled for this task", action: "auto_run_disabled" },
    }));
    expect(chained.reason).toBe("awaiting_execution");

    const chainless = classifyTaskOperation(input({
      autoRunEnabled: false,
      admission: { admit: false, reason: "auto-run is disabled for this task", action: "auto_run_disabled" },
    }));
    expect(chainless.reason).toBe("auto_run_off");
  });

  it("in_progress with no run and no claim is inconsistent", () => {
    const result = classifyTaskOperation(input({
      status: "in_progress",
      admission: { admit: false, reason: "task status 'in_progress' is not runnable", action: "not_runnable" },
    }));
    expect(result.reason).toBe("unknown_inconsistent_state");
  });

  it("backward compatible with old/empty metadata", () => {
    const result = classifyTaskOperation(input({ metadata: {} }));
    expect(result.reason).toBe("ready");
    // Legacy string metadata values never throw.
    expect(() => classifyTaskOperation(input({
      metadata: { last_run_status: 42 as unknown as string, task_outcome_summary: "plain text" },
    }))).not.toThrow();
  });
});

describe("isTaskMetadataErrored", () => {
  it("flags failed runs, exhausted retries, failed audits — not healthy or retry-consumed states", () => {
    expect(isTaskMetadataErrored({ last_run_status: "failed" }, false)).toBe(true);
    expect(isTaskMetadataErrored({}, true)).toBe(true);
    expect(isTaskMetadataErrored({ task_outcome_summary_status: "failed" }, false)).toBe(true);
    expect(isTaskMetadataErrored({ last_run_status: "completed" }, false)).toBe(false);
    expect(isTaskMetadataErrored({ last_run_status: "retry_requested" }, false)).toBe(false);
    expect(isTaskMetadataErrored({}, false)).toBe(false);
  });
});

describe("computeDownstreamImpact", () => {
  const edges = [
    { task_id: "B", depends_on_id: "A" },
    { task_id: "C", depends_on_id: "B" },
    { task_id: "D", depends_on_id: "B" },
    { task_id: "E", depends_on_id: "A" },
    { task_id: "X", depends_on_id: "A", type: "relates_to" },
  ];

  it("counts direct and transitive open dependents, both directions distinguishable", () => {
    const impact = computeDownstreamImpact("A", edges, () => true);
    expect(impact.direct.sort()).toEqual(["B", "E"]);
    expect(impact.total.sort()).toEqual(["B", "C", "D", "E"]);
  });

  it("never counts closed dependents — historical rows on closed tasks block nothing", () => {
    const isOpen = (id: string) => id !== "B";
    const impact = computeDownstreamImpact("A", edges, isOpen);
    expect(impact.direct).toEqual(["E"]);
    // C and D hang off closed B — unreachable through a closed task.
    expect(impact.total.sort()).toEqual(["E"]);
  });

  it("ignores non-blocking edge types", () => {
    const impact = computeDownstreamImpact("A", edges, () => true);
    expect(impact.total).not.toContain("X");
  });

  it("multi-blocker chains: each blocker reports its own downstream", () => {
    const multi = [
      { task_id: "C", depends_on_id: "A" },
      { task_id: "C", depends_on_id: "B" },
    ];
    expect(computeDownstreamImpact("A", multi, () => true).total).toEqual(["C"]);
    expect(computeDownstreamImpact("B", multi, () => true).total).toEqual(["C"]);
  });
});

describe("shortestCausalPath", () => {
  it("walks up to the root blocker", () => {
    const edges = [
      { task_id: "C", depends_on_id: "B" },
      { task_id: "B", depends_on_id: "A" },
    ];
    // C blocked by B blocked by A (root) → path A → B.
    expect(shortestCausalPath("C", edges, () => true)).toEqual(["A", "B"]);
  });

  it("skips finished blockers", () => {
    const edges = [
      { task_id: "C", depends_on_id: "B" },
      { task_id: "C", depends_on_id: "Z" },
      { task_id: "B", depends_on_id: "A" },
    ];
    const unfinished = (id: string) => id !== "Z" && id !== "A";
    // Z closed, A closed → B itself is the root blocker.
    expect(shortestCausalPath("C", edges, unfinished)).toEqual(["B"]);
  });
});

describe("detectDependencyCycles", () => {
  it("finds cycle participants and leaves acyclic graphs alone", () => {
    const open = new Set(["A", "B", "C", "D"]);
    expect(detectDependencyCycles(open, [
      { task_id: "B", depends_on_id: "A" },
      { task_id: "C", depends_on_id: "B" },
    ])).toEqual([]);

    expect(detectDependencyCycles(open, [
      { task_id: "A", depends_on_id: "B" },
      { task_id: "B", depends_on_id: "A" },
      { task_id: "C", depends_on_id: "A" },
    ])).toEqual(["A", "B", "C"]); // C is pinned behind the cycle too

    // Closed tasks cannot participate: edges to tasks outside the open set are ignored.
    expect(detectDependencyCycles(new Set(["A"]), [
      { task_id: "A", depends_on_id: "B" },
      { task_id: "B", depends_on_id: "A" },
    ])).toEqual([]);
  });
});

describe("computeOverall", () => {
  const base = { digestOverall: "ok" as const, activeRunCount: 0, readyCount: 0, attentionCount: 0, openBlockerCount: 0 };
  it("maps the five states truthfully", () => {
    expect(computeOverall({ ...base, digestOverall: "unhealthy" })).toBe("unhealthy");
    expect(computeOverall({ ...base, openBlockerCount: 2 })).toBe("blocked");
    expect(computeOverall({ ...base, digestOverall: "degraded", activeRunCount: 1 })).toBe("degraded");
    expect(computeOverall({ ...base, attentionCount: 1, activeRunCount: 1 })).toBe("degraded");
    expect(computeOverall({ ...base, activeRunCount: 2 })).toBe("running");
    expect(computeOverall(base)).toBe("idle");
    // A blocker with work still flowing is degraded, not blocked.
    expect(computeOverall({ ...base, openBlockerCount: 1, activeRunCount: 1, attentionCount: 1 })).toBe("degraded");
  });
});

describe("buildOperationsNotifications", () => {
  const taskState = {
    taskId: "TASK-001",
    title: "Ship feature",
    reason: "blocked_error" as const,
    runId: "run-1",
    decisionId: undefined,
    retries: 1,
    downstreamOpenCount: 2,
    updatedAt: "2026-07-21T00:00:00Z",
  };
  const quietSystem = {
    workerStatus: "running" as const,
    workerStale: false,
    workerAnchor: "2026-07-21T00:00:00Z",
    loopErrors: [],
    reapedRuns: [],
    unblocked: [],
  };

  it("keys are stable per durable transition — identical polls dedupe", () => {
    const first = buildOperationsNotifications([taskState], quietSystem);
    const second = buildOperationsNotifications([taskState], quietSystem);
    expect(first).toHaveLength(1);
    expect(first[0].idempotencyKey).toBe("ops:task-error:TASK-001:run-1");
    expect(second[0].idempotencyKey).toBe(first[0].idempotencyKey);
    expect(first[0].message).toContain("blocking 2 downstream tasks");
  });

  it("a new run id is a new transition", () => {
    const next = buildOperationsNotifications([{ ...taskState, runId: "run-2" }], quietSystem);
    expect(next[0].idempotencyKey).toBe("ops:task-error:TASK-001:run-2");
  });

  it("covers retries exhausted, audit failed, decision gates, worker down, loop errors, reaps, unblocks", () => {
    const specs = buildOperationsNotifications(
      [
        { ...taskState, reason: "paused_retries_exhausted", retries: 3 },
        { ...taskState, taskId: "TASK-002", reason: "outcome_audit_failed" },
        { ...taskState, taskId: "DEC-001", reason: "waiting_human_decision", decisionId: "DEC-X" },
      ],
      {
        workerStatus: "stopped",
        workerStale: false,
        workerAnchor: "anchor-1",
        loopErrors: [{ loop: "autoRun", error: "boom" }],
        reapedRuns: [{ runId: "run-dead", detail: "no agent liveness" }],
        unblocked: [{ taskId: "TASK-009", closedAt: "2026-07-20T00:00:00Z", releasedTaskIds: ["TASK-010"] }],
      },
    );
    const keys = specs.map((spec) => spec.idempotencyKey);
    expect(keys).toEqual(expect.arrayContaining([
      "ops:retries-exhausted:TASK-001:3",
      "ops:audit-failed:TASK-002:run-1",
      "ops:decision-gate:DEC-X",
      "ops:worker-stopped:anchor-1",
      expect.stringMatching(/^ops:loop-error:autoRun:/),
      "ops:reaped:run-dead",
      "ops:unblocked:TASK-009:2026-07-20T00:00:00Z",
    ]));
    const decisionSpec = specs.find((spec) => spec.idempotencyKey === "ops:decision-gate:DEC-X");
    expect(decisionSpec?.metadata.actionUrl).toBe("/decisions?id=DEC-X");
  });
});

describe("execution-complete awaiting audit", () => {
  it("a completed execution on an open task is audit-pending, not inconsistent", () => {
    const result = classifyTaskOperation({
      taskId: "TASK-001",
      status: "in_progress",
      issueType: "task",
      metadata: { chain_id: "c1", last_run_id: "run-done", last_run_status: "completed" },
      admission: { admit: false, reason: "last execution run already completed", action: "already_completed" },
      autoRunEnabled: true,
      autoRunRetries: 0,
      autoRunUserPaused: false,
      autoRunRetriesExhausted: false,
      blockingDeps: [],
    });
    expect(result.reason).toBe("outcome_audit_pending");
    expect(result.runId).toBe("run-done");
  });
});
