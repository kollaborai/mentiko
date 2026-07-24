// Single source of truth for a task's intended WORK MODE — the observable end
// state the task must reach. Persisted on task metadata (metadata.work_mode) at
// generation/recommendation time so that BOTH the chain generator (which decides
// what authorities to grant an agent) and the completion-audit delivery gate
// (which decides what evidence to demand before a "close" is trusted) read the
// SAME classification instead of each re-deriving it independently.
//
// Re-deriving it two different ways is exactly what manufactured ~89 duplicate
// "needs a human decision" escalations on the ApothesIQ test: the recommender
// classified work mode from the acceptance criteria (correctly picking
// "research" for an analysis-only task), while enforceDeliveryGate re-derived
// "needs a code deliverable" purely from issue_type ∈ {feature,task,bug}. The
// two disagreed on every analysis-only task typed "task" (the default type), and
// workspace-auto-approve resolved each escalation into follow-up tasks that
// re-entered the same pipeline. One authoritative value ends the disagreement.
export type TaskWorkMode = "delivery" | "operations" | "research";

export const TASK_WORK_MODES: readonly TaskWorkMode[] = ["delivery", "operations", "research"];

export function isTaskWorkMode(value: unknown): value is TaskWorkMode {
  return value === "delivery" || value === "operations" || value === "research";
}

// Read the authoritative work mode off a task's metadata. Returns undefined for
// legacy tasks created before work_mode was persisted, so callers fall back to
// their prior heuristic without changing behavior for pre-existing data.
export function resolveTaskWorkMode(metadata: unknown): TaskWorkMode | undefined {
  let record: Record<string, unknown> | undefined;
  if (typeof metadata === "string") {
    // Task-store metadata can arrive as a raw JSON string depending on the read path.
    try {
      const parsed = JSON.parse(metadata);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        record = parsed as Record<string, unknown>;
      }
    } catch {
      return undefined;
    }
  } else if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    record = metadata as Record<string, unknown>;
  }
  if (!record) return undefined;
  return isTaskWorkMode(record.work_mode) ? record.work_mode : undefined;
}
