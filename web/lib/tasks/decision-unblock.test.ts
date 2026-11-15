/**
 * @jest-environment node
 *
 * Recovery-path coverage for issue #113: when the reconciler unblocks a
 * decision_blocked task off an already-resolved decision, the follow-up list
 * rebuilt from decision.resolution must never contain the blocked parent
 * itself or a task that already (transitively) depends on it. The REAL task
 * store backs these tests (config mocked to a throwaway root), so
 * selectFollowUpTaskIds, taskAddDep's cycle guard and the persisted metadata
 * are all exercised end to end through unblockTaskViaResolvedDecision.
 */

jest.mock("../config", () => ({
  __esModule: true,
  default: {
    globalRoot: "/tmp/mentiko-unblock-test-" + process.pid,
    codeRoot: "/tmp",
  },
}));

const mockGetDecision = jest.fn();
jest.mock("@/lib/decisions/decision-storage", () => ({
  getDecision: (...a: unknown[]) => mockGetDecision(...a),
  withDecisionResolutionLock: jest.fn(
    (_ns: unknown, _org: unknown, _id: unknown, _ws: unknown, fn: () => unknown) => fn(),
  ),
}));

jest.mock("@/lib/tasks/decision-gate-release", () => ({
  releaseDecisionGateMetadata: (metadata: Record<string, unknown>) => metadata,
}));

jest.mock("@/lib/runs/auto-run-service", () => ({
  triggerAutoRunScan: jest.fn().mockResolvedValue(undefined),
}));

const mockSelectFollowUpTaskIds = jest.fn();
jest.mock("@/lib/tasks/task-store", () => {
  const actual = jest.requireActual("@/lib/tasks/task-store");
  return {
    ...actual,
    // The ES namespace is sealed, so jest.spyOn cannot intercept this export;
    // route it through a mockable fn instead (default: the real policy).
    selectFollowUpTaskIds: (...a: unknown[]) => mockSelectFollowUpTaskIds(...a),
  };
});

import {
  taskAddDep,
  taskClose,
  taskCreate,
  taskDepsAllClosed,
  taskGet,
  closeAll,
} from "./task-store";

const actualTaskStore = jest.requireActual("@/lib/tasks/task-store") as typeof import("./task-store");
type SelectFollowUpInput = Parameters<typeof actualTaskStore.selectFollowUpTaskIds>[0];
import { unblockTaskViaResolvedDecision } from "./decision-unblock";

const NS = "unblock-ns";
const ORG = "unblock-org";

// The decision subtask must exist in the org first: recovery reads it for the
// decision pointer mirror, and the parent's metadata points at its real id.
function makeDecisionSubtask() {
  return taskCreate(ORG, {
    title: "Decision subtask",
    metadata: { decision_id: "DEC-1", decision_status: "approved" },
  }, NS);
}

function makeParent(subtaskId: string) {
  return taskCreate(ORG, {
    title: "Blocked parent",
    metadata: {
      lifecycle_phase: "decision_blocked",
      decision_id: "DEC-1",
      decision_subtask_id: subtaskId,
      last_run_id: "run-1",
    },
  }, NS);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSelectFollowUpTaskIds.mockImplementation(
    (input: SelectFollowUpInput) => actualTaskStore.selectFollowUpTaskIds(input),
  );
});

afterAll(() => {
  closeAll();
});

describe("unblockTaskViaResolvedDecision follow-up validity (issue #113)", () => {
  it("waits only on valid follow-ups when the resolution list contains the parent, a dependent and a valid task", async () => {
    const subtask = makeDecisionSubtask();
    const parent = makeParent(subtask.id);
    const dependent = taskCreate(ORG, { title: "Already depends on parent" }, NS);
    taskAddDep(ORG, dependent.id, parent.id, NS); // dependent -> parent
    const valid = taskCreate(ORG, { title: "Valid follow-up" }, NS);

    mockGetDecision.mockReturnValue({
      id: "DEC-1",
      status: "approved",
      resolution: {
        taskId: parent.id, // epic container id === the parent here (malformed)
        taskIds: [subtask.id, parent.id, dependent.id, valid.id, "GHOST-1"],
      },
    });

    const outcome = await unblockTaskViaResolvedDecision({
      request: {} as Request,
      namespaceId: NS,
      orgId: ORG,
      taskId: parent.id,
      metadata: taskGet(ORG, parent.id, NS)!.metadata as Record<string, unknown>,
    });

    expect(outcome.outcome).toBe("released");
    if (outcome.outcome !== "released") return;

    // Only the valid follow-up is stored and waited on
    expect(outcome.followUpTaskIds).toEqual([valid.id]);
    const meta = taskGet(ORG, parent.id, NS)!.metadata as Record<string, unknown>;
    expect(meta.lifecycle_phase).toBe("followup_blocked");
    expect(meta.followup_task_ids).toEqual([valid.id]);

    // Only the healthy edge was wired
    const deps = taskGet(ORG, parent.id, NS)!.dependencies!;
    expect(deps.map((d) => d.depends_on_id)).toEqual([valid.id]);

    // The reconciler can advance: once the single valid follow-up closes, the
    // parent's blockers are all done (nothing in the wait list can deadlock).
    expect(taskDepsAllClosed(ORG, parent.id, NS)).toBe(false);
    taskClose(ORG, valid.id, undefined, NS);
    expect(taskDepsAllClosed(ORG, parent.id, NS)).toBe(true);
  });

  it("resumes the parent when no follow-up is valid", async () => {
    const subtask = makeDecisionSubtask();
    const parent = makeParent(subtask.id);
    const dependent = taskCreate(ORG, { title: "Dependent" }, NS);
    taskAddDep(ORG, dependent.id, parent.id, NS);

    mockGetDecision.mockReturnValue({
      id: "DEC-1",
      status: "approved",
      resolution: {
        taskId: "EPIC-X",
        taskIds: [subtask.id, parent.id, dependent.id],
      },
    });

    const outcome = await unblockTaskViaResolvedDecision({
      request: {} as Request,
      namespaceId: NS,
      orgId: ORG,
      taskId: parent.id,
      metadata: taskGet(ORG, parent.id, NS)!.metadata as Record<string, unknown>,
    });

    expect(outcome.outcome).toBe("released");
    if (outcome.outcome !== "released") return;
    expect(outcome.phase).toBe("resuming");

    const record = taskGet(ORG, parent.id, NS)!;
    expect(record.status).toBe("open");
    const meta = record.metadata as Record<string, unknown>;
    expect(meta.lifecycle_phase).toBe("resuming");
    expect(meta.followup_task_ids).toEqual([]);
    expect(record.dependencies!.length).toBe(0);
  });

  it("persists only follow-ups whose edge insert was accepted when selection and insertion race (issue #113)", async () => {
    const subtask = makeDecisionSubtask();
    const parent = makeParent(subtask.id);
    const racy = taskCreate(ORG, { title: "Racy follow-up" }, NS);
    const valid = taskCreate(ORG, { title: "Valid follow-up" }, NS);

    mockGetDecision.mockReturnValue({
      id: "DEC-1",
      status: "approved",
      resolution: { taskId: "EPIC-X", taskIds: [subtask.id, racy.id, valid.id] },
    });

    // Simulate the race: selection sees a clean graph (both candidates pass),
    // then the reverse edge racy -> parent lands BEFORE the parent -> racy
    // insert runs — taskAddDep rejects only that edge.
    mockSelectFollowUpTaskIds.mockImplementation((input: SelectFollowUpInput) => {
      const result = actualTaskStore.selectFollowUpTaskIds(input);
      taskAddDep(ORG, racy.id, parent.id, NS);
      return result;
    });

    const outcome = await unblockTaskViaResolvedDecision({
      request: {} as Request,
      namespaceId: NS,
      orgId: ORG,
      taskId: parent.id,
      metadata: taskGet(ORG, parent.id, NS)!.metadata as Record<string, unknown>,
    });

    expect(outcome.outcome).toBe("released");
    if (outcome.outcome !== "released") return;
    // only the accepted edge is stored and waited on; the rejected id is
    // never persisted as a wait
    expect(outcome.followUpTaskIds).toEqual([valid.id]);
    const meta = taskGet(ORG, parent.id, NS)!.metadata as Record<string, unknown>;
    expect(meta.followup_task_ids).toEqual([valid.id]);
    expect(taskGet(ORG, parent.id, NS)!.dependencies!.map((d) => d.depends_on_id)).toEqual([valid.id]);
  });

  it("prefers persisted explicit follow-up ids over the broad resolution list (issue #113)", async () => {
    const subtask = makeDecisionSubtask();
    const valid = taskCreate(ORG, { title: "Explicitly persisted follow-up" }, NS);
    const unrelated = taskCreate(ORG, { title: "In the resolution list but never a blocker" }, NS);
    const parent = taskCreate(ORG, {
      title: "Blocked parent with persisted follow-ups",
      metadata: {
        lifecycle_phase: "decision_blocked",
        decision_id: "DEC-1",
        decision_subtask_id: subtask.id,
        last_run_id: "run-1",
        followup_task_ids: [valid.id],
      },
    }, NS);

    mockGetDecision.mockReturnValue({
      id: "DEC-1",
      status: "approved",
      resolution: { taskId: "EPIC-X", taskIds: [subtask.id, unrelated.id, valid.id] },
    });

    const outcome = await unblockTaskViaResolvedDecision({
      request: {} as Request,
      namespaceId: NS,
      orgId: ORG,
      taskId: parent.id,
      metadata: taskGet(ORG, parent.id, NS)!.metadata as Record<string, unknown>,
    });

    expect(outcome.outcome).toBe("released");
    if (outcome.outcome !== "released") return;
    // the unrelated resolution-list task is never wired or waited on
    expect(outcome.followUpTaskIds).toEqual([valid.id]);
    const wired = taskGet(ORG, parent.id, NS)!.dependencies!.map((d) => d.depends_on_id);
    expect(wired).toEqual([valid.id]);
    expect(wired).not.toContain(unrelated.id);
  });
});
