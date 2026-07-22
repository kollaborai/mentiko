import {
  operationalRank,
  sortTaskTreeNodes,
  sortTasksByDependencyOrder,
  sortTasksByOperationalOrder,
  type OperationalOrderState,
} from "../tasks/task-ordering";

describe("sortTasksByDependencyOrder", () => {
  const task = (id: string, priority = 1) => ({
    id,
    title: id,
    priority,
    created_at: "2026-04-30T00:00:00.000Z",
  });

  it("orders tasks so blockers appear before the tasks they unlock", () => {
    const tasks = [
      task("TASK-040", 2),
      task("TASK-035", 1),
      task("TASK-036", 0),
      task("TASK-031", 0),
      task("TASK-034", 1),
      task("TASK-033", 0),
      task("TASK-032", 0),
    ];

    const deps = [
      { task_id: "TASK-032", depends_on_id: "TASK-031", type: "blocks" },
      { task_id: "TASK-033", depends_on_id: "TASK-031", type: "blocks" },
      { task_id: "TASK-034", depends_on_id: "TASK-032", type: "blocks" },
      { task_id: "TASK-035", depends_on_id: "TASK-033", type: "blocks" },
      { task_id: "TASK-035", depends_on_id: "TASK-034", type: "blocks" },
      { task_id: "TASK-036", depends_on_id: "TASK-035", type: "blocks" },
      { task_id: "TASK-040", depends_on_id: "TASK-036", type: "blocks" },
    ];

    expect(sortTasksByDependencyOrder(tasks, deps).map((item) => item.id)).toEqual([
      "TASK-031",
      "TASK-032",
      "TASK-033",
      "TASK-034",
      "TASK-035",
      "TASK-036",
      "TASK-040",
    ]);
  });

  it("accepts the client dependency map used by the tasks page", () => {
    const tasks = [task("TASK-003"), task("TASK-001"), task("TASK-002")];
    const deps = new Map([
      ["TASK-002", { blockedBy: ["TASK-001"], blocks: ["TASK-003"] }],
      ["TASK-003", { blockedBy: ["TASK-002"], blocks: [] }],
      ["TASK-001", { blockedBy: [], blocks: ["TASK-002"] }],
    ]);

    expect(sortTasksByDependencyOrder(tasks, deps).map((item) => item.id)).toEqual([
      "TASK-001",
      "TASK-002",
      "TASK-003",
    ]);
  });

  it("falls back to priority and natural id order for independent tasks", () => {
    const tasks = [task("TASK-010", 2), task("TASK-002", 1), task("TASK-001", 1)];

    expect(sortTasksByDependencyOrder(tasks, []).map((item) => item.id)).toEqual([
      "TASK-001",
      "TASK-002",
      "TASK-010",
    ]);
  });

  it("keeps decision-created tasks in plan order before priority", () => {
    const tasks = [
      { ...task("TASK-008", 1), metadata: { decision_id: "decision-1", decision_plan_order: 1 } },
      { ...task("TASK-007", 2), metadata: { decision_id: "decision-1", decision_plan_order: 0 } },
    ];

    expect(sortTasksByDependencyOrder(tasks, []).map((item) => item.id)).toEqual([
      "TASK-007",
      "TASK-008",
    ]);
  });

  it("sorts task-tree children by dependency and decision order", () => {
    const nodes = [
      { ...task("TASK-010", 0), label: "Test end to end", metadata: { decision_id: "decision-1" } },
      { ...task("TASK-008", 1), label: "Implement polling", metadata: { decision_id: "decision-1" } },
      { ...task("TASK-007", 2), label: "Add filtering", metadata: { decision_id: "decision-1" } },
      { ...task("TASK-009", 0), label: "Update resolve", metadata: { decision_id: "decision-1" } },
    ];
    const deps = [
      { from: "TASK-007", to: "TASK-009" },
      { from: "TASK-008", to: "TASK-009" },
      { from: "TASK-009", to: "TASK-010" },
    ];

    expect(sortTaskTreeNodes(nodes, deps).map((item) => item.id)).toEqual([
      "TASK-007",
      "TASK-008",
      "TASK-009",
      "TASK-010",
    ]);
  });
});

describe("sortTasksByOperationalOrder", () => {
  const item = (id: string) => ({ id });
  const state = (
    reason: string,
    extra: Partial<OperationalOrderState> = {}
  ): OperationalOrderState => ({ reason, ...extra });

  it("orders running, then queue position, then blockers by downstream impact", () => {
    const tasks = [
      item("TASK-001"), // no state — base order
      item("TASK-002"), // blocked_error, blocks 2
      item("TASK-003"), // running
      item("TASK-004"), // next #2
      item("TASK-005"), // next #1
      item("TASK-006"), // blocked_error, blocks 25
      item("TASK-007"), // waiting on deps
      item("TASK-008"), // closed
    ];
    const opStates = new Map<string, OperationalOrderState>([
      ["TASK-002", state("blocked_error", { blockedDownstreamTaskIds: ["a", "b"] })],
      ["TASK-003", state("running")],
      ["TASK-004", state("ready", { expectedNextPosition: 2 })],
      ["TASK-005", state("ready", { expectedNextPosition: 1 })],
      ["TASK-006", state("blocked_error", { blockedDownstreamTaskIds: Array.from({ length: 25 }, (_, i) => `t${i}`) })],
      ["TASK-007", state("blocked_dependency")],
      ["TASK-008", state("closed")],
    ]);

    expect(sortTasksByOperationalOrder(tasks, opStates).map((t) => t.id)).toEqual([
      "TASK-003", // running first
      "TASK-005", // next #1
      "TASK-004", // next #2
      "TASK-006", // biggest blocker first
      "TASK-002",
      "TASK-001", // no state keeps base order
      "TASK-007", // waiting keeps base order
      "TASK-008", // closed last
    ]);
  });

  it("ranks in-flight pipeline work between running and the queue", () => {
    expect(operationalRank(state("running"))).toBeLessThan(
      operationalRank(state("awaiting_generation"))
    );
    expect(operationalRank(state("awaiting_generation"))).toBeLessThan(
      operationalRank(state("ready", { expectedNextPosition: 1 }))
    );
    expect(operationalRank(state("waiting_human_decision"))).toBe(
      operationalRank(state("stale_run_scope"))
    );
    expect(operationalRank(state("paused_manual"))).toBeGreaterThan(
      operationalRank(state("blocked_error"))
    );
  });

  it("is stable and a no-op without op states", () => {
    const tasks = [item("TASK-030"), item("TASK-031"), item("TASK-032")];
    expect(sortTasksByOperationalOrder(tasks, undefined).map((t) => t.id)).toEqual([
      "TASK-030",
      "TASK-031",
      "TASK-032",
    ]);
    expect(sortTasksByOperationalOrder(tasks, new Map()).map((t) => t.id)).toEqual([
      "TASK-030",
      "TASK-031",
      "TASK-032",
    ]);
  });
});
