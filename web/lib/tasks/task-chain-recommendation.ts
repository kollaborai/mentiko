import { isDeliverableIssueType } from "@/lib/tasks/deliverable-issue-types";

export type TaskChainRecommendationAction =
  | "use_existing"
  | "generate_new"
  | "execute_directly"
  | "no_action_needed";

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
  };
}

export function buildGenerationPromptFromTaskRecommendation(
  task: { title: string; description?: string; issue_type?: string; acceptance_criteria?: string },
  recommendation: TaskChainRecommendation | null
): string {
  const base = recommendation?.generation_prompt || [
    `Create a Mentiko chain for this task: ${task.title}.`,
    task.description ? `Task description: ${task.description}` : null,
    recommendation?.reasoning ? `Recommendation analysis: ${recommendation.reasoning}` : null,
    recommendation?.direct_instructions
      ? `Original recommender note: ${recommendation.direct_instructions}`
      : null,
    "The chain should break the work into trustworthy agent steps, include verification, and be usable for this task from the task screen.",
  ].filter(Boolean).join("\n\n");

  const generatedChainContract = [
    "GENERATED-CHAIN CONTRACT: include metadata.generated_chain_contract with version 1, mode delivery or research, and the task acceptance criteria verbatim.",
    "Every agent must declare a concrete deliverable and repeatable verification. The last agent must be the final verifier and declare final_verifier: true, verifies_acceptance_criteria: true, and an evidence-backed success_assertion. It must reject a result when criteria are not proven.",
    task.acceptance_criteria ? `ACCEPTANCE CRITERIA TO SATISFY:\n${task.acceptance_criteria}` : "The task has no acceptance criteria; do not generate a chain until a verifiable criterion is supplied.",
  ].join("\n\n");

  // Appended even when the recommender already supplied its own
  // generation_prompt — a chain-recommendation output for a feature/task/bug
  // is exactly where this requirement was previously missing. (FEAT-014's
  // chain was born from a chain-recommendation-generated prompt and ended up
  // with 4 read-only agents and zero code.)
  if (!isDeliverableIssueType(task.issue_type)) {
    return [base, generatedChainContract].join("\n\n");
  }

  return [
    base,
    `DELIVERY REQUIREMENT: this task's type is "${task.issue_type}", which promises a working code ` +
      "deliverable, not a document. The chain MUST include at least one agent with \"edit_files\" " +
      "authority whose job is to implement the acceptance criteria in the actual codebase, and the " +
      "final agent must verify the specific behavior/files described in the acceptance criteria exist " +
      "before reporting completion. A chain made only of analysis, design, or specification agents " +
      "(read_files-only / run_commands-only authorities) does NOT satisfy this task, no matter how " +
      "thorough — the acceptance criteria describe working software, and a spec is not working software.",
    generatedChainContract,
  ].filter(Boolean).join("\n\n");
}
