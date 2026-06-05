import type { Decision } from "../decisions/decision-types";

const getDecision = jest.fn();
const updateDecision = jest.fn();

jest.mock("../decisions/decision-storage", () => ({
  getDecision: (...args: unknown[]) => getDecision(...args),
  updateDecision: (...args: unknown[]) => updateDecision(...args),
}));

const baseDecision: Decision = {
  id: "decision-1",
  status: "researching",
  prompt: "choose a thing",
  title: "choose a thing",
  createdAt: "2026-05-26T00:00:00.000Z",
  updatedAt: "2026-05-26T00:00:00.000Z",
  options: [],
  guidedFlow: {
    currentRound: 0,
    round1: { status: "pending", questions: [], answers: [] },
    round2: { status: "pending", tailoredOptions: [] },
    round3: { status: "pending" },
  },
};

describe("applyDecisionRunResult", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getDecision.mockReturnValue(baseDecision);
    updateDecision.mockImplementation(async (_ns, _org, _id, updates) => ({
      ...baseDecision,
      ...updates,
    }));
  });

  test("applies research output and links the generating run", async () => {
    const { applyDecisionRunResult } = await import("../decisions/decision-run-results");

    await applyDecisionRunResult({
      namespaceId: "default",
      orgId: "default",
      decisionId: "decision-1",
      phase: "research",
      runId: "run-101",
      result: {
        title: "Better title",
        priority: "p1",
        category: "architecture",
        brief: { headline: "headline" },
        context: { problem: "problem" },
      },
    });

    expect(updateDecision).toHaveBeenCalledWith(
      "default",
      "default",
      "decision-1",
      expect.objectContaining({
        status: "briefed",
        title: "Better title",
        researchRunId: "run-101",
        activeJobId: undefined,
      }),
      undefined,
    );
  });

  test("applies guided plan output and links round 3 to the run", async () => {
    const { applyDecisionRunResult } = await import("../decisions/decision-run-results");

    await applyDecisionRunResult({
      namespaceId: "default",
      orgId: "default",
      decisionId: "decision-1",
      phase: "plan",
      runId: "run-303",
      selectedOptionId: "opt-a",
      result: {
        summary: "do it",
        tasks: [{ id: "task-1", title: "Test", description: "Test it", subtasks: [], priority: 2, phase: 1 }],
        dependencies: [],
      },
    });

    expect(updateDecision).toHaveBeenCalledWith(
      "default",
      "default",
      "decision-1",
      expect.objectContaining({
        guidedFlow: expect.objectContaining({
          currentRound: 3,
          round2: expect.objectContaining({ selectedOptionId: "opt-a" }),
          round3: expect.objectContaining({
            status: "ready",
            generationRunId: "run-303",
            generationJobId: undefined,
            plan: expect.objectContaining({ summary: "do it" }),
          }),
        }),
      }),
      undefined,
    );
  });

  test("applies guided questions output and links round 1 to the run", async () => {
    const { applyDecisionRunResult } = await import("../decisions/decision-run-results");

    await applyDecisionRunResult({
      namespaceId: "default",
      orgId: "default",
      decisionId: "decision-1",
      phase: "questions",
      runId: "run-201",
      result: {
        questions: [
          {
            id: "q1",
            text: "Speed or depth?",
            category: "speed",
            weight: 1,
            optionA: { label: "speed", value: "move fast" },
            optionB: { label: "depth", value: "research deeply" },
          },
        ],
      },
    });

    expect(updateDecision).toHaveBeenCalledWith(
      "default",
      "default",
      "decision-1",
      expect.objectContaining({
        mode: "guided",
        guidedFlow: expect.objectContaining({
          currentRound: 1,
          round1: expect.objectContaining({
            status: "in_progress",
            generationRunId: "run-201",
            generationJobId: undefined,
            questions: expect.arrayContaining([expect.objectContaining({ id: "q1" })]),
          }),
        }),
      }),
      undefined,
    );
  });

  test("applies guided options output and links round 2 to the run", async () => {
    const { applyDecisionRunResult } = await import("../decisions/decision-run-results");

    await applyDecisionRunResult({
      namespaceId: "default",
      orgId: "default",
      decisionId: "decision-1",
      phase: "options",
      runId: "run-202",
      result: {
        options: [
          {
            id: "opt-a",
            letter: "A",
            name: "Do it",
            description: "Implement the thing",
            matchScore: 90,
            pros: ["clear"],
            cons: ["work"],
            effort: "low",
            risk: "low",
          },
        ],
        recommendation: { choiceId: "opt-a", rationale: "best", confidence: "high" },
      },
    });

    expect(updateDecision).toHaveBeenCalledWith(
      "default",
      "default",
      "decision-1",
      expect.objectContaining({
        recommendation: expect.objectContaining({ choiceId: "opt-a" }),
        options: [expect.objectContaining({ id: "opt-a", letter: "A" })],
        guidedFlow: expect.objectContaining({
          currentRound: 2,
          round2: expect.objectContaining({
            status: "ready",
            generationRunId: "run-202",
            generationJobId: undefined,
            tailoredOptions: [expect.objectContaining({ id: "opt-a" })],
          }),
        }),
      }),
      undefined,
    );
  });
});
