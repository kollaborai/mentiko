import { readLinkedDecisionSignal } from "./decision-unblock";

const taskGet = jest.fn();
const getDecision = jest.fn();

jest.mock("@/lib/tasks/task-store", () => ({
  taskGet: (...args: unknown[]) => taskGet(...args),
  taskAddDep: jest.fn(),
  taskUpdate: jest.fn(),
}));
jest.mock("@/lib/decisions/decision-storage", () => ({
  getDecision: (...args: unknown[]) => getDecision(...args),
}));
jest.mock("@/lib/runs/auto-run-service", () => ({ triggerAutoRunScan: jest.fn() }));

const OLD_APPROVED = "ac39ac80-old";
const NEW_OPEN = "c2ab767a-new";

beforeEach(() => {
  taskGet.mockReset();
  getDecision.mockReset();
  getDecision.mockImplementation((_ns: string, _org: string, id: string) =>
    id === OLD_APPROVED
      ? { status: "approved", resolution: { taskId: "TASK-005", taskIds: ["TASK-008", "TASK-009", "TASK-010"] } }
      : { status: "intake" });
});

function signal(metadata: Record<string, unknown>) {
  return readLinkedDecisionSignal({ namespaceId: "default", orgId: "default", metadata });
}

// TASK-008 shape: created from an approved decision plan, then gated on a new
// decision that nobody has answered yet.
test("an unanswered linked decision is not released by the approved decision that created the task", () => {
  taskGet.mockReturnValue({ id: "DEC-003", metadata: { decision_id: NEW_OPEN, decision_status: "intake" } });

  expect(signal({
    decision_id: OLD_APPROVED,
    decision_plan_task_id: "task-1",
    decision_subtask_id: "DEC-003",
    last_run_id: "run-1",
  })).toBeUndefined();
  expect(getDecision).not.toHaveBeenCalledWith("default", "default", OLD_APPROVED, undefined);
});

test("a plan task with no linked decision subtask is not treated as gated by its creating decision", () => {
  expect(signal({ decision_id: OLD_APPROVED, decision_plan_task_id: "task-1", last_run_id: "run-1" })).toBeUndefined();
});

test("a linked decision subtask that resolved still releases the gate", () => {
  taskGet.mockReturnValue({ id: "DEC-003", metadata: { decision_id: OLD_APPROVED, decision_status: "approved" } });

  expect(signal({ decision_subtask_id: "DEC-003", last_run_id: "run-1" })).toEqual({
    decisionId: OLD_APPROVED,
    decisionTaskId: "DEC-003",
    followUpTaskIds: ["TASK-008", "TASK-009", "TASK-010"],
    sourceRunId: "run-1",
  });
});

test("a task gated directly by decision_id, with no subtask and no plan origin, still resolves", () => {
  expect(signal({ decision_id: OLD_APPROVED, last_run_id: "run-1" })?.decisionId).toBe(OLD_APPROVED);
});
