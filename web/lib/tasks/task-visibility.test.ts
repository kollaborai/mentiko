import {
  filterVisibleTaskRecords,
  filterVisibleTaskRecordsWithVisibleParents,
  isHiddenDecisionGate,
  visibleTaskRecordIds,
} from "./task-visibility";
import type { TaskRecord } from "./task-types";

const task = (id: string, overrides: Partial<TaskRecord> = {}): TaskRecord => ({
  id,
  title: id,
  description: "",
  status: "open",
  priority: 2,
  issue_type: "task",
  owner: "",
  created_at: "2026-07-07T00:00:00.000Z",
  created_by: "test",
  updated_at: "2026-07-07T00:00:00.000Z",
  ...overrides,
});

describe("task visibility", () => {
  it("hides decision gates marked superseded in their own metadata", () => {
    expect(
      isHiddenDecisionGate(
        task("DEC-039", {
          issue_type: "decision",
          metadata: { decision_status: "superseded" },
        }),
      ),
    ).toBe(true);
  });

  it("hides decision gates listed as superseded by their parent task", () => {
    const parent = task("TASK-093", {
      metadata: { superseded_decision_subtask_ids: ["DEC-039"] },
    });
    const visible = task("DEC-038", {
      issue_type: "decision",
      parent_id: "TASK-093",
      metadata: { decision_status: "briefed" },
    });
    const superseded = task("DEC-039", {
      issue_type: "decision",
      parent_id: "TASK-093",
      metadata: { decision_status: "briefed" },
    });

    expect(visibleTaskRecordIds([parent, visible, superseded])).toEqual([
      "TASK-093",
      "DEC-038",
    ]);
  });

  it("does not hide generated implementation tasks with decision provenance", () => {
    const parent = task("TASK-093", {
      metadata: { superseded_decision_subtask_ids: ["DEC-039"] },
    });
    const generatedTask = task("TASK-094", {
      parent_id: "TASK-093",
      metadata: {
        decision_id: "decision-1",
        decision_plan_task_id: "plan-1",
      },
    });

    expect(filterVisibleTaskRecords([parent, generatedTask])).toEqual([
      parent,
      generatedTask,
    ]);
  });

  it("removes parent pointers to hidden superseded decision gates", () => {
    const hiddenParent = task("DEC-039", {
      issue_type: "decision",
      metadata: { decision_status: "superseded" },
    });
    const visibleChild = task("TASK-094", { parent_id: hiddenParent.id });

    expect(filterVisibleTaskRecordsWithVisibleParents([hiddenParent, visibleChild])).toEqual([
      { ...visibleChild, parent_id: null },
    ]);
  });
});
