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
  task: { title: string; description?: string },
  recommendation: TaskChainRecommendation | null
): string {
  if (recommendation?.generation_prompt) return recommendation.generation_prompt;

  return [
    `Create a Mentiko chain for this task: ${task.title}.`,
    task.description ? `Task description: ${task.description}` : null,
    recommendation?.reasoning ? `Recommendation analysis: ${recommendation.reasoning}` : null,
    recommendation?.direct_instructions
      ? `Original recommender note: ${recommendation.direct_instructions}`
      : null,
    "The chain should break the work into trustworthy agent steps, include verification, and be usable for this task from the task screen.",
  ].filter(Boolean).join("\n\n");
}
