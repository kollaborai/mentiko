/**
 * Contract for chains produced by an LLM. A generated chain must describe the
 * concrete handoff from every agent and end with an explicit acceptance gate.
 * This is intentionally separate from the general Chain schema: hand-written
 * chains remain backward compatible, while generated chains fail closed.
 */

export type GeneratedChainMode = "delivery" | "operations" | "research";

export interface GeneratedChainDeliveryContract {
  version: 1;
  mode: GeneratedChainMode;
  acceptance_criteria: string;
}

/**
 * The contract shape, written the way a model must emit it. Every prompt that
 * asks a model for a generated chain states this literal instead of describing
 * it in prose -- TASK-203 burned six generation attempts because one prompt
 * said "a reusable acceptance assertion" and the model faithfully emitted
 * `reusable_acceptance_assertion`, which this validator rejects. Import the
 * constant; never re-word it.
 */
export const GENERATED_CHAIN_CONTRACT_SHAPE =
  '{"version":1,"mode":"delivery"|"operations"|"research","acceptance_criteria":"..."}';

// Shared by every generation producer, including the standalone typed CLI.
// Keep it beside the validator that enforces the rule so prompt guidance and
// rejection semantics cannot drift into separate definitions.
export const TASK_LINKED_CHAIN_RUNTIME_RULE = `
TASK_LINKED_CHAIN_RUNTIME (required): A chain assigned to a task runs after auto-run admission. During every in-run agent, the linked task can already be status "in_progress"; metadata.chain_id is the authoritative selected-chain binding; assignee may be null; and metadata.last_run_id/task_run_scope identify the active run. Never require the linked task to remain "open", never require assignee to contain the chain identifier, and never treat either as an admission-success condition. No agent inside a run may require that same run, its last_run_status, or the linked task already be terminal, completed, closed, or reconciled: those states are written only after the chain finishes. Agents must verify their own observable deliverables and emit their declared routing events. Verify final run/task terminal reconciliation from the external orchestrator after the run, not from an agent inside that run. Generated chains violating this temporal contract are rejected.`;

/**
 * Version stamp for the deterministic-rejection fingerprint (see
 * generated-chain-rejections.ts). Bump whenever a blocking rule in this file
 * changes so a previously rejected artifact gets one fresh validation under
 * the new rules instead of being stopped by a stale fingerprint.
 */
export const GENERATED_CHAIN_VALIDATOR_REVISION = "2026-07-31.v0349";

// 2026-07-30/31 devv incident (chain-contract-plan-of-record.md): this file
// used to scan agent prose (prompt/deliverable/verification/...) with keyword
// matchers -- requiresPreAdmissionTaskState / requiresOwnTerminalReconciliation
// -- and BLOCK acceptance on the result. The matchers could not tell a created
// child task from the linked parent (TASK-013), read lifecycle words in
// evidence prose as lifecycle requirements (TASK-004 attempt 2), and read the
// compliance phrase "without requiring terminal state" as the violation it
// disclaims (TASK-004 attempt 3, the Goodhart loop). Generated prose is not a
// machine contract and can never block acceptance. Do not reintroduce prose
// classification here in any form -- no keyword lists, no negation lists, no
// model-based classifiers. The runtime-ownership invariant TASK-002 exposed is
// owned by prompt guidance (advisory) today and the typed contract-v2
// subject/phase/owner schema (Track B) permanently.

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue
    : null;
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function agentHasAuthority(agent: RecordValue, authority: string): boolean {
  const authorities = agent.authorities;
  if (Array.isArray(authorities)) return authorities.includes(authority);
  const authorityRecord = record(authorities);
  return Array.isArray(authorityRecord?.can) && authorityRecord.can.includes(authority);
}

/**
 * Reads the contract field by field instead of all-or-nothing. A malformed
 * contract used to abort validation before the authority and final-verifier
 * checks ever ran, so a rejected generation only ever learned about ONE broken
 * thing at a time -- and the bounded regeneration retry (which feeds the
 * rejection back as "fix the exact issue below") oscillated: fix the contract
 * key, drop edit_files; restore edit_files, break the contract key again.
 * Reporting every violation in one pass is what makes the retry converge.
 *
 * `mode` is returned whenever it parses, even if a sibling field is broken, so
 * the mode-dependent authority check still runs on a partially bad contract.
 */
function readContract(chain: RecordValue): { mode: GeneratedChainMode | null; errors: string[] } {
  const raw = record(record(chain.metadata)?.generated_chain_contract);
  if (!raw) {
    return {
      mode: null,
      errors: [`metadata.generated_chain_contract is required: ${GENERATED_CHAIN_CONTRACT_SHAPE}`],
    };
  }

  const errors: string[] = [];
  if (raw.version !== 1) {
    errors.push("metadata.generated_chain_contract.version must be 1");
  }
  const mode = raw.mode === "delivery" || raw.mode === "operations" || raw.mode === "research"
    ? raw.mode
    : null;
  if (!mode) {
    errors.push('metadata.generated_chain_contract.mode must be "delivery", "operations", or "research"');
  }
  if (!text(raw.acceptance_criteria)) {
    errors.push(
      "metadata.generated_chain_contract.acceptance_criteria must be a non-empty string -- that exact key, not acceptance_assertion or reusable_acceptance_assertion",
    );
  }
  return { mode, errors };
}

/** True only for records that deliberately claim generated-chain ownership. */
export function isGeneratedChainContract(chain: unknown): boolean {
  const source = record(chain);
  return Boolean(record(source?.metadata)?.generated_chain_contract);
}

/**
 * Validate the generated-chain-only contract. Returns no errors for a manual
 * chain so the general save endpoint remains backward compatible.
 */
export function validateGeneratedChainDeliveryContract(chain: unknown): string[] {
  const source = record(chain);
  if (!source) return ["generated chain must be an object"];

  const { mode, errors } = readContract(source);

  // Stays an early return: without agents, every remaining check is nonsense
  // ("the last agent must declare final_verifier: true" on a chain that has no
  // agents teaches the model to fix the wrong thing).
  if (!Array.isArray(source.agents) || source.agents.length === 0) {
    errors.push("generated chain requires at least one agent");
    return errors;
  }

  const agents = source.agents.map(record);
  agents.forEach((agent, index) => {
    if (!agent) {
      errors.push(`agents[${index}] must be an object`);
      return;
    }
    // A catalog reuse entry ({"$ref": "id"}) still owes its declarations. The
    // post-processor already emits refs this way -- rewriteChainInlineToRef in
    // chain-postprocessor.ts keeps non-base fields alongside $ref as overrides
    // -- so the shape is consistent with what the pipeline itself produces. Say
    // so explicitly: this message is fed verbatim into the regeneration prompt,
    // and "must name the concrete output" alone doesn't tell a model that emitted
    // a bare $ref what to add.
    const isRefEntry = typeof agent.$ref === "string" && agent.$ref.trim().length > 0;
    const refHint = isRefEntry ? " alongside its $ref" : "";
    if (!text(agent.deliverable)) {
      errors.push(`agents[${index}].deliverable must name the concrete output this agent hands off${refHint}`);
    }
    if (!text(agent.verification)) {
      errors.push(`agents[${index}].verification must state how that output is checked${refHint}`);
    }
  });

  if (mode === "delivery" && !agents.some((agent) => agent && agentHasAuthority(agent, "edit_files"))) {
    errors.push("delivery generated chains require an agent with edit_files authority");
  }
  if (mode === "operations" && !agents.some((agent) => agent && agentHasAuthority(agent, "run_commands"))) {
    errors.push("operations generated chains require an agent with run_commands authority");
  }

  const finalAgent = agents.at(-1);
  if (!finalAgent || finalAgent.final_verifier !== true) {
    errors.push("the last generated-chain agent must declare final_verifier: true");
  } else {
    if (finalAgent.verifies_acceptance_criteria !== true) {
      errors.push("the final verifier must declare verifies_acceptance_criteria: true");
    }
    if (!text(finalAgent.success_assertion)) {
      errors.push("the final verifier must declare a success_assertion tied to the acceptance criteria");
    }
  }

  return errors;
}

/**
 * Distinguishes a model-output rejection (payload violates the delivery
 * contract) from an unexpected internal error. A rejected payload is an
 * expected, retryable outcome of generation -- not a server bug -- so
 * callers should catch this specifically and respond accordingly rather than
 * letting it bubble up as a generic 500.
 */
export class GeneratedChainContractError extends Error {
  constructor(errors: string[]) {
    super(`generated chain delivery contract invalid: ${errors.join("; ")}`);
    this.name = "GeneratedChainContractError";
  }
}

export function assertValidGeneratedChainDeliveryContract(chain: unknown): void {
  const errors = validateGeneratedChainDeliveryContract(chain);
  if (errors.length) {
    throw new GeneratedChainContractError(errors);
  }
}
