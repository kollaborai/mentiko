import { GENERATED_CHAIN_CONTRACT_SHAPE } from "@/lib/chains/generated-chain-delivery-contract";
import { getTemplate } from "@/lib/generation/generation-template-storage";
import { getChainSchema } from "@/lib/schema-loader";
import { resolveTemplate } from "@/lib/system/template-resolver";

// Matches the exact field rejections thrown by the generated-chain validator.
// TASK-203 (2026-07-23) burned six generation attempts because the salient
// instruction near the top of the prompt described the contract in prose ("a
// reusable acceptance assertion") and the model snake_cased that sentence into
// the key -- reusable_acceptance_assertion / acceptance_assertion. The literal
// key only appeared 60KB deeper. Injecting the shape here covers every
// generation path, including stored templates customized before this existed.
export const CHAIN_GENERATION_CONTRACT_FIELDS_RULE = `
GENERATED_CHAIN_CONTRACT_FIELDS (required): metadata.generated_chain_contract must use exactly these field names: ${GENERATED_CHAIN_CONTRACT_SHAPE}. The assertion field is named acceptance_criteria. Any other name for it -- acceptance_assertion, reusable_acceptance_assertion, success_criteria -- is rejected. Write the reusable assertion as the value of acceptance_criteria; do not rename the key to match how the assertion is described in prose. A catalog reuse entry is not exempt: every agent, including one written as {"$ref": "agent-id"}, must carry its own deliverable and verification alongside the $ref, and a last agent written as a $ref must also carry final_verifier: true, verifies_acceptance_criteria: true, and success_assertion. A bare {"$ref": "agent-id"} with nothing beside it is rejected.`;

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
  if (!content.includes("GENERATED_CHAIN_CONTRACT_FIELDS")) {
    content = `${content.trim()}\n\n${CHAIN_GENERATION_CONTRACT_FIELDS_RULE.trim()}`;
  }
  if (!content.includes("DYNAMIC_PORT_RUNTIME_PROOF")) {
    content = `${content.trim()}\n\n${CHAIN_GENERATION_RUNTIME_PROOF_RULE.trim()}`;
  }
  if (!content.includes("DELIVERY_CONTRACT_EDIT_AUTHORITY")) {
    content = `${content.trim()}\n\n${CHAIN_GENERATION_DELIVERY_AUTHORITY_RULE.trim()}`;
  }
  return content;
}

/**
 * The one way to build a chain-generation prompt. /api/jobs (both generate
 * branches) and /api/chains/recommend each hand-rolled this same
 * getTemplate -> withRequiredChainGenerationRules -> resolveTemplate sequence.
 * Three copies of the step that guarantees the required rules are present is
 * the same shape as the defect this module exists to prevent: the copy that
 * drifts is the one nobody notices. Call this instead of reassembling it.
 */
export function buildChainGenerationPrompt(params: {
  namespaceId: string;
  orgId: string;
  userPrompt: string;
  agentCatalog: string;
  profileCatalog: string;
  workspaceContext: string;
}): string {
  const template = getTemplate(params.namespaceId, params.orgId, "chain_generation");
  return resolveTemplate(withRequiredChainGenerationRules(template.content), {
    USER_PROMPT: params.userPrompt,
    SCHEMA: getChainSchema(),
    AGENT_CATALOG: params.agentCatalog,
    PROFILE_CATALOG: params.profileCatalog,
    WORKSPACE_CONTEXT: params.workspaceContext,
  });
}
