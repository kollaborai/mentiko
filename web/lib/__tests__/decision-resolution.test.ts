/**
 * @jest-environment node
 */

const mockGetDecision = jest.fn();
const mockUpdateDecision = jest.fn();
jest.mock("@/lib/decisions/decision-storage", () => ({
  getDecision: (...args: unknown[]) => mockGetDecision(...args),
  updateDecision: (...args: unknown[]) => mockUpdateDecision(...args),
}));

const mockTaskCreate = jest.fn();
const mockTaskAddDep = jest.fn();
const mockTaskUpdate = jest.fn();
const mockTaskGet = jest.fn();
jest.mock("@/lib/tasks/task-store", () => ({
  taskCreate: (...args: unknown[]) => mockTaskCreate(...args),
  taskAddDep: (...args: unknown[]) => mockTaskAddDep(...args),
  taskUpdate: (...args: unknown[]) => mockTaskUpdate(...args),
  taskGet: (...args: unknown[]) => mockTaskGet(...args),
}));

// scan_unblocked_auto_run_tasks fires a real fetch() to localhost in prod (see
// lib/runs/auto-run-service.ts) -- mock it so tests never make a real network
// call when a parented resolution reaches applyResolutionLifecycle.
const mockTriggerAutoRunScan = jest.fn().mockResolvedValue(undefined);
jest.mock("@/lib/runs/auto-run-service", () => ({
  triggerAutoRunScan: (...args: unknown[]) => mockTriggerAutoRunScan(...args),
}));

import { resolveDecisionToTasks } from "@/lib/decisions/decision-resolution";

function makeDecision() {
  return {
    id: "decision-1",
    status: "briefed",
    prompt: "Add directory switcher",
    title: "Directory switcher",
    priority: "p1",
    createdAt: "2026-05-25T00:00:00.000Z",
    updatedAt: "2026-05-25T00:00:00.000Z",
    options: [],
    context: {
      problem: "Editor cannot browse data roots",
      currentState: "Workspace-only editor",
      whyProblem: "Users need raw runtime files",
      affectedAreas: ["code editor", "runtime data"],
      constraints: ["whitelist paths"],
      references: ["docs/code.md"],
    },
    recommendation: {
      choiceId: "opt-a",
      rationale: "Best fit",
      confidence: "high",
    },
    guidedFlow: {
      currentRound: 3,
      round1: { status: "complete", questions: [], answers: [] },
      round2: {
        status: "complete",
        selectedOptionId: "opt-a",
        tailoredOptions: [
          {
            id: "opt-a",
            letter: "A",
            name: "Header dropdown",
            description: "Add a whitelisted directory dropdown.",
            matchScore: 92,
            pros: ["fast"],
            cons: ["needs tabs reset"],
            effort: "low",
            risk: "low",
          },
        ],
      },
      round3: {
        status: "ready",
        plan: {
          summary: "Ship the dropdown in phases.",
          tasks: [
            {
              id: "plan-1",
              title: "Add directory API",
              description: "Expose whitelisted directories.",
              subtasks: ["return labels", "return paths"],
              priority: 1,
              phase: 1,
            },
            {
              id: "plan-2",
              title: "Wire editor dropdown",
              description: "Switch roots from the header.",
              subtasks: [],
              priority: 1,
              phase: 2,
            },
          ],
          dependencies: [{ from: "plan-1", to: "plan-2" }],
        },
      },
    },
  };
}

describe("resolveDecisionToTasks", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDecision.mockReturnValue(makeDecision());
    mockTaskCreate
      .mockReturnValueOnce({ id: "EPIC-001" })
      .mockReturnValueOnce({ id: "TASK-001" })
      .mockReturnValueOnce({ id: "TASK-002" });
    mockTaskGet.mockImplementation((_orgId, id) => (
      id === "EPIC-008" ? { id, workspace_id: "/repo/app" } : null
    ));
    mockUpdateDecision.mockImplementation(async (_ns, _org, _id, updates) => ({
      ...makeDecision(),
      ...updates,
    }));
  });

  it("adds approved plan tasks to the existing epic and closes the decision task", async () => {
    mockGetDecision.mockReturnValue({
      ...makeDecision(),
      taskId: "DEC-001",
      parentTaskId: "EPIC-008",
    });
    mockTaskCreate
      .mockReset()
      .mockReturnValueOnce({ id: "TASK-010" })
      .mockReturnValueOnce({ id: "TASK-011" });

    const result = await resolveDecisionToTasks({
      namespaceId: "mike",
      orgId: "default",
      decisionId: "decision-1",
      selectedOptionId: "opt-a",
      workspaceId: "/repo/app",
      workspacePath: "/repo/app",
      selectedBy: "user",
    });

    expect(mockTaskCreate).toHaveBeenCalledTimes(2);
    expect(mockTaskCreate.mock.calls[0][1]).toEqual(expect.objectContaining({
      parent_id: "EPIC-008",
      issue_type: "task",
      metadata: expect.objectContaining({
        decision_id: "decision-1",
        decision_task_id: "DEC-001",
        decision_parent_task_id: "EPIC-008",
      }),
    }));
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      "default",
      "DEC-001",
      expect.objectContaining({
        status: "closed",
        metadata: expect.objectContaining({
          decision_id: "decision-1",
          decision_status: "approved",
          decision_selected_option_id: "opt-a",
        }),
      }),
      "mike",
    );
    expect(mockUpdateDecision).toHaveBeenCalledWith(
      "mike",
      "default",
      "decision-1",
      expect.objectContaining({
        status: "approved",
        resolution: expect.objectContaining({
          selectedOptionId: "opt-a",
          taskId: "EPIC-008",
          taskIds: ["DEC-001", "TASK-010", "TASK-011"],
        }),
      }),
      "/repo/app",
    );
    expect(result.taskIds).toEqual(["DEC-001", "TASK-010", "TASK-011"]);
  });

  it("creates decision tasks in the request namespace", async () => {
    const result = await resolveDecisionToTasks({
      namespaceId: "mike",
      orgId: "default",
      decisionId: "decision-1",
      selectedOptionId: "opt-a",
      workspaceId: "/repo/app",
      workspacePath: "/repo/app",
      selectedBy: "user",
    });

    expect(mockGetDecision).toHaveBeenCalledWith(
      "mike",
      "default",
      "decision-1",
      "/repo/app",
    );
    expect(mockTaskCreate).toHaveBeenCalledTimes(3);
    for (const call of mockTaskCreate.mock.calls) {
      expect(call[0]).toBe("default");
      expect(call[2]).toBe("mike");
      expect(call[1]).toEqual(expect.objectContaining({
        workspace_id: "/repo/app",
        metadata: expect.objectContaining({ decision_id: "decision-1" }),
      }));
    }
    expect(mockTaskCreate.mock.calls[1][1]).toEqual(expect.objectContaining({
      metadata: expect.objectContaining({
        decision_plan_task_id: "plan-1",
        decision_plan_order: 0,
        decision_plan_phase: 1,
      }),
    }));
    expect(mockTaskCreate.mock.calls[2][1]).toEqual(expect.objectContaining({
      metadata: expect.objectContaining({
        decision_plan_task_id: "plan-2",
        decision_plan_order: 1,
        decision_plan_phase: 2,
      }),
    }));
    expect(mockTaskAddDep).toHaveBeenCalledWith(
      "default",
      "TASK-002",
      "TASK-001",
      "mike",
      "/repo/app",
    );
    expect(mockUpdateDecision).toHaveBeenCalledWith(
      "mike",
      "default",
      "decision-1",
      expect.objectContaining({
        status: "approved",
        resolution: expect.objectContaining({
          selectedOptionId: "opt-a",
          taskId: "EPIC-001",
          taskIds: ["EPIC-001", "TASK-001", "TASK-002"],
        }),
      }),
      "/repo/app",
    );
    expect(result.taskIds).toEqual(["EPIC-001", "TASK-001", "TASK-002"]);
  });

  it("uses the decision workspace when approval arrives without workspace context", async () => {
    mockGetDecision.mockReturnValue({
      ...makeDecision(),
      workspacePath: "/repo/marketplace",
    });

    await resolveDecisionToTasks({
      namespaceId: "mike",
      orgId: "default",
      decisionId: "decision-1",
      selectedOptionId: "opt-a",
      selectedBy: "agent",
    });

    expect(mockTaskCreate.mock.calls[0][1]).toEqual(expect.objectContaining({
      workspace_id: "/repo/marketplace",
    }));
    expect(mockUpdateDecision).toHaveBeenCalledWith(
      "mike",
      "default",
      "decision-1",
      expect.objectContaining({ status: "approved" }),
      "/repo/marketplace",
    );
  });

  it("rejects approval when the existing parent epic is gone", async () => {
    mockGetDecision.mockReturnValue({
      ...makeDecision(),
      taskId: "DEC-001",
      parentTaskId: "EPIC-404",
    });
    mockTaskGet.mockReturnValue(null);

    await expect(resolveDecisionToTasks({
      namespaceId: "mike",
      orgId: "default",
      decisionId: "decision-1",
      selectedOptionId: "opt-a",
      workspaceId: "/repo/app",
      workspacePath: "/repo/app",
      selectedBy: "user",
    })).rejects.toThrow("Decision parent task not found");

    expect(mockTaskCreate).not.toHaveBeenCalled();
    expect(mockUpdateDecision).not.toHaveBeenCalled();
  });

  it("rejects approval when the existing parent epic is in another workspace", async () => {
    mockGetDecision.mockReturnValue({
      ...makeDecision(),
      taskId: "DEC-001",
      parentTaskId: "EPIC-008",
    });
    mockTaskGet.mockReturnValue({ id: "EPIC-008", workspace_id: "/repo/other" });

    await expect(resolveDecisionToTasks({
      namespaceId: "mike",
      orgId: "default",
      decisionId: "decision-1",
      selectedOptionId: "opt-a",
      workspaceId: "/repo/app",
      workspacePath: "/repo/app",
      selectedBy: "user",
    })).rejects.toThrow("Decision parent task belongs to another workspace");

    expect(mockTaskCreate).not.toHaveBeenCalled();
    expect(mockUpdateDecision).not.toHaveBeenCalled();
  });
});
