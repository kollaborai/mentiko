/**
 * @jest-environment node
 *
 * applyDecisionRunResult is the shared write-path for every decision phase
 * import -- both the CLI-driven `mentiko decision import` and the completion
 * pipeline's own import trigger call it via the same import route. Because
 * both can legitimately fire for the same completed run (see
 * decision-auto-advance's isCompletedRunAwaitingDecisionImport self-heal and
 * completion-entrypoint's completion-driven trigger), applying the same
 * result twice must be a no-op data-wise, not a source of drift or duplicate
 * downstream side effects.
 */

const getDecision = jest.fn();
const updateDecision = jest.fn();
const taskUpdate = jest.fn();
const reconcileLegacyDecisionPlans = jest.fn();

jest.mock("@/lib/decisions/decision-storage", () => ({
  getDecision: (...args: unknown[]) => getDecision(...args),
  updateDecision: (...args: unknown[]) => updateDecision(...args),
}));
jest.mock("@/lib/tasks/task-store", () => ({
  taskUpdate: (...args: unknown[]) => taskUpdate(...args),
}));
jest.mock("@/lib/decisions/legacy-decision-plan-recovery", () => ({
  reconcileLegacyDecisionPlans: (...args: unknown[]) => reconcileLegacyDecisionPlans(...args),
}));

import { applyDecisionRunResult } from "./decision-run-results";

function plan() {
  return {
    summary: "Do the thing",
    tasks: [{
      id: "task-1",
      title: "Implement the endpoint",
      description: "Add the endpoint and its focused regression.",
      subtasks: [],
      deliverable: "The endpoint and focused regression test",
      verification: "Run npm test -- endpoint and expect exit code 0",
      acceptance_criteria: "The endpoint returns 200 and the focused test passes.",
      priority: 1,
      phase: 1,
    }],
    dependencies: [],
  };
}

describe("applyDecisionRunResult idempotence", () => {
  let storedDecision: Record<string, unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    storedDecision = {
      id: "dec-idempotent",
      status: "briefed",
      options: [],
      guidedFlow: {
        currentRound: 3,
        round1: { status: "complete", questions: [], answers: [] },
        round2: { status: "ready", tailoredOptions: [], selectedOptionId: "option-a" },
        round3: { status: "generating", generationRunId: "run-plan-1" },
      },
    };
    getDecision.mockImplementation(() => storedDecision);
    updateDecision.mockImplementation(async (_ns, _org, _id, patch) => {
      storedDecision = { ...storedDecision, ...(patch as Record<string, unknown>) };
      return storedDecision;
    });
  });

  it("applying the same plan result twice (CLI import + completion-driven import) converges to the same state", async () => {
    const result = plan();

    const first = await applyDecisionRunResult({
      namespaceId: "ns", orgId: "org", decisionId: "dec-idempotent",
      phase: "plan", result, runId: "run-plan-1", selectedOptionId: "option-a",
    });
    const second = await applyDecisionRunResult({
      namespaceId: "ns", orgId: "org", decisionId: "dec-idempotent",
      phase: "plan", result, runId: "run-plan-1", selectedOptionId: "option-a",
    });

    expect(updateDecision).toHaveBeenCalledTimes(2);
    // Same input, same fixed inputs (runId, selectedOptionId) -> the same
    // resulting guidedFlow. No field drifts between the first and replayed
    // apply, and no second plan/task is fabricated by re-applying.
    const firstFlow = (first as { guidedFlow: unknown }).guidedFlow;
    const secondFlow = (second as { guidedFlow: unknown }).guidedFlow;
    expect(secondFlow).toEqual(firstFlow);
    expect((second as { guidedFlow: { round3: { status: string; plan: { summary: string } } } })
      .guidedFlow.round3).toMatchObject({ status: "ready", plan: { summary: "Do the thing" } });
    // The legacy-plan repair runs on each apply (harmless, targeted at this one
    // decision) but never doubles up unrelated work -- called once per apply.
    expect(reconcileLegacyDecisionPlans).toHaveBeenCalledTimes(2);
  });
});
