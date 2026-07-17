import type { Decision } from "@/lib/decisions/decision-types";
import type { TaskRecord } from "@/lib/tasks/task-store-types";
import { recoverLegacyDecisionPlanTask } from "./legacy-decision-plan-recovery";

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "TASK-001",
    org_id: "default",
    workspace_id: "/workspace",
    title: "Implement the change",
    description: "Implement it",
    status: "open",
    priority: 1,
    issue_type: "task",
    owner: "",
    assignee: null,
    parent_id: null,
    labels: [],
    metadata: {
      decision_id: "DEC-1",
      decision_plan_task_id: "implement",
      decision_selected_option_id: "opt-a",
      decision_plan_contract: "legacy_unverifiable",
      auto_run_paused: true,
      auto_run_paused_reason: "old pause",
    },
    acceptance_criteria: null,
    design: null,
    notes: null,
    estimated_minutes: null,
    due_at: null,
    created_at: "2026-07-16T00:00:00.000Z",
    created_by: "",
    updated_at: "2026-07-16T00:00:00.000Z",
    closed_at: null,
    ...overrides,
  };
}

function decision(planTask: Record<string, unknown>): Decision {
  return {
    id: "DEC-1",
    status: "approved",
    prompt: "Ship the change",
    options: [],
    workspacePath: "/workspace",
    resolution: { selectedOptionId: "opt-a", selectedBy: "user", selectedAt: "2026-07-16T00:00:00.000Z" },
    guidedFlow: {
      currentRound: 3,
      round1: { status: "complete", questions: [], answers: [] },
      round2: { status: "complete", tailoredOptions: [], selectedOptionId: "opt-a" },
      round3: { status: "ready", plan: { summary: "Ship it", tasks: [planTask as never], dependencies: [] } },
    },
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
  };
}

const verifiablePlanTask = {
  id: "implement",
  title: "Implement the change",
  description: "Change the owner and prove it.",
  subtasks: [],
  priority: 1,
  phase: 1,
  deliverable: "The changed module and a regression test",
  verification: "Run the focused regression and expect exit code 0",
  acceptance_criteria: "The focused regression passes.",
};

describe("legacy decision plan recovery", () => {
  it("repairs only from a matching, authoritative verifiable plan task", () => {
    const result = recoverLegacyDecisionPlanTask(task(), decision(verifiablePlanTask));

    expect(result).toMatchObject({
      action: "repaired",
      acceptanceCriteria: expect.stringContaining("The focused regression passes."),
      metadata: expect.objectContaining({
        decision_plan_contract: "v1",
        decision_plan_deliverable: "The changed module and a regression test",
        decision_plan_verification: "Run the focused regression and expect exit code 0",
      }),
    });
    expect(result.metadata).not.toHaveProperty("auto_run_paused");
    expect(result.metadata).not.toHaveProperty("auto_run_paused_reason");
  });

  it("does not invent a contract from a legacy activity-only plan", () => {
    const result = recoverLegacyDecisionPlanTask(task(), decision({ ...verifiablePlanTask, deliverable: undefined }));

    expect(result).toMatchObject({ action: "blocked" });
    expect(result.reason).toContain("Regenerate the decision plan before execution");
  });

  it("recognizes the older pause-reason-only quarantine marker", () => {
    const legacyTask = task({ metadata: {
      decision_id: "DEC-1",
      decision_plan_task_id: "implement",
      decision_selected_option_id: "opt-a",
      auto_run_paused_reason: "Legacy decision plan is missing the required deliverable, verification, and acceptance contract. Regenerate this plan before execution.",
    } });

    expect(recoverLegacyDecisionPlanTask(legacyTask, decision(verifiablePlanTask))).toMatchObject({ action: "repaired" });
  });

  it("does not copy a plan after the decision selection changed", () => {
    const result = recoverLegacyDecisionPlanTask(
      task(),
      { ...decision(verifiablePlanTask), resolution: { selectedOptionId: "opt-b", selectedBy: "user", selectedAt: "now" } },
    );

    expect(result).toEqual(expect.objectContaining({ action: "blocked", reason: expect.stringContaining("selection changed") }));
  });
});
