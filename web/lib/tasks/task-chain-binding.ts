/**
 * Projects the task-create chain assignment into the established reader shape.
 * Creation writes metadata.chainBinding; later lifecycle updates write direct
 * fields. Direct fields win when both exist so subsequent task mutations stay
 * authoritative without introducing a second writer.
 */
export function normalizeTaskChainBindingMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const binding = metadata.chainBinding;
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) return metadata;
  return { ...(binding as Record<string, unknown>), ...metadata };
}
