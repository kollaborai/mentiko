export const CHAIN_GENERATION_RUNTIME_PROOF_RULE = `
DYNAMIC_PORT_RUNTIME_PROOF (required): Never assume port 3000 for generated app verification. Pick a free port at verification time, bind the target app explicitly to 127.0.0.1 on that port, capture the PID and working directory for the process you started, and verify target-specific content from this workspace. Do not treat an already-listening port as proof. Do not use broad kills such as pkill -f "next dev"; stop only the PID you started.`;

// Matches the exact rejection thrown by validateGeneratedChainDeliveryContract
// (web/lib/chains/generated-chain-delivery-contract.ts): "delivery generated
// chains require an agent with edit_files authority". Stated here in the
// validator's own words as a hard backstop -- independent of whatever prose
// the rest of a chain_generation template does or does not carry, so a stored
// namespace copy that predates this rule still gets it injected.
export const CHAIN_GENERATION_DELIVERY_AUTHORITY_RULE = `
DELIVERY_CONTRACT_EDIT_AUTHORITY (required): delivery generated chains require an agent with edit_files authority. If metadata.generated_chain_contract.mode is "delivery", at least one agent MUST declare "edit_files" in its authorities -- either as an authorities array (e.g. "authorities": ["edit_files", "read_files"]) or as authorities.can (e.g. "authorities": {"can": ["edit_files"], "needs_approval": []}). A chain with no edit_files agent will be rejected on submission. Use mode "research" instead of "delivery" only when the acceptance criteria are genuinely analysis/evidence outputs, not working code.`;

export function withRequiredChainGenerationRules(templateContent: string): string {
  let content = templateContent;
  if (!content.includes("DYNAMIC_PORT_RUNTIME_PROOF")) {
    content = `${content.trim()}\n\n${CHAIN_GENERATION_RUNTIME_PROOF_RULE.trim()}`;
  }
  if (!content.includes("DELIVERY_CONTRACT_EDIT_AUTHORITY")) {
    content = `${content.trim()}\n\n${CHAIN_GENERATION_DELIVERY_AUTHORITY_RULE.trim()}`;
  }
  return content;
}
