const taskList = jest.fn();
const taskUpdate = jest.fn();
const getDecision = jest.fn();
const updateDecision = jest.fn();
const startDurableDecisionPhaseOnce = jest.fn();
const startDecisionChainRun = jest.fn();
const getTemplate = jest.fn();
const resolveTemplate = jest.fn();
const buildDecisionContext = jest.fn();
const buildPreferenceText = jest.fn();

jest.mock("@/lib/tasks/task-store", () => ({
  taskList: (...args: unknown[]) => taskList(...args),
  taskUpdate: (...args: unknown[]) => taskUpdate(...args),
}));
jest.mock("@/lib/decisions/decision-storage", () => ({
  getDecision: (...args: unknown[]) => getDecision(...args),
  updateDecision: (...args: unknown[]) => updateDecision(...args),
}));
jest.mock("@/lib/decisions/decision-auto-advance", () => ({
  startDurableDecisionPhaseOnce: (...args: unknown[]) => startDurableDecisionPhaseOnce(...args),
}));
jest.mock("@/lib/decisions/decision-chain-dispatch", () => ({
  startDecisionChainRun: (...args: unknown[]) => startDecisionChainRun(...args),
}));
jest.mock("@/lib/generation/generation-template-storage", () => ({ getTemplate: (...args: unknown[]) => getTemplate(...args) }));
jest.mock("@/lib/system/template-resolver", () => ({ resolveTemplate: (...args: unknown[]) => resolveTemplate(...args) }));
jest.mock("@/lib/decisions/decision-context", () => ({
  buildDecisionContext: (...args: unknown[]) => buildDecisionContext(...args),
  buildPreferenceText: (...args: unknown[]) => buildPreferenceText(...args),
}));

import { regenerateLegacyDecisionPlans } from "./legacy-decision-plan-regeneration";

const quarantinedTask = {
  id: "TASK-001", org_id: "default", workspace_id: "/repo", title: "Old task", description: "old", status: "open", priority: 2, issue_type: "task", owner: "", assignee: null, parent_id: null, labels: [],
  metadata: { decision_id: "DEC-1", decision_plan_task_id: "one", decision_selected_option_id: "opt-a", decision_plan_contract: "legacy_unverifiable" },
  acceptance_criteria: null, design: null, notes: null, estimated_minutes: null, due_at: null, created_at: "now", created_by: "", updated_at: "now", closed_at: null,
};

function decision() {
  return {
    id: "DEC-1", status: "approved", prompt: "Ship it", workspacePath: "/repo", options: [{ id: "opt-a", letter: "A", name: "Do it", description: "Implement", pros: ["pro"], cons: ["con"], effort: "low", risk: "low" }],
    resolution: { selectedOptionId: "opt-a", selectedBy: "user", selectedAt: "now" },
    guidedFlow: {
      currentRound: 3,
      round1: { status: "complete", questions: [], answers: [] },
      round2: { status: "complete", tailoredOptions: [], selectedOptionId: "opt-a" },
      round3: { status: "ready", plan: { summary: "old", tasks: [{ id: "one", title: "old", description: "old", subtasks: [], priority: 2, phase: 1 }], dependencies: [] } },
    },
    createdAt: "now", updatedAt: "now",
  };
}

describe("legacy decision plan regeneration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    taskList.mockReturnValue([quarantinedTask]);
    getDecision.mockReturnValue(decision());
    getTemplate.mockReturnValue({ content: "template" });
    resolveTemplate.mockReturnValue("resolved plan prompt");
    buildDecisionContext.mockReturnValue("context");
    buildPreferenceText.mockReturnValue("preferences");
  });

  it("reports stable approved legacy decisions without starting a run by default", async () => {
    const result = await regenerateLegacyDecisionPlans({ request: new Request("http://localhost"), namespaceId: "default", orgId: "default" });

    expect(result).toEqual([expect.objectContaining({ decisionId: "DEC-1", action: "eligible" })]);
    expect(startDurableDecisionPhaseOnce).not.toHaveBeenCalled();
    expect(taskUpdate).not.toHaveBeenCalled();
  });

  it("uses the durable guided-plan chain and marks only its own tasks as regenerating", async () => {
    startDurableDecisionPhaseOnce.mockImplementation(async (input) => {
      const run = await input.start();
      await input.persist(run);
      return { started: run, joined: false, recovered: false, durableRecovered: false };
    });
    startDecisionChainRun.mockResolvedValue({ runId: "run-regenerated" });
    updateDecision.mockResolvedValue(decision());

    const result = await regenerateLegacyDecisionPlans({ request: new Request("http://localhost"), namespaceId: "default", orgId: "default", apply: true });

    expect(result).toEqual([expect.objectContaining({ action: "started", runId: "run-regenerated" })]);
    expect(startDurableDecisionPhaseOnce).toHaveBeenCalledWith(expect.objectContaining({
      identity: expect.objectContaining({ decisionId: "DEC-1", phase: "plan", selectedOptionId: "opt-a" }),
    }));
    expect(taskUpdate).toHaveBeenCalledWith("default", "TASK-001", expect.objectContaining({
      metadata: expect.objectContaining({ decision_plan_contract: "regenerating", decision_plan_regeneration_run_id: "run-regenerated" }),
    }), "default");
    expect(startDecisionChainRun).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('"legacy_task_id": "TASK-001"'),
    }));
    expect(startDecisionChainRun).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('"title": "Old task"'),
    }));
  });

  it("refuses to guess when a decision does not retain a stable option", async () => {
    const unstablySelected: any = decision();
    unstablySelected.resolution = undefined;
    unstablySelected.guidedFlow.round2.selectedOptionId = undefined;
    (quarantinedTask.metadata as Record<string, unknown>).decision_selected_option_id = "opt-a";
    getDecision.mockReturnValue(unstablySelected);

    const result = await regenerateLegacyDecisionPlans({ request: new Request("http://localhost"), namespaceId: "default", orgId: "default" });

    expect(result).toEqual([expect.objectContaining({ action: "skipped", reason: expect.stringContaining("stable selected option") })]);
  });
});
