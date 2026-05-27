export function generationKindFromMetadata(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  const kind = (metadata as Record<string, unknown>).generationKind;
  return typeof kind === "string" && kind.length > 0 ? kind : undefined;
}

export function isGenerationAuditRun(run: unknown): boolean {
  if (!run || typeof run !== "object" || Array.isArray(run)) return false;
  return !!generationKindFromMetadata((run as Record<string, unknown>).metadata);
}

export function shouldRecordTaskExecutionMetadata(metadata: unknown): boolean {
  return !generationKindFromMetadata(metadata);
}
