/**
 * @jest-environment node
 *
 * Unit tests for resolveDecisionToTasks (web/lib/decisions/decision-resolution.ts).
 * Focus: parenting of decision-generated tasks.
 *   - plan + existing parentTaskId -> tasks parented under that task, NO new epic
 *   - plan + no parentTaskId       -> a new epic is created, tasks parented under it
 *   - no plan + parentTaskId       -> a single task parented under that task
 * (The decision-subtask -> triggering-task link is covered in
 *  completion-audit-apply.test.ts via the parentTaskId passed to createTaskDecision.)
 */

const taskCreate = jest.fn();
const taskGet = jest.fn();
const taskUpdate = jest.fn();
const taskAddDep = jest.fn();
const selectFollowUpTaskIds = jest.fn();
// pairs "parentId->followUpId" the mocked graph says would deadlock
let cyclePairs = new Set<string>();
const getDecision = jest.fn();
const updateDecision = jest.fn();
let resolutionLockTail = Promise.resolve();
const withDecisionResolutionLock = jest.fn(
  async (
    _namespaceId: string,
    _orgId: string,
    _decisionId: string,
    _workspacePath: string | undefined,
    fn: () => Promise<unknown>,
  ) => {
    const previous = resolutionLockTail;
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    resolutionLockTail = current;
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  },
);

// The mock class mirrors the real one from web/lib/tasks/task-store.ts closely
// enough for instanceof checks inside decision-resolution.ts. It must live
// inside the factory (jest hoists mock calls above const/class declarations).
jest.mock("@/lib/tasks/task-store", () => {
  class TaskDependencyCycleError extends Error {
    readonly taskId: string;
    readonly dependsOnId: string;
    readonly reason: "self" | "cycle";
    constructor(taskId: string, dependsOnId: string, reason: "self" | "cycle") {
      super(`dependency ${taskId} -> ${dependsOnId} would deadlock the graph (${reason})`);
      this.name = "TaskDependencyCycleError";
      this.taskId = taskId;
      this.dependsOnId = dependsOnId;
      this.reason = reason;
    }
  }
  return {
    taskCreate: (...a: unknown[]) => taskCreate(...a),
    taskGet: (...a: unknown[]) => taskGet(...a),
    taskUpdate: (...a: unknown[]) => taskUpdate(...a),
    taskAddDep: (...a: unknown[]) => taskAddDep(...a),
    selectFollowUpTaskIds: (...a: unknown[]) => selectFollowUpTaskIds(...a),
    TaskDependencyCycleError,
  };
});

jest.mock("@/lib/decisions/decision-storage", () => ({
  getDecision: (...a: unknown[]) => getDecision(...a),
  updateDecision: (...a: unknown[]) => updateDecision(...a),
  withDecisionResolutionLock: (...a: unknown[]) =>
    withDecisionResolutionLock(
      ...a as [string, string, string, string | undefined, () => Promise<unknown>],
    ),
}));

// scan_unblocked_auto_run_tasks fires a real fetch() to localhost in prod (see
// lib/runs/auto-run-service.ts) -- mock it so tests never make a real network
// call when a parented resolution reaches applyResolutionLifecycle.
const triggerAutoRunScan = jest.fn().mockResolvedValue(undefined);
jest.mock("@/lib/runs/auto-run-service", () => ({
  triggerAutoRunScan: (...a: unknown[]) => triggerAutoRunScan(...a),
}));

import { resolveDecisionToTasks as resolveDecisionToTasksWithActor } from "./decision-resolution";

let seq = 0;

function makeDecision(overrides: Record<string, unknown> = {}) {
  return {
    id: "DEC-1",
    status: "briefed",
    prompt: "Should we add SSO?",
    title: "Add SSO",
    taskId: "DEC-TASK-1",
    options: [{ id: "opt-a", letter: "A", name: "Option A", description: "Do A" }],
    ...overrides,
  };
}

const planFlow = {
  guidedFlow: {
    currentRound: 3,
    round1: { status: "complete", questions: [], answers: [] },
    round2: { status: "ready", tailoredOptions: [] },
    round3: {
      status: "ready",
      plan: {
        summary: "Plan summary",
        tasks: [
          {
            id: "t1", title: "Task one", description: "d1", priority: 1, phase: 1,
            deliverable: "Implemented first change", verification: "Run first focused test", acceptance_criteria: "First focused test passes.",
          },
          {
            id: "t2", title: "Task two", description: "d2", priority: 2, phase: 2,
            deliverable: "Implemented second change", verification: "Run second focused test", acceptance_criteria: "Second focused test passes.",
          },
        ],
        dependencies: [{ from: "t1", to: "t2" }],
      },
    },
  },
};

const TEST_ACTOR = { user_id: "session-user-1", session_id: "session-1", org_role: "owner" as const };
type ResolveInput = Parameters<typeof resolveDecisionToTasksWithActor>[0];
function resolveDecisionToTasks(input: Omit<ResolveInput, "actor" | "channel"> & Partial<Pick<ResolveInput, "actor" | "channel">>) {
  return resolveDecisionToTasksWithActor({
    ...input,
    actor: input.actor ?? TEST_ACTOR,
    channel: input.channel ?? "human",
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  seq = 0;
  cyclePairs = new Set();
  resolutionLockTail = Promise.resolve();
  // each create returns a unique id in call order: NEW-1, NEW-2, ...
  taskCreate.mockImplementation((_org: unknown, fields: Record<string, unknown>) => ({ id: `NEW-${++seq}`, ...fields }));
  taskGet.mockReturnValue({ id: "FEAT-019", issue_type: "epic", workspace_id: undefined });
  updateDecision.mockImplementation((_ns: unknown, _org: unknown, _id: unknown, patch: Record<string, unknown>) => ({ id: "DEC-1", ...patch }));
  // Mirrors the real filter: dedupe, drop the parent itself, drop pairs the
  // mocked graph says would deadlock. Tests mark deadlocking pairs in cyclePairs.
  selectFollowUpTaskIds.mockImplementation(
    ({ parentTaskId, candidates }: { parentTaskId: string; candidates: readonly unknown[] }) => {
      const seen = new Set<string>();
      const valid: string[] = [];
      for (const candidate of candidates) {
        if (typeof candidate !== "string" || candidate.length === 0) continue;
        if (candidate === parentTaskId || seen.has(candidate)) continue;
        seen.add(candidate);
        if (cyclePairs.has(`${parentTaskId}->${candidate}`)) continue;
        valid.push(candidate);
      }
      return valid;
    },
  );
});

describe("resolveDecisionToTasks parenting", () => {
  it("returns an existing resolution for a repeated approval without creating tasks", async () => {
    const decision = makeDecision({
      status: "approved",
      resolution: {
        selectedOptionId: "opt-a",
        selectedBy: "user",
        selectedAt: "2026-07-15T23:55:56.557Z",
        taskId: "NEW-1",
        taskIds: ["DEC-TASK-1", "NEW-1", "NEW-2"],
      },
    });
    getDecision.mockReturnValue(decision);

    const res = await resolveDecisionToTasks({
      namespaceId: "default",
      orgId: "default",
      decisionId: "DEC-1",
      selectedOptionId: "opt-a",
    });

    expect(res).toEqual({
      decision,
      taskId: "NEW-1",
      taskIds: ["DEC-TASK-1", "NEW-1", "NEW-2"],
    });
    expect(taskCreate).not.toHaveBeenCalled();
    expect(taskUpdate).not.toHaveBeenCalled();
    expect(updateDecision).not.toHaveBeenCalled();
  });

  it("serializes concurrent approvals so only one task tree is created", async () => {
    let stored = makeDecision({ ...planFlow });
    getDecision.mockImplementation(() => stored);
    updateDecision.mockImplementation(
      (_namespaceId: string, _orgId: string, _decisionId: string, patch: Record<string, unknown>) => {
        stored = { ...stored, ...patch };
        return Promise.resolve(stored);
      },
    );

    const [first, second] = await Promise.all([
      resolveDecisionToTasks({
        namespaceId: "default",
        orgId: "default",
        decisionId: "DEC-1",
        selectedOptionId: "opt-a",
      }),
      resolveDecisionToTasks({
        namespaceId: "default",
        orgId: "default",
        decisionId: "DEC-1",
        selectedOptionId: "opt-a",
      }),
    ]);

    expect(taskCreate).toHaveBeenCalledTimes(3);
    expect(taskCreate.mock.calls.map((call) => (call[1] as Record<string, unknown>).created_by))
      .toEqual(["session-user-1", "session-user-1", "session-user-1"]);
    expect(updateDecision).toHaveBeenCalledTimes(1);
    expect((updateDecision.mock.calls[0][3] as { resolution: { selectedBy: string; actor: unknown; channel: string } }).resolution)
      .toMatchObject({ selectedBy: "session-user-1", actor: TEST_ACTOR, channel: "human" });
    expect(second).toEqual(first);
  });

  it("plan + existing parentTaskId: parents every generated task under the parent, creates NO new epic", async () => {
    getDecision.mockReturnValue(makeDecision({ parentTaskId: "FEAT-019", ...planFlow }));

    const res = await resolveDecisionToTasks({
      namespaceId: "default",
      orgId: "default",
      decisionId: "DEC-1",
      selectedOptionId: "opt-a",
    });

    const created = taskCreate.mock.calls.map((c) => c[1] as Record<string, unknown>);
    // never spins up a new epic when a parent already exists
    expect(created.some((f) => f.issue_type === "epic")).toBe(false);
    // every plan task becomes a child of the triggering task
    const tasks = created.filter((f) => f.issue_type === "task");
    expect(tasks).toHaveLength(2);
    expect(tasks.every((f) => f.parent_id === "FEAT-019")).toBe(true);
    expect(tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        acceptance_criteria: expect.stringContaining("First focused test passes."),
        metadata: expect.objectContaining({
          decision_plan_deliverable: "Implemented first change",
          decision_plan_verification: "Run first focused test",
        }),
      }),
    ]));
    // the returned epic id is the existing parent
    expect(res.taskId).toBe("FEAT-019");
    // the decision's own subtask is closed out
    expect(taskUpdate).toHaveBeenCalledWith(
      "default",
      "DEC-TASK-1",
      expect.objectContaining({ status: "closed" }),
      "default",
    );
  });

  it("plan + NO parentTaskId: creates a new epic and parents tasks under it", async () => {
    getDecision.mockReturnValue(makeDecision({ ...planFlow }));

    const res = await resolveDecisionToTasks({
      namespaceId: "default",
      orgId: "default",
      decisionId: "DEC-1",
      selectedOptionId: "opt-a",
    });

    const created = taskCreate.mock.calls.map((c) => c[1] as Record<string, unknown>);
    const epics = created.filter((f) => f.issue_type === "epic");
    expect(epics).toHaveLength(1);
    // epic is created first -> NEW-1
    expect(res.taskId).toBe("NEW-1");
    const tasks = created.filter((f) => f.issue_type === "task");
    expect(tasks).toHaveLength(2);
    expect(tasks.every((f) => f.parent_id === "NEW-1")).toBe(true);
  });

  it("no plan + existing parentTaskId: creates a single task under the parent", async () => {
    getDecision.mockReturnValue(makeDecision({ parentTaskId: "FEAT-019" }));

    const res = await resolveDecisionToTasks({
      namespaceId: "default",
      orgId: "default",
      decisionId: "DEC-1",
      selectedOptionId: "opt-a",
    });

    const created = taskCreate.mock.calls.map((c) => c[1] as Record<string, unknown>);
    expect(created).toHaveLength(1);
    expect(created[0].issue_type).toBe("task");
    expect(created[0].parent_id).toBe("FEAT-019");
    expect(res.taskId).toBe("FEAT-019");
  });

  it("rejects an old generated plan that has no deliverable or verification instead of creating unverifiable work", async () => {
    const invalidPlan = {
      ...planFlow,
      guidedFlow: {
        ...planFlow.guidedFlow,
        round3: {
          ...planFlow.guidedFlow.round3,
          plan: {
            ...planFlow.guidedFlow.round3.plan,
            tasks: [{ id: "old", title: "Document status", description: "Write an update", priority: 2, phase: 1 }],
          },
        },
      },
    };
    getDecision.mockReturnValue(makeDecision(invalidPlan));

    await expect(resolveDecisionToTasks({
      namespaceId: "default",
      orgId: "default",
      decisionId: "DEC-1",
      selectedOptionId: "opt-a",
    })).rejects.toThrow("requires a concrete deliverable");
    expect(taskCreate).not.toHaveBeenCalled();
  });

  it("A1: parent is a feature under an epic → generated tasks land under the EPIC ancestor, not the feature", async () => {
    // FEAT-019 (the trigger the decision sits under) is a feature whose parent
    // is EPIC-008. Generated tasks should walk up to EPIC-008.
    taskGet.mockImplementation((_org: unknown, id: string) => {
      if (id === "FEAT-019") {
        return { id: "FEAT-019", issue_type: "feature", parent_id: "EPIC-008", workspace_id: undefined };
      }
      if (id === "EPIC-008") {
        return { id: "EPIC-008", issue_type: "epic", parent_id: null, workspace_id: undefined };
      }
      return undefined;
    });
    getDecision.mockReturnValue(makeDecision({ parentTaskId: "FEAT-019", ...planFlow }));

    const res = await resolveDecisionToTasks({
      namespaceId: "default",
      orgId: "default",
      decisionId: "DEC-1",
      selectedOptionId: "opt-a",
    });

    const created = taskCreate.mock.calls.map((c) => c[1] as Record<string, unknown>);
    const tasks = created.filter((f) => f.issue_type === "task");
    expect(tasks).toHaveLength(2);
    expect(tasks.every((f) => f.parent_id === "EPIC-008")).toBe(true);
    // no new epic fabricated; resolution reports the epic ancestor
    expect(created.some((f) => f.issue_type === "epic")).toBe(false);
    expect(res.taskId).toBe("EPIC-008");
  });

  it("completion-audit plan resolution blocks the original task on generated follow-ups, not the epic ancestor", async () => {
    taskGet.mockImplementation((_org: unknown, id: string) => {
      if (id === "FEAT-019") {
        return {
          id: "FEAT-019",
          issue_type: "feature",
          parent_id: "EPIC-008",
          workspace_id: undefined,
          metadata: {
            lifecycle_phase: "decision_blocked",
            decision_subtask_id: "DEC-TASK-1",
            last_run_decision_required: true,
          },
        };
      }
      if (id === "EPIC-008") {
        return { id: "EPIC-008", issue_type: "epic", parent_id: null, workspace_id: undefined, metadata: {} };
      }
      return undefined;
    });
    getDecision.mockReturnValue(makeDecision({
      source: "completion-audit",
      parentTaskId: "FEAT-019",
      ...planFlow,
    }));

    await resolveDecisionToTasks({
      namespaceId: "default",
      orgId: "default",
      decisionId: "DEC-1",
      selectedOptionId: "opt-a",
    });

    const created = taskCreate.mock.results.map((result) => result.value as { id: string });
    expect(created.map((task) => task.id)).toEqual(["NEW-1", "NEW-2"]);
    expect(taskAddDep).toHaveBeenCalledWith("default", "FEAT-019", "NEW-1", "default", undefined);
    expect(taskAddDep).toHaveBeenCalledWith("default", "FEAT-019", "NEW-2", "default", undefined);
    expect(taskAddDep).not.toHaveBeenCalledWith("default", "EPIC-008", expect.any(String), "default", undefined);
    expect(taskUpdate).toHaveBeenCalledWith(
      "default",
      "FEAT-019",
      {
        status: "blocked",
        metadata: expect.objectContaining({
          lifecycle_phase: "followup_blocked",
          followup_task_ids: ["NEW-1", "NEW-2"],
          last_run_decision_required: true,
        }),
      },
      "default",
    );
  });

  it("keeps invalid follow-ups out of lifecycle state instead of skipping only the edges (issue #113)", async () => {
    // Incident shape: one of the decision's follow-ups already depends on the
    // parent. Round 1 skipped the deadlocking EDGE but still persisted NEW-1
    // into followup_task_ids / blocked_by_task_ids, so the reconciler waited
    // on a task that could never complete while the parent was blocked. The
    // invalid follow-up must be filtered BEFORE the reducer runs: only the
    // valid follow-up is wired, stored, and waited on.
    taskGet.mockImplementation((_org: unknown, id: string) => {
      if (id === "FEAT-019") {
        return {
          id: "FEAT-019",
          issue_type: "feature",
          parent_id: "EPIC-008",
          workspace_id: undefined,
          metadata: {
            lifecycle_phase: "decision_blocked",
            decision_subtask_id: "DEC-TASK-1",
            last_run_decision_required: true,
          },
        };
      }
      if (id === "EPIC-008") {
        return { id: "EPIC-008", issue_type: "epic", parent_id: null, workspace_id: undefined, metadata: {} };
      }
      return undefined;
    });
    getDecision.mockReturnValue(makeDecision({
      source: "completion-audit",
      parentTaskId: "FEAT-019",
      ...planFlow,
    }));
    // NEW-1 "already depends on" FEAT-019 in the mocked graph; NEW-2 is clean.
    cyclePairs = new Set(["FEAT-019->NEW-1"]);

    await expect(resolveDecisionToTasks({
      namespaceId: "default",
      orgId: "default",
      decisionId: "DEC-1",
      selectedOptionId: "opt-a",
    })).resolves.toBeTruthy();

    // only the healthy edge is attempted — the invalid one is never sent to
    // the store, not thrown-and-skipped there
    expect(taskAddDep).toHaveBeenCalledWith("default", "FEAT-019", "NEW-2", "default", undefined);
    expect(taskAddDep).not.toHaveBeenCalledWith("default", "FEAT-019", "NEW-1", "default", undefined);
    // persisted lifecycle waits ONLY on the valid follow-up
    expect(taskUpdate).toHaveBeenCalledWith(
      "default",
      "FEAT-019",
      {
        status: "blocked",
        metadata: expect.objectContaining({
          lifecycle_phase: "followup_blocked",
          followup_task_ids: ["NEW-2"],
        }),
      },
      "default",
    );
  });

  it("resumes the parent when every follow-up is invalid instead of parking it (issue #113)", async () => {
    taskGet.mockImplementation((_org: unknown, id: string) => {
      if (id === "FEAT-019") {
        return {
          id: "FEAT-019",
          issue_type: "feature",
          parent_id: "EPIC-008",
          workspace_id: undefined,
          metadata: {
            lifecycle_phase: "decision_blocked",
            decision_subtask_id: "DEC-TASK-1",
            last_run_decision_required: true,
          },
        };
      }
      if (id === "EPIC-008") {
        return { id: "EPIC-008", issue_type: "epic", parent_id: null, workspace_id: undefined, metadata: {} };
      }
      return undefined;
    });
    getDecision.mockReturnValue(makeDecision({
      source: "completion-audit",
      parentTaskId: "FEAT-019",
      ...planFlow,
    }));
    // both generated follow-ups already depend on the parent
    cyclePairs = new Set(["FEAT-019->NEW-1", "FEAT-019->NEW-2"]);

    await resolveDecisionToTasks({
      namespaceId: "default",
      orgId: "default",
      decisionId: "DEC-1",
      selectedOptionId: "opt-a",
    });

    // no follow-up edge is wired (plan-internal deps between NEW tasks may
    // still exist) and the reducer's empty-list branch resumes
    expect(taskAddDep).not.toHaveBeenCalledWith("default", "FEAT-019", expect.any(String), "default", undefined);
    expect(taskUpdate).toHaveBeenCalledWith(
      "default",
      "FEAT-019",
      {
        status: "open",
        metadata: expect.objectContaining({
          lifecycle_phase: "resuming",
          followup_task_ids: [],
        }),
      },
      "default",
    );
  });

  it("closes the guided flow in the same single updateDecision write that approves (6c1773c5 shape)", async () => {
    // The victim shape: round1 still in_progress, round2 ready with an explicit
    // selection, round3 ready. Approval must land status + resolution AND the
    // round1/round2 closure + guidedFlow.completedAt in ONE write.
    getDecision.mockReturnValue(makeDecision({
      guidedFlow: {
        currentRound: 3,
        round1: { status: "in_progress", questions: [{ id: "q-1" }, { id: "q-2" }], answers: [] },
        round2: { status: "ready", tailoredOptions: [{ id: "opt-a" }], selectedOptionId: "opt-a" },
        round3: { status: "ready" },
      },
    }));

    const res = await resolveDecisionToTasks({
      namespaceId: "default",
      orgId: "default",
      decisionId: "DEC-1",
      selectedOptionId: "opt-a",
    });

    expect(updateDecision).toHaveBeenCalledTimes(1);
    const patch = updateDecision.mock.calls[0][3] as Record<string, any>;
    expect(patch.status).toBe("approved");
    expect(patch.resolution).toEqual(expect.objectContaining({ selectedOptionId: "opt-a" }));
    // same-write closure, same timestamp across every field
    expect(patch.guidedFlow.round1.status).toBe("complete");
    expect(patch.guidedFlow.round1.completedAt).toBe(patch.resolution.selectedAt);
    expect(patch.guidedFlow.round2.status).toBe("complete");
    expect(patch.guidedFlow.completedAt).toBe(patch.resolution.selectedAt);
    // the returned decision OBJECT carries the closed flow (OUTPUT, not just the patch)
    expect(res.decision.status).toBe("approved");
    const outFlow = (res.decision as any).guidedFlow;
    expect(outFlow.round1.status).toBe("complete");
    expect(outFlow.round1.completedAt).toBe(patch.resolution.selectedAt);
    expect(outFlow.round2.status).toBe("complete");
    expect(outFlow.completedAt).toBe(patch.resolution.selectedAt);
  });

  it("plan resolution closes round3 in the same write and leaves an already-complete round1 stamped", async () => {
    getDecision.mockReturnValue(makeDecision({
      ...planFlow,
      guidedFlow: {
        ...planFlow.guidedFlow,
        round1: { status: "complete", questions: [], answers: [], completedAt: "2026-01-01T00:00:00.000Z" },
      },
    }));

    await resolveDecisionToTasks({
      namespaceId: "default",
      orgId: "default",
      decisionId: "DEC-1",
      selectedOptionId: "opt-a",
    });

    expect(updateDecision).toHaveBeenCalledTimes(1);
    const patch = updateDecision.mock.calls[0][3] as Record<string, any>;
    expect(patch.guidedFlow.round3.status).toBe("complete");
    expect(patch.guidedFlow.round2.status).toBe("complete");
    expect(patch.guidedFlow.completedAt).toBe(patch.resolution.selectedAt);
    // pre-existing closure is not overwritten
    expect(patch.guidedFlow.round1.completedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("closes round1 when the flow was resolved mid-flight (pending round3 never reopens)", async () => {
    getDecision.mockReturnValue(makeDecision({
      guidedFlow: {
        currentRound: 2,
        round1: { status: "in_progress", questions: [{ id: "q-1" }], answers: [{ questionId: "q-1", choice: "a", answeredAt: "2026-01-01T00:00:00.000Z" }] },
        round2: { status: "ready", tailoredOptions: [{ id: "opt-a" }], selectedOptionId: "opt-a" },
        round3: { status: "pending" },
      },
    }));

    await resolveDecisionToTasks({
      namespaceId: "default",
      orgId: "default",
      decisionId: "DEC-1",
      selectedOptionId: "opt-a",
    });

    const patch = updateDecision.mock.calls[0][3] as Record<string, any>;
    expect(patch.guidedFlow.round1.status).toBe("complete");
    expect(patch.guidedFlow.round1.completedAt).toBe(patch.resolution.selectedAt);
    // a round that never ran is not falsely marked complete; completedAt still lands
    expect(patch.guidedFlow.round3.status).toBe("pending");
    expect(patch.guidedFlow.completedAt).toBe(patch.resolution.selectedAt);
  });

  it("completion-audit resolution with no follow-ups clears the gate and resumes the original task", async () => {
    taskGet.mockReturnValue({
      id: "FEAT-019",
      issue_type: "feature",
      workspace_id: undefined,
      metadata: {
        lifecycle_phase: "decision_blocked",
        decision_subtask_id: "DEC-TASK-1",
        last_run_decision_required: true,
      },
    });
    getDecision.mockReturnValue(makeDecision({
      source: "completion-audit",
      parentTaskId: "FEAT-019",
    }));

    await resolveDecisionToTasks({
      namespaceId: "default",
      orgId: "default",
      decisionId: "DEC-1",
      selectedOptionId: "opt-a",
    });

    expect(taskCreate).not.toHaveBeenCalled();
    expect(taskAddDep).not.toHaveBeenCalled();
    expect(taskUpdate).toHaveBeenCalledWith(
      "default",
      "FEAT-019",
      {
        status: "open",
        metadata: expect.objectContaining({
          lifecycle_phase: "resuming",
          followup_task_ids: [],
          last_run_decision_required: false,
          decision_subtask_id: undefined,
        }),
      },
      "default",
    );
  });
});
