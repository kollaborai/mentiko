import { validateGeneratedChainDeliveryContract } from "@/lib/chains/generated-chain-delivery-contract";
import { withRequiredChainGenerationRules } from "./chain-generation-required-rules";

describe("withRequiredChainGenerationRules", () => {
  it("appends both required markers to a template that has neither", () => {
    const result = withRequiredChainGenerationRules("Design a chain for the request.");
    expect(result).toContain("DYNAMIC_PORT_RUNTIME_PROOF");
    expect(result).toContain("DELIVERY_CONTRACT_EDIT_AUTHORITY");
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

  it("documents both authorities shapes the validator accepts (array and authorities.can)", () => {
    const result = withRequiredChainGenerationRules("Design a chain for the request.");
    expect(result).toContain('"authorities": ["edit_files"');
    expect(result).toContain("authorities.can");
  });
});
