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

jest.mock("@/lib/tasks/task-store", () => ({
  taskCreate: (...a: unknown[]) => taskCreate(...a),
  taskGet: (...a: unknown[]) => taskGet(...a),
  taskUpdate: (...a: unknown[]) => taskUpdate(...a),
  taskAddDep: (...a: unknown[]) => taskAddDep(...a),
}));

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

import { resolveDecisionToTasks } from "./decision-resolution";

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
          { id: "t1", title: "Task one", description: "d1", priority: 1, phase: 1 },
          { id: "t2", title: "Task two", description: "d2", priority: 2, phase: 2 },
        ],
        dependencies: [{ from: "t1", to: "t2" }],
      },
    },
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  seq = 0;
  resolutionLockTail = Promise.resolve();
  // each create returns a unique id in call order: NEW-1, NEW-2, ...
  taskCreate.mockImplementation((_org: unknown, fields: Record<string, unknown>) => ({ id: `NEW-${++seq}`, ...fields }));
  taskGet.mockReturnValue({ id: "FEAT-019", issue_type: "epic", workspace_id: undefined });
  updateDecision.mockImplementation((_ns: unknown, _org: unknown, _id: unknown, patch: Record<string, unknown>) => ({ id: "DEC-1", ...patch }));
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
    expect(updateDecision).toHaveBeenCalledTimes(1);
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
