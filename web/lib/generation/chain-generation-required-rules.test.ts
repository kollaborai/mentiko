import {
  GENERATED_CHAIN_CONTRACT_SHAPE,
  validateGeneratedChainDeliveryContract,
} from "@/lib/chains/generated-chain-delivery-contract";
import {
  TASK_LINKED_CHAIN_RUNTIME_RULE,
  withRequiredChainGenerationRules,
  withRequiredChainRecommendationRules,
} from "./chain-generation-required-rules";

describe("withRequiredChainGenerationRules", () => {
  it("appends every required marker to a template that has none", () => {
    const result = withRequiredChainGenerationRules("Design a chain for the request.");
    expect(result).toContain("DYNAMIC_PORT_RUNTIME_PROOF");
    expect(result).toContain("DELIVERY_CONTRACT_EDIT_AUTHORITY");
    expect(result).toContain("TASK_LINKED_CHAIN_RUNTIME");
  });

  // Regression: CHOR-001 (2026-07-20) -- the generator wrote a delivery-mode
  // chain with only run_commands/read_files agents and the job died with an
  // uncaught 500 on the validator's rejection. The delivery-authority rule
  // must state the requirement in the validator's own words so this class of
  // failure is called out explicitly, not just implied by other prose.
  it("states the requirement in the exact words the validator rejects with", () => {
    const result = withRequiredChainGenerationRules("Design a chain for the request.");
    const rejectionErrors = validateGeneratedChainDeliveryContract({
      metadata: {
        generated_chain_contract: {
          version: 1,
          mode: "delivery",
          acceptance_criteria: "the thing works",
        },
      },
      agents: [{
        deliverable: "a report",
        verification: "read the report",
        authorities: ["read_files"],
        final_verifier: true,
        verifies_acceptance_criteria: true,
        success_assertion: "the report exists",
      }],
    });
    expect(rejectionErrors).toContain("delivery generated chains require an agent with edit_files authority");
    expect(result).toContain("delivery generated chains require an agent with edit_files authority");
  });

  it("accepts operational state mutation without a fake file-edit agent", () => {
    const result = withRequiredChainGenerationRules("Design a chain for the request.");
    const errors = validateGeneratedChainDeliveryContract({
      metadata: {
        generated_chain_contract: {
          version: 1,
          mode: "operations",
          acceptance_criteria: "the requested managed state is updated",
        },
      },
      agents: [{
        deliverable: "the requested state mutation",
        verification: "read the managed state back",
        authorities: ["run_commands"],
        final_verifier: true,
        verifies_acceptance_criteria: true,
        success_assertion: "the read-back matches the requested postcondition",
      }],
    });

    expect(errors).toEqual([]);
    expect(result).toContain("operations generated chains require an agent with run_commands authority");
    expect(result).toContain("Never add a fake edit_files agent");
  });

  it("rejects an operations chain that cannot mutate state", () => {
    expect(validateGeneratedChainDeliveryContract({
      metadata: {
        generated_chain_contract: {
          version: 1,
          mode: "operations",
          acceptance_criteria: "state changed",
        },
      },
      agents: [{
        deliverable: "a report",
        verification: "read it",
        authorities: ["read_files"],
        final_verifier: true,
        verifies_acceptance_criteria: true,
        success_assertion: "the report exists",
      }],
    })).toContain("operations generated chains require an agent with run_commands authority");
  });

  // Regression: TASK-203 (2026-07-23). The prompt described the contract in
  // prose ("a reusable acceptance assertion") instead of naming the key, and
  // the model emitted reusable_acceptance_assertion as the field name. Four of
  // six failed generation attempts were this one sentence.
  it("names the literal contract keys the validator requires", () => {
    const result = withRequiredChainGenerationRules("Design a chain for the request.");

    expect(result).toContain("GENERATED_CHAIN_CONTRACT_FIELDS");
    expect(result).toContain(GENERATED_CHAIN_CONTRACT_SHAPE);
    expect(result).toContain('"acceptance_criteria"');
    // The rule must warn off the exact names the model reached for.
    expect(result).toContain("reusable_acceptance_assertion");
  });

  it("states the contract-field requirement in the exact words the validator rejects with", () => {
    const result = withRequiredChainGenerationRules("Design a chain for the request.");
    const rejectionErrors = validateGeneratedChainDeliveryContract({
      metadata: {
        generated_chain_contract: {
          version: 1,
          mode: "delivery",
          acceptance_assertion: "the thing works",
        },
      },
      agents: [{
        deliverable: "a change",
        verification: "read the diff",
        authorities: ["read_files", "edit_files"],
        final_verifier: true,
        verifies_acceptance_criteria: true,
        success_assertion: "the change is present",
      }],
    });

    const rejection = rejectionErrors.find((e) => e.includes("acceptance_criteria"));
    expect(rejection).toBeDefined();
    // Every key the rejection names must be a key the prompt taught.
    expect(result).toContain("acceptance_criteria");
    expect(result).toContain("acceptance_assertion");
  });

  it("does not duplicate the contract-fields marker when already present", () => {
    const already = "Some template.\n\nGENERATED_CHAIN_CONTRACT_FIELDS already present here.";
    const result = withRequiredChainGenerationRules(already);
    expect(result.split("GENERATED_CHAIN_CONTRACT_FIELDS").length - 1).toBe(1);
    expect(result).toContain("DELIVERY_CONTRACT_EDIT_AUTHORITY");
  });

  it("does not duplicate a marker that a stored namespace template already carries", () => {
    const alreadyHasDelivery = "Some template.\n\nDELIVERY_CONTRACT_EDIT_AUTHORITY already present here.";
    const result = withRequiredChainGenerationRules(alreadyHasDelivery);
    expect(result.split("DELIVERY_CONTRACT_EDIT_AUTHORITY").length - 1).toBe(1);
    expect(result).toContain("DYNAMIC_PORT_RUNTIME_PROOF");
  });

  it("does not duplicate the runtime-proof marker when already present", () => {
    const alreadyHasProof = "Some template.\n\nDYNAMIC_PORT_RUNTIME_PROOF already present here.";
    const result = withRequiredChainGenerationRules(alreadyHasProof);
    expect(result.split("DYNAMIC_PORT_RUNTIME_PROOF").length - 1).toBe(1);
    expect(result).toContain("DELIVERY_CONTRACT_EDIT_AUTHORITY");
  });

  // Regression: TASK-007 (2026-08-09). The schema advertised version "1.0"
  // and nothing taught the branch-key vocabulary, so generation burned its
  // deterministic budget on the validator's two graph rejections. The rule
  // must state both in the validator's own words.
  it("teaches the graph vocabulary in the exact words the validator rejects with", () => {
    const result = withRequiredChainGenerationRules("Design a chain for the request.");
    expect(result).toContain("GRAPH_EVENT_VOCABULARY");
    expect(result).toContain('exactly "1.0.0"');
    expect(result).toContain("must be in semver format");
    expect(result).toContain("must match an event emitted or consumed by an agent");
    expect(result).toContain("pruned at import");
  });

  it("does not duplicate the graph-vocabulary marker when already present", () => {
    const already = "Some template.\n\nGRAPH_EVENT_VOCABULARY already present here.";
    const result = withRequiredChainGenerationRules(already);
    expect(result.split("GRAPH_EVENT_VOCABULARY").length - 1).toBe(1);
    expect(result).toContain("RUNTIME_CONTEXT_TRUTH");
  });

  it("documents both authorities shapes the validator accepts", () => {
    const result = withRequiredChainGenerationRules("Design a chain for the request.");
    expect(result).toContain("Authorities may be a string array or authorities.can");
  });

  it("teaches post-admission task state and forbids self-terminal verification", () => {
    const result = withRequiredChainGenerationRules("Design a chain for the request.");
    expect(result).toContain('status "in_progress"');
    expect(result).toContain("metadata.chain_id");
    expect(result).toContain("assignee may be null");
    expect(result).toContain("No agent inside a run may require that same run");
    expect(result).toContain("external orchestrator after the run");
  });

  it("injects the same temporal contract into stored recommendation templates", () => {
    const result = withRequiredChainRecommendationRules("Recommend a chain.");
    expect(result).toContain("TASK_LINKED_CHAIN_RUNTIME");
    expect(result).toContain("metadata.last_run_id/task_run_scope");
  });

  it("does not duplicate the task-linked runtime rule in either producer", () => {
    const already = `Recommend a chain.\n\n${TASK_LINKED_CHAIN_RUNTIME_RULE.trim()}`;
    expect(withRequiredChainRecommendationRules(already)).toBe(already);
    expect(withRequiredChainGenerationRules(already)
      .split("TASK_LINKED_CHAIN_RUNTIME").length - 1).toBe(1);
  });

  it("does not trust a marker substring in an obsolete or inverted template", () => {
    const stale = "TASK_LINKED_CHAIN_RUNTIME: require the task to stay open.";
    const result = withRequiredChainRecommendationRules(stale);
    expect(result).toContain(stale);
    expect(result).toContain(TASK_LINKED_CHAIN_RUNTIME_RULE.trim());
    expect(result.split("TASK_LINKED_CHAIN_RUNTIME").length - 1).toBe(2);
  });
});
