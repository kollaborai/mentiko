import {
  buildDecisionPromptFromTaskPrompt,
  shouldRouteTaskPromptToDecision,
} from "../tasks/task-decision-routing";

describe("task decision routing", () => {
  it("routes broad product/project prompts to decisions", () => {
    expect(
      shouldRouteTaskPromptToDecision(
        "create a better git integration in the UI",
      ),
    ).toBe(true);
  });

  it("keeps narrow implementation prompts in task generation", () => {
    expect(
      shouldRouteTaskPromptToDecision(
        "fix the typo in the task header button",
      ),
    ).toBe(false);
  });

  it("builds a decision prompt that preserves the original request", () => {
    const prompt = buildDecisionPromptFromTaskPrompt(
      "create a better git integration in the UI",
    );

    expect(prompt).toContain("Decide the implementation approach");
    expect(prompt).toContain("create a better git integration in the UI");
    expect(prompt).toContain("Generate Task");
  });
});
