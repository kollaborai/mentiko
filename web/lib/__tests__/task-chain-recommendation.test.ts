import {
  buildGenerationPromptFromTaskRecommendation,
  normalizeTaskChainRecommendation,
} from "@/lib/task-chain-recommendation";

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
});
