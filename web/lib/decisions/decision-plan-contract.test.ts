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
});
