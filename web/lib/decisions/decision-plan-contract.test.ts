import { validateExecutionPlan } from "./decision-plan-contract";

const validPlan = {
  summary: "Ship one focused change with proof.",
  tasks: [{
    id: "implement",
    title: "Implement the focused change",
    description: "Change the owning code path and preserve the existing behavior around it.",
    subtasks: ["Write the focused regression"],
    deliverable: "The changed TypeScript module and its regression test",
    verification: "Run npx jest lib/decisions/decision-plan-contract.test.ts --runInBand and expect exit code 0",
    acceptance_criteria: "The regression fails before the change and passes after it.",
    priority: 1,
    phase: 1,
  }],
  dependencies: [],
};

describe("decision execution-plan contract", () => {
  it("accepts a task only when its deliverable and repeatable verification are explicit", () => {
    const result = validateExecutionPlan(validPlan);

    expect(result).toMatchObject({ valid: true });
    if (!result.valid) throw new Error(result.error);
    expect(result.plan.tasks[0]).toMatchObject({
      deliverable: "The changed TypeScript module and its regression test",
      verification: expect.stringContaining("npx jest"),
      acceptance_criteria: expect.stringContaining("The regression fails"),
    });
  });

  it("rejects legacy plans that only describe activity", () => {
    const result = validateExecutionPlan({
      ...validPlan,
      tasks: [{ ...validPlan.tasks[0], deliverable: undefined }],
    });

    expect(result).toEqual({
      valid: false,
      error: "Decision plan task 1 (implement) requires a concrete deliverable",
    });
  });

  it("adds the deliverable and verification to a concise acceptance criterion", () => {
    const result = validateExecutionPlan({
      ...validPlan,
      tasks: [{
        ...validPlan.tasks[0],
        acceptance_criteria: "The focused regression passes.",
      }],
    });

    if (!result.valid) throw new Error(result.error);
    expect(result.plan.tasks[0].acceptance_criteria).toBe([
      "The focused regression passes.",
      "Deliverable: The changed TypeScript module and its regression test",
      "Verification: Run npx jest lib/decisions/decision-plan-contract.test.ts --runInBand and expect exit code 0",
    ].join("\n"));
  });

  it("requires covered legacy work to be named by the v1 task instead of inferring equivalence", () => {
    const result = validateExecutionPlan({
      ...validPlan,
      tasks: [{ ...validPlan.tasks[0], legacy_task_ids: ["TASK-legacy-db-delete"] }],
      legacy_task_reconciliation: [{
        legacy_task_id: "TASK-legacy-db-delete",
        outcome: "covered",
        plan_task_id: "implement",
        rationale: "The v1 implementation task explicitly preserves the legacy database deletion obligation.",
      }],
    });

    expect(result).toMatchObject({ valid: true });
  });

  it("rejects a claimed legacy coverage when the replacement task does not explicitly name it", () => {
    const result = validateExecutionPlan({
      ...validPlan,
      legacy_task_reconciliation: [{
        legacy_task_id: "TASK-legacy-db-delete",
        outcome: "covered",
        plan_task_id: "implement",
        rationale: "These tasks sound similar.",
      }],
    });

    expect(result).toEqual({
      valid: false,
      error: "Decision plan legacy_task_reconciliation 1 covered plan task must explicitly include TASK-legacy-db-delete in legacy_task_ids",
    });
  });
});
