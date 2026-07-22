export const CHAIN_GENERATION_RUNTIME_PROOF_RULE = `
DYNAMIC_PORT_RUNTIME_PROOF (required): Never assume port 3000 for generated app verification. Pick a free port at verification time, bind the target app explicitly to 127.0.0.1 on that port, capture the PID and working directory for the process you started, and verify target-specific content from this workspace. Do not treat an already-listening port as proof. Do not use broad kills such as pkill -f "next dev"; stop only the PID you started.`;

// Matches the exact capability rejections thrown by the generated-chain
// validator. This is injected into stored namespace templates too, so an older
// customized prompt cannot keep teaching the obsolete delivery-vs-research
// binary or force file edits for service/task-state operations.
export const CHAIN_GENERATION_DELIVERY_AUTHORITY_RULE = `
DELIVERY_CONTRACT_EDIT_AUTHORITY (required): classify the requested end state before choosing metadata.generated_chain_contract.mode. Use "delivery" only when the chain must create or modify workspace files/code; delivery generated chains require an agent with edit_files authority. Use "operations" when the end state is a mutation of external or Mentiko-managed state through a command, API, or MCP tool; operations generated chains require an agent with run_commands authority. Use "research" only when the acceptance criteria are analysis/evidence outputs and no state mutation is required. Running tests does not make a code-writing task "operations"; if workspace files must change, the mode is "delivery". Authorities may be a string array or authorities.can. Never add a fake edit_files agent to an operational chain merely to satisfy validation.`;

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
