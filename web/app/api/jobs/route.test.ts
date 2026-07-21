/**
 * @jest-environment node
 */

import { withRequiredChainGenerationRules } from "@/lib/generation/chain-generation-required-rules";

describe("withRequiredChainGenerationRules", () => {
  it("adds dynamic runtime proof rules to stale chain-generation templates", () => {
    const wrapped = withRequiredChainGenerationRules("Create a chain for {{USER_PROMPT}}.");

    expect(wrapped).toContain("DYNAMIC_PORT_RUNTIME_PROOF");
    expect(wrapped).toContain("Never assume port 3000");
    expect(wrapped).toContain("stop only the PID you started");
  });

  it("does not duplicate the runtime proof rule, but still adds any other missing required rule", () => {
    const template = "DYNAMIC_PORT_RUNTIME_PROOF already present";

    const wrapped = withRequiredChainGenerationRules(template);
    expect(wrapped.split("DYNAMIC_PORT_RUNTIME_PROOF").length - 1).toBe(1);
    // this template predates the delivery-authority rule, so it must still
    // be appended (a stored/stale template shadowing the default must not
    // silently skip a rule it never had, just because it has an unrelated one)
    expect(wrapped).toContain("DELIVERY_CONTRACT_EDIT_AUTHORITY");
  });

  it("adds the delivery-authority rule to stale chain-generation templates", () => {
    const wrapped = withRequiredChainGenerationRules("Create a chain for {{USER_PROMPT}}.");

    expect(wrapped).toContain("DELIVERY_CONTRACT_EDIT_AUTHORITY");
    expect(wrapped).toContain("delivery generated chains require an agent with edit_files authority");
  });

  it("is a true no-op once both required rules are already present", () => {
    const template = withRequiredChainGenerationRules("Create a chain for {{USER_PROMPT}}.");

    expect(withRequiredChainGenerationRules(template)).toBe(template);
  });
});
