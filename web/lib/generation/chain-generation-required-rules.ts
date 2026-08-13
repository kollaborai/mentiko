import {
  GENERATED_CHAIN_CONTRACT_SHAPE,
  TASK_LINKED_CHAIN_RUNTIME_RULE,
} from "@/lib/chains/generated-chain-delivery-contract";
import { getTemplate } from "@/lib/generation/generation-template-storage";
import { getChainSchema } from "@/lib/schema-loader";
import { resolveTemplate } from "@/lib/system/template-resolver";

export { TASK_LINKED_CHAIN_RUNTIME_RULE };

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

// B2 (chain-contract-plan-of-record.md): the injected launch context holds
// only facts fixed at launch. Teaching the model this split prevents the
// TASK-004 family, where chains asserted live lifecycle state from prose
// beliefs about a snapshot.
export const CHAIN_GENERATION_RUNTIME_CONTEXT_RULE = `
RUNTIME_CONTEXT_TRUTH (required): TASK_CONTEXT_JSON is an IMMUTABLE launch snapshot: task identity and criteria, namespace/org identity, source run id, and chain binding. It never reflects live task or run state. For mutable state — task status, assignee, last_run_id, run outcomes, a created child task's record — query the typed tools (mentiko get_task, get_run) at the moment of verification; tool results identify the resource and observation time. Never assert lifecycle state from the launch snapshot, and never treat a snapshot value as proof that state still holds.`;

// Matches the exact capability rejections thrown by the generated-chain
// validator. This is injected into stored namespace templates too, so an older
// customized prompt cannot keep teaching the obsolete delivery-vs-research
// binary or force file edits for service/task-state operations.
export const CHAIN_GENERATION_DELIVERY_AUTHORITY_RULE = `
DELIVERY_CONTRACT_EDIT_AUTHORITY (required): classify the requested end state before choosing metadata.generated_chain_contract.mode. Use "delivery" only when the chain must create or modify workspace files/code; delivery generated chains require an agent with edit_files authority. Use "operations" when the end state is a mutation of external or Mentiko-managed state through a command, API, or MCP tool; operations generated chains require an agent with run_commands authority. Use "research" only when the acceptance criteria are analysis/evidence outputs and no state mutation is required. Running tests does not make a code-writing task "operations"; if workspace files must change, the mode is "delivery". Authorities may be a string array or authorities.can. Never add a fake edit_files agent to an operational chain merely to satisfy validation.`;

// Matches the exact graph rejections thrown by the chain validator. TASK-007
// (2026-08-09) burned its whole deterministic budget on these two: version
// "1.0" ("must be in semver format") and a branches key naming an event no
// agent declared ("must match an event emitted or consumed by an agent").
// Import-time repair now normalizes the version and PRUNES dangling branches,
// so a wrong branch key silently costs the chain its routing — teach the
// vocabulary here so the intended topology survives generation.
export const CHAIN_GENERATION_GRAPH_VOCABULARY_RULE = `
GRAPH_EVENT_VOCABULARY (required): version must be exactly "1.0.0" (three-part semver; "1.0" is rejected: must be in semver format). Every key in branches must be an event name that one of THIS chain's own agents declares in emits or triggers — the validator rejects any other key with "must match an event emitted or consumed by an agent". Never invent, rename, or pluralize event names in branches; copy them verbatim from the emits/triggers you wrote on the agents. Every branch target (the value, fan_out entries, and fan_in) must be an agent id defined in this chain. A branch whose event no agent emits can never fire and is pruned at import, silently deleting that routing.`;

export function withRequiredChainRecommendationRules(templateContent: string): string {
  if (templateContent.includes(TASK_LINKED_CHAIN_RUNTIME_RULE.trim())) return templateContent;
  return `${templateContent.trim()}\n\n${TASK_LINKED_CHAIN_RUNTIME_RULE.trim()}`;
}

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
  if (!content.includes("RUNTIME_CONTEXT_TRUTH")) {
    content = `${content.trim()}\n\n${CHAIN_GENERATION_RUNTIME_CONTEXT_RULE.trim()}`;
  }
  if (!content.includes("GRAPH_EVENT_VOCABULARY")) {
    content = `${content.trim()}\n\n${CHAIN_GENERATION_GRAPH_VOCABULARY_RULE.trim()}`;
  }
  if (!content.includes(TASK_LINKED_CHAIN_RUNTIME_RULE.trim())) {
    content = `${content.trim()}\n\n${TASK_LINKED_CHAIN_RUNTIME_RULE.trim()}`;
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
