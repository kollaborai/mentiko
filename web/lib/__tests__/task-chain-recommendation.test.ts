import {
  buildGenerationPromptFromTaskRecommendation,
  normalizeTaskChainRecommendation,
} from "@/lib/tasks/task-chain-recommendation";
import {
  GENERATED_CHAIN_CONTRACT_SHAPE,
  GeneratedChainContractError,
} from "@/lib/chains/generated-chain-delivery-contract";

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

  it("preserves reusable work-mode guidance from the recommender", () => {
    expect(normalizeTaskChainRecommendation({
      action: "generate_new",
      suggested_name: "task-state-operation",
      work_mode: "operations",
      reuse_scope: "Mentiko task-state mutations",
      runtime_inputs: ["target task ID", "requested postcondition"],
    })).toMatchObject({
      work_mode: "operations",
      reuse_scope: "Mentiko task-state mutations",
      runtime_inputs: ["target task ID", "requested postcondition"],
    });
  });

  describe("work-mode and reuse requirements", () => {
    const recommendation = normalizeTaskChainRecommendation({
      chain_id: null,
      rationale: "No existing chain handles this.",
    });

    it.each(["feature", "task", "bug"])("does not infer capability from broad issue_type=%s", (issue_type) => {
      const prompt = buildGenerationPromptFromTaskRecommendation(
        { title: "Create AI summary API endpoint", issue_type, acceptance_criteria: "Endpoint returns a summary within 5s" },
        recommendation
      );

      expect(prompt).toContain("classify from the acceptance criteria, not from the broad issue_type label");
      expect(prompt).toContain("REUSABILITY REQUIREMENT");
      expect(prompt).toContain("ACCEPTANCE CRITERIA TO SATISFY");
    });

    it("includes the same explicit classification rule for epic/chore/decision issue types", () => {
      const prompt = buildGenerationPromptFromTaskRecommendation(
        { title: "Plan the migration", issue_type: "epic" },
        recommendation
      );

      expect(prompt).toContain("delivery for workspace file/code changes");
    });

    it("does not need issue_type to classify the end state", () => {
      const prompt = buildGenerationPromptFromTaskRecommendation({ title: "Run smoke tests" }, recommendation);

      expect(prompt).toContain("operations for command/API/MCP state mutations");
    });

    it("generalizes a recommender-provided design brief instead of treating literals as chain constants", () => {
      const withPrompt = normalizeTaskChainRecommendation({
        action: "generate_new",
        generation_prompt: "Build a chain to add branch management to the git panel.",
        reasoning: "No existing chain covers this.",
      });

      const prompt = buildGenerationPromptFromTaskRecommendation(
        { title: "Add branch management", issue_type: "feature" },
        withPrompt
      );

      expect(prompt).toContain("Build a chain to add branch management to the git panel.");
      expect(prompt).toContain("generalize this instance into a reusable chain");
      expect(prompt).toContain("do not copy literal task IDs");
    });

    it("requires operational authority without inventing a file edit for task-state mutation", () => {
      const operationsRecommendation = {
        ...recommendation!,
        work_mode: "operations" as const,
        reuse_scope: "Any Mentiko task dependency removal",
        runtime_inputs: ["target task ID", "dependency task ID"],
      };
      const prompt = buildGenerationPromptFromTaskRecommendation(
        { title: "Remove a dependency", issue_type: "task", acceptance_criteria: "The dependency is absent" },
        operationsRecommendation,
      );

      expect(prompt).toContain('mode "operations"');
      expect(prompt).toContain("declare run_commands");
      expect(prompt).toContain("do not add a fake edit_files step");
      expect(prompt).toContain("target task ID, dependency task ID");
    });
  });

  // Regression: TASK-203 (2026-07-23) -- this builder's contract line said "and
  // a reusable acceptance assertion derived from the runtime task criteria".
  // Sitting 2.8% into an 85KB prompt it out-shouted the literal spec 60KB
  // deeper, and the model emitted `reusable_acceptance_assertion` as the key.
  // Six generation attempts died alternating between that and edit_files.
  describe("contract instruction names literal keys, never prose", () => {
    const recommendation = normalizeTaskChainRecommendation({
      chain_id: null,
      rationale: "No existing chain handles this.",
      work_mode: "delivery",
    });

    it("states the exact contract shape the validator enforces", () => {
      const prompt = buildGenerationPromptFromTaskRecommendation(
        { title: "Back up the acceptance criteria", issue_type: "task", acceptance_criteria: "a backup file exists" },
        recommendation,
      );

      expect(prompt).toContain(GENERATED_CHAIN_CONTRACT_SHAPE);
      expect(prompt).toContain("acceptance_criteria");
    });

    it("never paraphrases the key as an 'acceptance assertion'", () => {
      const prompt = buildGenerationPromptFromTaskRecommendation(
        { title: "Back up the acceptance criteria", issue_type: "task", acceptance_criteria: "a backup file exists" },
        recommendation,
      );

      expect(prompt).not.toContain("acceptance assertion");
      expect(prompt).not.toContain("acceptance_assertion");
    });

    it("keeps naming the key when there is no recommender brief", () => {
      const prompt = buildGenerationPromptFromTaskRecommendation(
        { title: "Back up the acceptance criteria", issue_type: "task", acceptance_criteria: "a backup file exists" },
        null,
      );

      expect(prompt).toContain(GENERATED_CHAIN_CONTRACT_SHAPE);
      expect(prompt).not.toContain("acceptance assertion");
    });
  });

  // Regression: CHOR-001 (2026-07-20) -- a generated chain was rejected by
  // the delivery contract validator (missing edit_files agent) and the job
  // died with an uncaught 500, with no regeneration attempt. The bounded
  // auto-run retry (app/api/tasks/auto-run/route.ts) now re-invokes this
  // builder with the validator's exact rejection so the retry is a GUIDED
  // one, not a blind repeat of the same prompt.
  describe("prior-attempt corrective guidance", () => {
    const recommendation = normalizeTaskChainRecommendation({
      chain_id: null,
      rationale: "No existing chain handles this.",
    });

    it("appends the prior rejection verbatim as guidance for a bounded retry", () => {
      const priorError = "generated chain delivery contract invalid: delivery generated chains require an agent with edit_files authority";
      const prompt = buildGenerationPromptFromTaskRecommendation(
        { title: "Close TASK-001 with completion notes", issue_type: "task" },
        recommendation,
        priorError,
      );

      expect(prompt).toContain("PRIOR ATTEMPT REJECTED");
      expect(prompt).toContain(priorError);
    });

    it("also guides research-mode (non-deliverable) retries", () => {
      const priorError = "generated chain delivery contract invalid: the last generated-chain agent must declare final_verifier: true";
      const prompt = buildGenerationPromptFromTaskRecommendation(
        { title: "Research the migration options", issue_type: "epic" },
        recommendation,
        priorError,
      );

      expect(prompt).toContain("PRIOR ATTEMPT REJECTED");
      expect(prompt).toContain(priorError);
    });

    // Regression: TASK-203 (2026-07-23). This is the actual end-to-end mechanism
    // of the oscillation. GeneratedChainContractError joins violations with "; "
    // and that whole string lands in metadata.generation_last_error, then here as
    // priorError. When the validator could only ever report one violation, the
    // retry only ever learned about one -- it fixed that and regressed the other,
    // six times. A multi-violation rejection has to survive into the prompt
    // intact, or reporting them together buys nothing.
    it("carries every violation of a multi-error rejection into the retry prompt", () => {
      const priorError = new GeneratedChainContractError([
        "metadata.generated_chain_contract.acceptance_criteria must be a non-empty string -- that exact key, not acceptance_assertion or reusable_acceptance_assertion",
        "delivery generated chains require an agent with edit_files authority",
      ]).message;

      const prompt = buildGenerationPromptFromTaskRecommendation(
        { title: "Back up the acceptance criteria", issue_type: "task", acceptance_criteria: "a backup file exists" },
        recommendation,
        priorError,
      );

      expect(prompt).toContain("PRIOR ATTEMPT REJECTED");
      // both halves of the "; "-joined message, not just the first
      expect(prompt).toContain("metadata.generated_chain_contract.acceptance_criteria");
      expect(prompt).toContain("delivery generated chains require an agent with edit_files authority");
      expect(prompt).toContain(priorError);
    });

    it("omits the guidance block entirely on a first attempt (no prior error)", () => {
      const prompt = buildGenerationPromptFromTaskRecommendation(
        { title: "Close TASK-001 with completion notes", issue_type: "task" },
        recommendation,
      );

      expect(prompt).not.toContain("PRIOR ATTEMPT REJECTED");
    });
  });
});
