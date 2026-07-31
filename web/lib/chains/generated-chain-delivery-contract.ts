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

const AGENT_RUNTIME_CONTRACT_FIELDS = [
  "prompt",
  "instructions",
  "role",
  "description",
  "deliverable",
  "verification",
  "success_assertion",
] as const;

function nestedText(value: unknown, depth = 0): string[] {
  if (typeof value === "string") return value.trim() ? [value] : [];
  if (depth >= 2 || !value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((item) => nestedText(item, depth + 1));
  return Object.values(value as RecordValue).flatMap((item) => nestedText(item, depth + 1));
}

function normalizedRuntimeSegments(agent: RecordValue): string[] {
  const source = AGENT_RUNTIME_CONTRACT_FIELDS
    .flatMap((field) => nestedText(agent[field]))
    .map((value) => value
      .toLowerCase()
      .replace(/[’']/g, "")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
    .trim())
    .filter(Boolean);

  // Evaluate local clauses plus adjacent clause windows. Local clauses keep a
  // safe statement in one sentence from negating an unrelated hard requirement
  // later in the prompt. Adjacent windows retain subjects across formulations
  // such as "assignee may be null, but when present it must contain chain id."
  return source.flatMap((value) => {
    const clauses = value
      .split(/[\n.;]+|,\s*(?:but|however|yet)\s+|\b(?:but|however|yet)\b/)
      .map((part) => part.trim())
      .filter(Boolean);
    return [
      ...clauses,
      ...clauses.slice(0, -1).map((clause, index) => `${clause} ${clauses[index + 1]}`),
    ];
  });
}

function hardRequirement(segment: string): boolean {
  return /\b(?:must|should|required?|requires?|verify|confirms?|checks?|ensures?|asserts?|expects?|waits?|until|remains?|stays?|equals?|matches?|contains?|holds?|stores?|populated|sets?|keeps?)\b/.test(segment)
    || /\b(?:has|have|needs?)\s+to\b/.test(segment);
}

function negatesOpenRequirement(segment: string): boolean {
  return /\b(?:do not|dont|does not|doesnt|must not|should not|need not|never)\s+(?:(?:need|have)\s+to\s+)?(?:require|verify|confirm|check|ensure|expect|wait for|remain|stay|keep|be)\b.{0,100}\bopen\b/.test(segment)
    || /\b(?:not required|not require)\b.{0,100}\bopen\b/.test(segment);
}

function negatesAssigneeBinding(segment: string): boolean {
  return /\b(?:do not|dont|does not|doesnt|must not|should not|need not|never)\s+(?:(?:need|have)\s+to\s+)?(?:require|contain|equal|match|hold|store|set|bind|use)\b.{0,100}\bchain(?: id| identifier| binding)?\b/.test(segment)
    || /\b(?:not required|not require)\b.{0,100}\bassignee\b/.test(segment);
}

function negatesTerminalRequirement(segment: string): boolean {
  return /\b(?:do not|dont|does not|doesnt|must not|should not|need not|never)\s+(?:(?:need|have)\s+to\s+)?(?:require|verify|confirm|check|ensure|expect|wait for|be)\b.{0,120}\b(?:terminal|completed|complete|closed|reconciled|failed|stopped|cancelled)\b/.test(segment)
    || /\b(?:not required|not require)\b.{0,120}\b(?:terminal|completed|complete|closed|reconciled)\b/.test(segment)
    || /\b(?:run|task)\b.{0,40}\b(?:is|be)\s+not\s+(?:terminal|completed|complete|closed|reconciled)\b/.test(segment);
}

function requiresPreAdmissionTaskState(agent: RecordValue): boolean {
  return normalizedRuntimeSegments(agent).some((segment) => {
    const taskReference = /\b(?:linked |current |assigned |this )?task(?:s| record)?\b/.test(segment);
    const lifecycleOpen = /\bopen\b(?!\s+(?:to|ended)\b)/.test(segment);
    const openStateSignal = /\b(?:status|state)\b/.test(segment)
      || /\b(?:is|be|remain|stay|keep|equal|match)\w*\b.{0,35}\bopen\b/.test(segment);
    const requiresOpenTask = taskReference
      && hardRequirement(segment)
      && openStateSignal
      && lifecycleOpen
      && !negatesOpenRequirement(segment);
    const requiresAssigneeBinding = /\bassignee\b/.test(segment)
      && /\bchain(?: id| identifier| binding)?\b/.test(segment)
      && /\b(?:contains?|equals?|matches?|holds?|stores?|populated|set|binding|identifier|id)\b/.test(segment)
      && hardRequirement(segment)
      && !negatesAssigneeBinding(segment);
    return requiresOpenTask || requiresAssigneeBinding;
  });
}

function requiresOwnTerminalReconciliation(agent: RecordValue): boolean {
  return normalizedRuntimeSegments(agent).some((segment) => {
    const currentRun = /\b(?:current|this|same|active|own) (?:execution )?run\b/.test(segment);
    const linkedTask = /\b(?:linked|current|this|assigned) task\b/.test(segment);
    const linkedTaskRunState = /\btask\b/.test(segment)
      && /\b(?:last run status|last run id|task run scope|run outcome|run status)\b/.test(segment);
    const terminalState = /\b(?:terminal|completed|complete|closed|reconciled|failed|stopped|cancelled)\b/.test(segment);
    return terminalState
      && hardRequirement(segment)
      && (currentRun || linkedTask || linkedTaskRunState)
      && !negatesTerminalRequirement(segment);
  });
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
    if (requiresPreAdmissionTaskState(agent)) {
      errors.push(
        `agents[${index}] violates TASK_LINKED_CHAIN_RUNTIME: in-run agents execute after admission and must not require task status open or an assignee-based chain binding; accept in_progress and use metadata.chain_id/last_run_id/task_run_scope`,
      );
    }
    if (requiresOwnTerminalReconciliation(agent)) {
      errors.push(
        `agents[${index}] violates TASK_LINKED_CHAIN_RUNTIME: an in-run agent must not require its current run or linked task to already be terminal or reconciled; verify final reconciliation externally after the chain finishes`,
      );
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
