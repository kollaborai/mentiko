import {
  buildGenerationPromptFromTaskRecommendation,
  normalizeTaskChainRecommendation,
} from "@/lib/tasks/task-chain-recommendation";

describe("task chain recommendation helpers", () => {
  it("treats legacy no-match recommendation payloads as generate-new", () => {
    const normalized = normalizeTaskChainRecommendation({
      chain_id: null,
      confidence: "none",
      rationale: "No existing chain handles smoke testing plus code repair.",
      suggested_approach: "Execute directly in one session.",
    });

    expect(normalized).toMatchObject({
      action: "generate_new",
      reasoning: "No existing chain handles smoke testing plus code repair.",
      direct_instructions: "Execute directly in one session.",
    });
  });

  it("builds a chain-generation prompt when the recommender omitted one", () => {
    const recommendation = normalizeTaskChainRecommendation({
      chain_id: null,
      rationale: "No existing chain handles this.",
    });

    expect(buildGenerationPromptFromTaskRecommendation(
      { title: "Run smoke tests", description: "Run scripts and fix failures." },
      recommendation
    )).toContain("Create a Mentiko chain for this task");
  });

  it("normalizes already-satisfied recommendations as no-action-needed", () => {
    const normalized = normalizeTaskChainRecommendation({
      action: "already_satisfied",
      reasoning: "The peer review UI files and tests already exist.",
      confidence: 1,
    });

    expect(normalized).toMatchObject({
      action: "no_action_needed",
      reasoning: "The peer review UI files and tests already exist.",
      confidence: 1,
    });
  });

  // Regression: FEAT-014's chain-generation prompt never told the generator
  // this task needed a code-writing agent, so it built 4 read-only
  // analysis/design agents that produced only markdown specs. The prompt
  // builder must now append a hard delivery requirement for issue types that
  // promise working software.
  describe("delivery requirement for feature/task/bug", () => {
    const recommendation = normalizeTaskChainRecommendation({
      chain_id: null,
      rationale: "No existing chain handles this.",
    });

    it.each(["feature", "task", "bug"])("appends the DELIVERY REQUIREMENT block for issue_type=%s", (issue_type) => {
      const prompt = buildGenerationPromptFromTaskRecommendation(
        { title: "Create AI summary API endpoint", issue_type, acceptance_criteria: "Endpoint returns a summary within 5s" },
        recommendation
      );

      expect(prompt).toContain("DELIVERY REQUIREMENT");
      expect(prompt).toContain("edit_files");
      expect(prompt).toContain("ACCEPTANCE CRITERIA TO SATISFY");
    });

    it("does not append the delivery block for epic/chore/decision issue types", () => {
      const prompt = buildGenerationPromptFromTaskRecommendation(
        { title: "Plan the migration", issue_type: "epic" },
        recommendation
      );

      expect(prompt).not.toContain("DELIVERY REQUIREMENT");
    });

    it("does not append the delivery block when issue_type is omitted (back-compat)", () => {
      const prompt = buildGenerationPromptFromTaskRecommendation({ title: "Run smoke tests" }, recommendation);

      expect(prompt).not.toContain("DELIVERY REQUIREMENT");
    });

    it("appends the delivery block even when the recommender already supplied its own generation_prompt", () => {
      const withPrompt = normalizeTaskChainRecommendation({
        action: "generate_new",
        generation_prompt: "Build a chain to add branch management to the git panel.",
        reasoning: "No existing chain covers this.",
      });

      const prompt = buildGenerationPromptFromTaskRecommendation(
        { title: "Add branch management", issue_type: "feature" },
        withPrompt
      );

      // the recommender's own prompt is preserved as the base...
      expect(prompt).toContain("Build a chain to add branch management to the git panel.");
      // ...but the delivery requirement is still enforced on top of it
      expect(prompt).toContain("DELIVERY REQUIREMENT");
    });
  });
});
