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
jest.mock("@/lib/tasks/task-store", () => ({
  taskCreate: (...args: unknown[]) => mockTaskCreate(...args),
  taskAddDep: (...args: unknown[]) => mockTaskAddDep(...args),
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
    mockUpdateDecision.mockImplementation(async (_ns, _org, _id, updates) => ({
      ...makeDecision(),
      ...updates,
    }));
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
});
