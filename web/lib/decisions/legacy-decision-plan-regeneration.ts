import { getDecision, updateDecision } from "@/lib/decisions/decision-storage";
import { startDurableDecisionPhaseOnce } from "@/lib/decisions/decision-auto-advance";
import { startDecisionChainRun } from "@/lib/decisions/decision-chain-dispatch";
import { buildDecisionContext, buildPreferenceText } from "@/lib/decisions/decision-context";
import { getTemplate } from "@/lib/generation/generation-template-storage";
import { withRequiredObservableEndStateCriteriaRule } from "@/lib/generation/criteria-authoring-required-rules";
import { resolveTemplate } from "@/lib/system/template-resolver";
import { taskList, taskUpdate } from "@/lib/tasks/task-store";
import { validateExecutionPlan } from "@/lib/decisions/decision-plan-contract";
import type { Decision, GuidedFlow, Option, TailoredOption } from "@/lib/decisions/decision-types";
import type { TaskRecord } from "@/lib/tasks/task-store-types";

export type LegacyDecisionPlanRegenerationAction = "eligible" | "started" | "already_generating" | "skipped";

export interface LegacyDecisionPlanRegenerationResult {
  decisionId: string;
  taskIds: string[];
  action: LegacyDecisionPlanRegenerationAction;
  reason: string;
  runId?: string;
}

export interface RegenerateLegacyDecisionPlansInput {
  request: Request;
  namespaceId: string;
  orgId: string;
  workspacePath?: string;
  apply?: boolean;
}

function metadata(task: TaskRecord): Record<string, unknown> {
  return task.metadata && typeof task.metadata === "object" && !Array.isArray(task.metadata)
    ? task.metadata as Record<string, unknown>
    : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isLegacyQuarantine(task: TaskRecord): boolean {
  const value = metadata(task);
  return value.decision_plan_contract === "legacy_unverifiable"
    || value.decision_plan_contract === "regenerating"
    || !!value.decision_plan_quarantined_at
    || text(value.auto_run_paused_reason)?.startsWith("Legacy decision plan is missing the required deliverable, verification, and acceptance contract.") === true;
}

function selectedOption(decision: Decision, selectedId: string): Option | TailoredOption | undefined {
  return decision.guidedFlow?.round2.tailoredOptions.find((option) => option.id === selectedId)
    || decision.options.find((option) => option.id === selectedId);
}

function legacyTaskReconciliationPrompt(tasks: TaskRecord[]): string {
  const legacyTasks = tasks.map((task) => {
    const meta = metadata(task);
    return {
      legacy_task_id: task.id,
      legacy_plan_task_id: text(meta.decision_plan_task_id) ?? null,
      title: task.title,
      description: task.description,
      phase: typeof meta.decision_plan_phase === "number" ? meta.decision_plan_phase : null,
      priority: task.priority,
    };
  });
  return [
    "",
    "LEGACY CHILD TASK RECONCILIATION — REQUIRED FOR THIS REGENERATION:",
    "These are authoritative persisted child rows. Preserve every obligation; do not infer that two differently named tasks are equivalent.",
    JSON.stringify(legacyTasks, null, 2),
    "Your JSON MUST include legacy_task_reconciliation with exactly one entry for every legacy_task_id above:",
    "- For outcome 'covered', name plan_task_id and make that output task include the same legacy_task_id in legacy_task_ids. That plan task must retain a concrete v1 deliverable, verification, and acceptance_criteria.",
    "- For outcome 'superseded', omit plan_task_id and give a fact-specific rationale explaining why the legacy obligation is no longer required. Do not use superseded merely because a task title changed.",
    "- Omitting a legacy row is invalid. Do not silently discard, rename, or merge legacy work without this explicit provenance.",
    "",
  ].join("\n");
}

function planPrompt(namespaceId: string, orgId: string, decision: Decision, option: Option | TailoredOption, legacyTasks: TaskRecord[]): string {
  const template = getTemplate(namespaceId, orgId, "decision_guided_plan");
  return resolveTemplate(withRequiredObservableEndStateCriteriaRule(template.content), {
    DECISION_CONTEXT: buildDecisionContext(decision),
    SELECTED_OPTION: `${option.letter}. ${option.name}: ${option.description}\nEffort: ${option.effort}\nRisk: ${option.risk}\nPros: ${option.pros.join(", ")}\nCons: ${option.cons.join(", ")}`,
    USER_PREFERENCES: buildPreferenceText(decision.guidedFlow as GuidedFlow),
  }) + legacyTaskReconciliationPrompt(legacyTasks);
}

function markRegenerating(namespaceId: string, orgId: string, tasks: TaskRecord[], decisionId: string, runId: string): void {
  for (const task of tasks) {
    const current = metadata(task);
    if (current.decision_id !== decisionId) continue;
    taskUpdate(orgId, task.id, {
      metadata: {
        ...current,
        auto_run_paused: true,
        auto_run_paused_reason: `Decision plan regeneration is running (${runId}).`,
        decision_plan_contract: "regenerating",
        decision_plan_regeneration_run_id: runId,
        decision_plan_regeneration_started_at: new Date().toISOString(),
      },
    }, namespaceId);
  }
}

/**
 * Replays legacy approved decisions through the same guided-plan chain used by
 * the interactive route. It is intentionally dry-run by default, groups task
 * rows by decision, and lets the durable phase claim own retries/restarts.
 */
export async function regenerateLegacyDecisionPlans(
  input: RegenerateLegacyDecisionPlansInput,
): Promise<LegacyDecisionPlanRegenerationResult[]> {
  const tasks = taskList(input.orgId, { status: "all" }, input.workspacePath, input.namespaceId)
    .filter(isLegacyQuarantine);
  const groups = new Map<string, TaskRecord[]>();
  for (const task of tasks) {
    const decisionId = text(metadata(task).decision_id);
    if (!decisionId) continue;
    groups.set(decisionId, [...(groups.get(decisionId) ?? []), task]);
  }

  const results: LegacyDecisionPlanRegenerationResult[] = [];
  for (const [decisionId, decisionTasks] of groups) {
    const first = decisionTasks[0];
    const decision = getDecision(input.namespaceId, input.orgId, decisionId, first.workspace_id ?? input.workspacePath);
    const taskIds = decisionTasks.map((task) => task.id);
    if (!decision) {
      results.push({ decisionId, taskIds, action: "skipped", reason: "authoritative decision record is missing" });
      continue;
    }
    if (decision.status !== "approved") {
      results.push({ decisionId, taskIds, action: "skipped", reason: `decision is ${decision.status}, not approved` });
      continue;
    }
    const sourceSelection = text(metadata(first).decision_selected_option_id);
    const selectedId = decision.resolution?.selectedOptionId ?? decision.guidedFlow?.round2.selectedOptionId;
    if (!selectedId || (sourceSelection && sourceSelection !== selectedId)) {
      results.push({ decisionId, taskIds, action: "skipped", reason: "decision has no stable selected option for regeneration" });
      continue;
    }
    const option = selectedOption(decision, selectedId);
    if (!option) {
      results.push({ decisionId, taskIds, action: "skipped", reason: "selected option is absent from the authoritative decision" });
      continue;
    }
    if (validateExecutionPlan(decision.guidedFlow?.round3?.plan).valid) {
      results.push({ decisionId, taskIds, action: "skipped", reason: "decision already has a verifiable plan; use contract recovery" });
      continue;
    }
    const running = decision.guidedFlow?.round3;
    if (running?.status === "generating" && (running.generationRunId || running.generationJobId)) {
      results.push({ decisionId, taskIds, action: "already_generating", reason: "durable plan generation is already in progress", runId: running.generationRunId });
      continue;
    }
    if (!input.apply) {
      results.push({ decisionId, taskIds, action: "eligible", reason: "approved legacy decision has a stable option and needs a v1 plan" });
      continue;
    }

    const phase = await startDurableDecisionPhaseOnce({
      identity: { namespaceId: input.namespaceId, orgId: input.orgId, decisionId, phase: "plan", selectedOptionId: selectedId },
      start: () => startDecisionChainRun({
        request: input.request,
        namespaceId: input.namespaceId,
        orgId: input.orgId,
        decision,
        phase: "plan",
        prompt: planPrompt(input.namespaceId, input.orgId, decision, option, decisionTasks),
        workspacePath: decision.workspacePath ?? first.workspace_id ?? input.workspacePath,
        selectedOptionId: selectedId,
      }),
      persist: async (run) => {
        const latest = getDecision(input.namespaceId, input.orgId, decisionId, decision.workspacePath ?? first.workspace_id ?? input.workspacePath);
        if (!latest?.guidedFlow) throw new Error(`Decision ${decisionId} disappeared while starting plan regeneration`);
        const flow: GuidedFlow = {
          ...latest.guidedFlow,
          round1: { ...latest.guidedFlow.round1 },
          round2: { ...latest.guidedFlow.round2, selectedOptionId: selectedId },
          round3: {
            ...latest.guidedFlow.round3,
            status: "generating",
            plan: undefined,
            generationJobId: undefined,
            generationRunId: run.runId,
          },
        };
        return updateDecision(input.namespaceId, input.orgId, decisionId, { guidedFlow: flow }, decision.workspacePath ?? first.workspace_id ?? input.workspacePath);
      },
    });
    markRegenerating(input.namespaceId, input.orgId, decisionTasks, decisionId, phase.started.runId);
    results.push({
      decisionId,
      taskIds,
      action: phase.joined || phase.recovered || phase.durableRecovered ? "already_generating" : "started",
      reason: "guided plan regeneration launched through the decision-plan chain",
      runId: phase.started.runId,
    });
  }
  return results;
}
