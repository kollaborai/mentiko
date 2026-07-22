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

function contractFromChain(chain: RecordValue): GeneratedChainDeliveryContract | null {
  const metadata = record(chain.metadata);
  const raw = record(metadata?.generated_chain_contract);
  if (!raw || raw.version !== 1 || !text(raw.acceptance_criteria)) return null;
  if (raw.mode !== "delivery" && raw.mode !== "operations" && raw.mode !== "research") return null;
  return {
    version: 1,
    mode: raw.mode,
    acceptance_criteria: raw.acceptance_criteria.trim(),
  };
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

  const contract = contractFromChain(source);
  if (!contract) {
    return [
      "metadata.generated_chain_contract requires version: 1, mode: delivery|operations|research, and acceptance_criteria",
    ];
  }

  if (!Array.isArray(source.agents) || source.agents.length === 0) {
    return ["generated chain requires at least one agent"];
  }

  const errors: string[] = [];
  const agents = source.agents.map(record);
  agents.forEach((agent, index) => {
    if (!agent) {
      errors.push(`agents[${index}] must be an object`);
      return;
    }
    if (!text(agent.deliverable)) {
      errors.push(`agents[${index}].deliverable must name the concrete output this agent hands off`);
    }
    if (!text(agent.verification)) {
      errors.push(`agents[${index}].verification must state how that output is checked`);
    }
  });

  if (contract.mode === "delivery" && !agents.some((agent) => agent && agentHasAuthority(agent, "edit_files"))) {
    errors.push("delivery generated chains require an agent with edit_files authority");
  }
  if (contract.mode === "operations" && !agents.some((agent) => agent && agentHasAuthority(agent, "run_commands"))) {
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
