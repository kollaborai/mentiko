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

  it("repairs a materially renamed legacy child only with explicit v1 coverage provenance", () => {
    const legacy = task({
      id: "TASK-legacy-db-delete",
      title: "Delete the old database",
      description: "Remove the deprecated production database.",
      metadata: {
        decision_id: "DEC-1",
        decision_plan_task_id: "delete-db",
        decision_selected_option_id: "opt-a",
        decision_plan_contract: "regeneration_required",
        decision_plan_regeneration_run_id: "run-regenerated",
      },
    });
    const replacement = {
      ...verifiablePlanTask,
      id: "secure-export",
      title: "Publish a verified export workflow",
      description: "Replace deletion work with a reversible export workflow.",
      legacy_task_ids: ["TASK-legacy-db-delete"],
    };
    const regenerated = decision(replacement);
    regenerated.guidedFlow!.round3.plan = {
      summary: "Use the reversible migration path.",
      tasks: [replacement as never],
      dependencies: [],
      legacy_task_reconciliation: [{
        legacy_task_id: "TASK-legacy-db-delete",
        outcome: "covered",
        plan_task_id: "secure-export",
        rationale: "The selected option replaces irreversible deletion with a verified export workflow.",
      }],
    };

    const result = recoverLegacyDecisionPlanTask(legacy, regenerated);

    expect(result).toMatchObject({
      action: "repaired",
      metadata: {
        decision_plan_contract: "v1",
        decision_plan_reconciliation: expect.objectContaining({
          outcome: "covered",
          plan_task_id: "secure-export",
        }),
      },
    });
  });

  it("does not close a regenerated legacy child without explicit coverage or supersession", () => {
    const legacy = task({ metadata: {
      decision_id: "DEC-1",
      decision_plan_task_id: "delete-db",
      decision_selected_option_id: "opt-a",
      decision_plan_contract: "regeneration_required",
      decision_plan_regeneration_run_id: "run-regenerated",
    } });

    const result = recoverLegacyDecisionPlanTask(legacy, decision({ ...verifiablePlanTask, id: "different-work" }));

    expect(result).toEqual(expect.objectContaining({
      action: "blocked",
      reason: expect.stringContaining("no explicit coverage or supersession"),
    }));
  });

  it("closes only a legacy child with an explicit supersession rationale", () => {
    const legacy = task({ metadata: {
      decision_id: "DEC-1",
      decision_plan_task_id: "delete-db",
      decision_selected_option_id: "opt-a",
      decision_plan_contract: "regeneration_required",
      decision_plan_regeneration_run_id: "run-regenerated",
    } });
    const regenerated = decision({ ...verifiablePlanTask, id: "different-work" });
    regenerated.guidedFlow!.round3.plan = {
      summary: "No deletion work remains.",
      tasks: [{ ...verifiablePlanTask, id: "different-work" } as never],
      dependencies: [],
      legacy_task_reconciliation: [{
        legacy_task_id: "TASK-001",
        outcome: "superseded",
        rationale: "The selected option retains the existing database, so deletion is no longer authorized work.",
      }],
    };

    const result = recoverLegacyDecisionPlanTask(legacy, regenerated);

    expect(result).toMatchObject({
      action: "superseded",
      status: "closed",
      metadata: {
        decision_plan_contract: "superseded",
        decision_plan_supersession: expect.objectContaining({ outcome: "superseded" }),
      },
    });
  });
});
