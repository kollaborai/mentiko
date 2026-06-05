function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function generationKindFromMetadata(metadata: unknown): string | undefined {
  if (!isRecord(metadata)) return undefined;
  const kind = metadata.generationKind;
  return typeof kind === "string" && kind.length > 0 ? kind : undefined;
}

function isDecisionRunMetadata(metadata: unknown): boolean {
  if (!isRecord(metadata)) return false;
  return typeof metadata.decisionId === "string" &&
    metadata.decisionId.length > 0 &&
    typeof metadata.decisionPhase === "string" &&
    metadata.decisionPhase.length > 0;
}

export function isGenerationAuditRun(run: unknown): boolean {
  if (!isRecord(run)) return false;
  return !!generationKindFromMetadata(run.metadata);
}

export function isNonExecutionRunMetadata(metadata: unknown): boolean {
  return !!generationKindFromMetadata(metadata) || isDecisionRunMetadata(metadata);
}

export function isNonExecutionRun(run: unknown): boolean {
  if (!isRecord(run)) return false;
  return isNonExecutionRunMetadata(run.metadata);
}

export function shouldRecordTaskExecutionMetadata(metadata: unknown): boolean {
  return !isNonExecutionRunMetadata(metadata);
}

const TASK_EXECUTION_METADATA_FIELDS = [
  "last_run_id",
  "last_run_status",
  "last_run_outcome",
  "last_run_decision_required",
  "last_run_error",
  "last_run_completed",
  "last_run_chain",
  "last_run_started",
  "last_run_agents",
  "last_run_artifacts",
  "last_run_summary",
] as const;

export function cleanTaskExecutionRunMetadata(
  metadata: unknown,
  run: unknown,
  runId: string
): Record<string, unknown> {
  const cleaned = isRecord(metadata) ? { ...metadata } : {};
  for (const field of TASK_EXECUTION_METADATA_FIELDS) {
    delete cleaned[field];
  }

  if (!isRecord(run)) return cleaned;

  const generationKind = generationKindFromMetadata(run.metadata);
  if (generationKind === "chain_recommendation") {
    cleaned.recommendation_run_id = runId;
    if (typeof run.chainId === "string") cleaned.recommendation_chain_id = run.chainId;
  } else if (generationKind === "chain_generation") {
    cleaned.generated_chain_run_id = runId;
    if (typeof run.chainId === "string") cleaned.generated_chain_source_chain_id = run.chainId;
  }

  return cleaned;
}
