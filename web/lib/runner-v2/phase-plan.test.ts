import { planCompletionPhases } from "@/lib/runner-v2/phase-plan";

describe("runner-v2 completion phase plan", () => {
  it("plans event-artifact handling before stopping when quality gate fails", () => {
    const plan = planCompletionPhases({
      quality: {
        agent: { id: "qa-reviewer" },
        summary: { status: "failed" },
      },
      generation: {
        jobId: "job-1",
        generationKind: "chain",
        importablePayload: true,
      },
      route: { action: "launch", agentIds: ["next"], reason: "trigger match" },
    });

    expect(plan.terminal).toBe(true);
    expect(plan.steps.map((step) => step.type)).toEqual(["quality-gate", "event-artifact"]);
  });

  it("runs generation import after quality gates and before routing", () => {
    const plan = planCompletionPhases({
      quality: {
        agent: { id: "writer" },
        summary: { status: "complete" },
      },
      generation: {
        jobId: "job-1",
        generationKind: "chain",
        importablePayload: true,
      },
      route: { action: "launch", agentIds: ["next"], reason: "trigger match" },
    });

    expect(plan.terminal).toBe(false);
    expect(plan.steps.map((step) => step.type)).toEqual([
      "quality-gate",
      "generation-import",
      "route",
    ]);
  });

  it("fails before routing when generation import has no payload", () => {
    const plan = planCompletionPhases({
      quality: {
        agent: { id: "writer" },
        summary: { status: "complete" },
      },
      generation: {
        jobId: "job-1",
        generationKind: "chain",
        importablePayload: false,
      },
      route: { action: "launch", agentIds: ["next"], reason: "trigger match" },
    });

    expect(plan.terminal).toBe(true);
    expect(plan.steps).toEqual([
      { type: "quality-gate", result: { passed: true } },
      {
        type: "generation-failed",
        jobId: "job-1",
        generationKind: "chain",
        reason: "generation import failed for job job-1 (chain)",
      },
    ]);
  });

  it("plans terminal completion side effects for explicit stop routes", () => {
    const plan = planCompletionPhases({
      quality: {
        agent: { id: "writer" },
        summary: { status: "complete" },
      },
      route: { action: "stop", reason: "explicit stop branch" },
      terminal: {
        runId: "run-1",
        chainName: "Build Chain",
        taskId: "task-1",
        lastEvent: "done",
        lastAgentId: "writer",
        sessions: ["writer-run-1"],
        onComplete: "stop",
      },
    });

    expect(plan.terminal).toBe(true);
    expect(plan.steps.map((step) => step.type)).toEqual([
      "quality-gate",
      "route",
      "terminal-completion",
    ]);
    expect(plan.steps[2]).toMatchObject({
      type: "terminal-completion",
      plan: {
        reason: "explicit-stop",
        steps: expect.arrayContaining([
          { type: "run-status", status: "completed" },
          { type: "task-status", status: "completed", taskId: "task-1", runId: "run-1" },
          { type: "session-policy", policy: "stop", sessions: ["writer-run-1"] },
        ]),
      },
    });
  });
});
