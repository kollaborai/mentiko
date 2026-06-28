import { buildDecisionPromptFromTaskPrompt } from "../tasks/task-decision-routing";

// Note: task-vs-decision routing is now decided by the generation agent (the
// task_generation template gates it), not a static heuristic. Only the
// decision-prompt builder remains here.

describe("task decision routing", () => {
  it("builds a decision prompt that preserves the original request", () => {
    const prompt = buildDecisionPromptFromTaskPrompt(
      "create a better git integration in the UI",
    );

    expect(prompt).toContain("Decide the implementation approach");
    expect(prompt).toContain("create a better git integration in the UI");
    expect(prompt).toContain("Generate Task");
  });
});
