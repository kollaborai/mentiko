import { GENERATED_CHAIN_CONTRACT_SHAPE } from "@/lib/chains/generated-chain-delivery-contract";

export type TaskChainRecommendationAction =
  | "use_existing"
  | "generate_new"
  | "execute_directly"
  | "no_action_needed";

export type TaskChainWorkMode = "delivery" | "operations" | "research";

export interface TaskChainRecommendation {
  action: TaskChainRecommendationAction;
  reasoning: string;
  confidence?: number | string;
  chain_id?: string;
  chain_name?: string;
  chain_description?: string;
  match_reasons?: string[];
  suggested_name?: string;
  suggested_description?: string;
  suggested_agents?: { name: string; role: string }[];
  generation_prompt?: string;
  direct_instructions?: string;
  work_mode?: TaskChainWorkMode;
  reuse_scope?: string;
  runtime_inputs?: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.map(text).filter((item): item is string => Boolean(item));
  return values.length ? values : undefined;
}

function suggestedAgents(value: unknown): { name: string; role: string }[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const agents = value.flatMap((item) => {
    const record = asRecord(item);
    if (!record) return [];
    const name = text(record.name);
    if (!name) return [];
    return [{ name, role: text(record.role) || "" }];
  });
  return agents.length ? agents : undefined;
}

export function normalizeTaskChainRecommendation(value: unknown): TaskChainRecommendation | null {
  const record = asRecord(value);
  if (!record) return null;

  const rawAction = text(record.action);
  const chainId = text(record.chain_id);
  const generationPrompt = text(record.generation_prompt);
  const agents = suggestedAgents(record.suggested_agents);
  const hasGenerationShape = Boolean(
    generationPrompt ||
    text(record.suggested_name) ||
    text(record.suggested_description) ||
    agents?.length
  );

  let action: TaskChainRecommendationAction;
  if (rawAction === "use_existing" || rawAction === "generate_new" || rawAction === "no_action_needed") {
    action = rawAction;
  } else if (rawAction === "already_satisfied" || rawAction === "no_chain_needed") {
    action = "no_action_needed";
  } else if (chainId) {
    action = "use_existing";
  } else if (hasGenerationShape) {
    action = "generate_new";
  } else if (rawAction === "execute_directly") {
    action = "execute_directly";
  } else {
    action = "generate_new";
  }

  const directInstructions = text(record.suggested_approach);
  const reasoning = text(record.reasoning) || text(record.rationale) || directInstructions || "";
  const rawWorkMode = text(record.work_mode);
  const workMode = rawWorkMode === "delivery" || rawWorkMode === "operations" || rawWorkMode === "research"
    ? rawWorkMode
    : undefined;

  return {
    action,
    reasoning,
    confidence: typeof record.confidence === "number" ? record.confidence : text(record.confidence),
    chain_id: chainId,
    chain_name: text(record.chain_name),
    chain_description: text(record.chain_description),
    match_reasons: stringArray(record.match_reasons),
    suggested_name: text(record.suggested_name),
    suggested_description: text(record.suggested_description),
    suggested_agents: agents,
    generation_prompt: generationPrompt,
    direct_instructions: directInstructions,
    work_mode: workMode,
    reuse_scope: text(record.reuse_scope),
    runtime_inputs: stringArray(record.runtime_inputs),
  };
}

export function buildGenerationPromptFromTaskRecommendation(
  task: { title: string; description?: string; issue_type?: string; acceptance_criteria?: string },
  recommendation: TaskChainRecommendation | null,
  // The exact error the previous generation attempt for this task was
  // rejected with (e.g. metadata.generation_last_error, set when a "generate"
  // job comes back status: "failed" -- see app/api/tasks/auto-run/route.ts).
  // Passing it turns the existing bounded auto-run retry into a GUIDED retry:
  // the model sees precisely what it did wrong last time instead of repeating
  // the same generic instructions and possibly the same mistake.
  priorError?: string
): string {
  const base = recommendation?.generation_prompt
    ? [
        "RECOMMENDER DESIGN BRIEF (generalize this instance into a reusable chain; do not copy literal task IDs, absolute paths, ports, or one-run values into the chain definition):",
        recommendation.generation_prompt,
      ].join("\n")
    : [
    `Create a Mentiko chain for this task: ${task.title}.`,
    task.description ? `Task description: ${task.description}` : null,
    recommendation?.reasoning ? `Recommendation analysis: ${recommendation.reasoning}` : null,
    recommendation?.direct_instructions
      ? `Original recommender note: ${recommendation.direct_instructions}`
      : null,
    "The chain should break the work into trustworthy agent steps, include verification, and be usable for this task from the task screen.",
      ].filter(Boolean).join("\n\n");

  const reuseRequirement = [
    "REUSABILITY REQUIREMENT: generate a task-agnostic chain that can be assigned to future tasks of this same work shape.",
    "Agents receive typed runtime task context automatically (TASK_ID, TASK_CONTEXT, title, description, acceptance criteria, workspace path). Their prompts must read the target identifiers, files, commands, and acceptance criteria from that runtime context instead of embedding values from this one task.",
    "It is correct to tailor discovery, commands, tests, and verification to the actual repository/framework described by WORKSPACE CONTEXT. It is not correct to hardcode the current task ID, another task ID, an absolute workspace path, a fixed port, or a one-run artifact path into reusable agent prompts.",
    recommendation?.reuse_scope ? `RECOMMENDED REUSE SCOPE: ${recommendation.reuse_scope}` : null,
    recommendation?.runtime_inputs?.length
      ? `RUNTIME INPUTS TO READ FROM TASK CONTEXT: ${recommendation.runtime_inputs.join(", ")}`
      : null,
  ].filter(Boolean).join("\n");

  const requestedMode = recommendation?.work_mode;
  const modeRequirement = requestedMode
    ? `WORK MODE: use metadata.generated_chain_contract.mode "${requestedMode}". ` +
      (requestedMode === "delivery"
        ? "At least one agent must edit the workspace and declare edit_files."
        : requestedMode === "operations"
          ? "At least one agent must mutate the requested system/service/task state and declare run_commands; do not add a fake edit_files step."
          : "Agents must produce analysis/evidence only and must not claim a state mutation occurred.")
    : "WORK MODE: classify from the acceptance criteria, not from the broad issue_type label. Use delivery for workspace file/code changes, operations for command/API/MCP state mutations, and research for analysis/evidence with no mutation.";

  const generatedChainContract = [
    // Name the literal keys, never paraphrase them. This line used to say "and
    // a reusable acceptance assertion derived from the runtime task criteria";
    // sitting 2.8% into an 85KB prompt, it out-shouted the exact spec 60KB
    // deeper and the model emitted `reusable_acceptance_assertion` as the key.
    // TASK-203 lost six generation attempts to that one sentence.
    `GENERATED-CHAIN CONTRACT: include metadata.generated_chain_contract with exactly these fields: ${GENERATED_CHAIN_CONTRACT_SHAPE}. Set acceptance_criteria (that exact key) to a reusable assertion derived from the runtime task criteria.`,
    modeRequirement,
    "Every agent must declare a concrete deliverable and repeatable verification. The last agent must be the final verifier and declare final_verifier: true, verifies_acceptance_criteria: true, and an evidence-backed success_assertion. It must reject a result when criteria are not proven.",
    "TASK-LINKED RUNTIME ORDER: agents run after admission, when the linked task can already be in_progress, metadata.chain_id is authoritative, assignee may be null, and last_run_id/task_run_scope identify the active run. No in-run agent may require pre-admission open/assignee state or require its own run/task to already be terminal or reconciled. Final task/run reconciliation is verified externally after the chain finishes.",
    task.acceptance_criteria ? `ACCEPTANCE CRITERIA TO SATISFY:\n${task.acceptance_criteria}` : "The task has no acceptance criteria; do not generate a chain until a verifiable criterion is supplied.",
  ].join("\n\n");

  const priorErrorGuidance = priorError
    ? `PRIOR ATTEMPT REJECTED (this is a bounded regeneration retry — fix the exact issue below, do not repeat it):\n${priorError}`
    : null;

  return [
    base,
    reuseRequirement,
    generatedChainContract,
    priorErrorGuidance,
  ].filter(Boolean).join("\n\n");
}
