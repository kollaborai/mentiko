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

  it("does not duplicate the runtime proof rule", () => {
    const template = "DYNAMIC_PORT_RUNTIME_PROOF already present";

    expect(withRequiredChainGenerationRules(template)).toBe(template);
  });
});
