import type { ExecutionPlan, LegacyPlanTaskReconciliation, PlanDependency, PlanTask } from "@/lib/decisions/decision-types";

export interface VerifiablePlanTask extends PlanTask {
  deliverable: string;
  verification: string;
  acceptance_criteria: string;
}

export interface VerifiableExecutionPlan extends Omit<ExecutionPlan, "tasks"> {
  tasks: VerifiablePlanTask[];
}

export type ExecutionPlanValidation =
  | { valid: true; plan: VerifiableExecutionPlan }
  | { valid: false; error: string };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown, field: string): { value?: string[]; error?: string } {
  if (value === undefined) return { value: [] };
  if (!Array.isArray(value)) return { error: `${field} must be an array of strings` };
  if (!value.every((item) => typeof item === "string" && item.trim())) {
    return { error: `${field} must contain only non-empty strings` };
  }
  return { value: value.map((item) => item.trim()) };
}

function canonicalAcceptanceCriteria(
  supplied: string | undefined,
  deliverable: string,
  verification: string,
): string {
  const requiredLines = [`Deliverable: ${deliverable}`, `Verification: ${verification}`];
  if (!supplied) return requiredLines.join("\n");
  const existing = supplied.trim();
  return [existing, ...requiredLines.filter((line) => !existing.includes(line))].join("\n");
}

/**
 * Parse the generated Round 3 plan at its ownership boundary. A plan task is
 * not actionable merely because it has a title and subtasks: it must name the
 * observable deliverable and a repeatable check that proves it. Older stored
 * plans intentionally fail here rather than being silently converted into
 * unverifiable auto-run work.
 */
export function validateExecutionPlan(value: unknown): ExecutionPlanValidation {
  const candidate = record(value);
  if (!candidate) return { valid: false, error: "Decision plan must be a JSON object" };
  const summary = text(candidate.summary);
  if (!summary) return { valid: false, error: "Decision plan summary is required" };
  if (!Array.isArray(candidate.tasks) || candidate.tasks.length === 0) {
    return { valid: false, error: "Decision plan must contain at least one task" };
  }
  if (!Array.isArray(candidate.dependencies)) {
    return { valid: false, error: "Decision plan dependencies must be an array" };
  }

  const tasks: VerifiablePlanTask[] = [];
  const taskIds = new Set<string>();
  for (const [index, rawTask] of candidate.tasks.entries()) {
    const task = record(rawTask);
    const path = `Decision plan task ${index + 1}`;
    if (!task) return { valid: false, error: `${path} must be an object` };
    const id = text(task.id);
    const title = text(task.title);
    const description = text(task.description);
    const deliverable = text(task.deliverable);
    const verification = text(task.verification);
    if (!id || !title || !description) {
      return { valid: false, error: `${path} requires id, title, and description` };
    }
    if (taskIds.has(id)) return { valid: false, error: `${path} duplicates task id: ${id}` };
    if (!deliverable) return { valid: false, error: `${path} (${id}) requires a concrete deliverable` };
    if (!verification) return { valid: false, error: `${path} (${id}) requires a repeatable verification` };
    const priority = task.priority;
    const phase = task.phase;
    if (typeof priority !== "number" || !Number.isInteger(priority) || priority < 0 || priority > 4) {
      return { valid: false, error: `${path} (${id}) priority must be an integer from 0 to 4` };
    }
    if (typeof phase !== "number" || !Number.isInteger(phase) || phase < 1) {
      return { valid: false, error: `${path} (${id}) phase must be a positive integer` };
    }
    const subtasks = stringArray(task.subtasks, `${path} (${id}) subtasks`);
    if (subtasks.error) return { valid: false, error: subtasks.error };
    const legacyTaskIds = stringArray(task.legacy_task_ids, `${path} (${id}) legacy_task_ids`);
    if (legacyTaskIds.error) return { valid: false, error: legacyTaskIds.error };
    if (new Set(legacyTaskIds.value).size !== legacyTaskIds.value?.length) {
      return { valid: false, error: `${path} (${id}) legacy_task_ids cannot contain duplicates` };
    }
    taskIds.add(id);
    tasks.push({
      id,
      title,
      description,
      subtasks: subtasks.value ?? [],
      ...(text(task.assignee) ? { assignee: text(task.assignee) } : {}),
      priority,
      phase,
      deliverable,
      verification,
      acceptance_criteria: canonicalAcceptanceCriteria(text(task.acceptance_criteria), deliverable, verification),
      ...(legacyTaskIds.value?.length ? { legacy_task_ids: legacyTaskIds.value } : {}),
    });
  }

  const dependencies: PlanDependency[] = [];
  for (const [index, rawDependency] of candidate.dependencies.entries()) {
    const dependency = record(rawDependency);
    const from = dependency && text(dependency.from);
    const to = dependency && text(dependency.to);
    if (!from || !to) return { valid: false, error: `Decision plan dependency ${index + 1} requires from and to` };
    if (!taskIds.has(from) || !taskIds.has(to)) {
      return { valid: false, error: `Decision plan dependency ${index + 1} references an unknown task` };
    }
    if (from === to) return { valid: false, error: `Decision plan dependency ${index + 1} cannot reference itself` };
    dependencies.push({ from, to });
  }

  let legacyTaskReconciliation: LegacyPlanTaskReconciliation[] | undefined;
  if (candidate.legacy_task_reconciliation !== undefined) {
    if (!Array.isArray(candidate.legacy_task_reconciliation)) {
      return { valid: false, error: "Decision plan legacy_task_reconciliation must be an array" };
    }
    const seenLegacyTaskIds = new Set<string>();
    legacyTaskReconciliation = [];
    for (const [index, rawEntry] of candidate.legacy_task_reconciliation.entries()) {
      const entry = record(rawEntry);
      const path = `Decision plan legacy_task_reconciliation ${index + 1}`;
      const legacyTaskId = entry && text(entry.legacy_task_id);
      const outcome = entry && text(entry.outcome);
      const rationale = entry && text(entry.rationale);
      const planTaskId = entry && text(entry.plan_task_id);
      if (!legacyTaskId || !rationale) return { valid: false, error: `${path} requires legacy_task_id and rationale` };
      if (seenLegacyTaskIds.has(legacyTaskId)) return { valid: false, error: `${path} duplicates legacy task ${legacyTaskId}` };
      if (outcome !== "covered" && outcome !== "superseded") {
        return { valid: false, error: `${path} outcome must be covered or superseded` };
      }
      if (outcome === "covered") {
        if (!planTaskId || !taskIds.has(planTaskId)) return { valid: false, error: `${path} covered outcome requires a known plan_task_id` };
        const planTask = tasks.find((task) => task.id === planTaskId);
        if (!planTask?.legacy_task_ids?.includes(legacyTaskId)) {
          return { valid: false, error: `${path} covered plan task must explicitly include ${legacyTaskId} in legacy_task_ids` };
        }
      } else if (planTaskId) {
        return { valid: false, error: `${path} superseded outcome cannot name plan_task_id` };
      }
      seenLegacyTaskIds.add(legacyTaskId);
      legacyTaskReconciliation.push({
        legacy_task_id: legacyTaskId,
        outcome,
        ...(planTaskId ? { plan_task_id: planTaskId } : {}),
        rationale,
      });
    }
  }

  return { valid: true, plan: { summary, tasks, dependencies, ...(legacyTaskReconciliation ? { legacy_task_reconciliation: legacyTaskReconciliation } : {}) } };
}
