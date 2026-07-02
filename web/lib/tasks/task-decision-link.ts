import {
  createDecision,
  updateDecision,
} from "@/lib/decisions/decision-storage";
import { taskCreate } from "@/lib/tasks/task-store";
import type { Decision } from "@/lib/decisions/decision-types";
import type { TaskRecord } from "@/lib/tasks/task-store-types";
import { buildDecisionPromptFromTaskPrompt } from "@/lib/tasks/task-decision-routing";

interface CreateTaskDecisionInput {
  namespaceId: string;
  orgId: string;
  prompt: string;
  source: string;
  workspacePath?: string;
  parentTaskId?: string;
}

interface CreateTaskDecisionResult {
  decision: Decision;
  task: TaskRecord;
}

function titleFromDecisionPrompt(prompt: string): string {
  return buildDecisionPromptFromTaskPrompt(prompt).split("\n")[0];
}

export async function createTaskDecision({
  namespaceId,
  orgId,
  prompt,
  source,
  workspacePath,
  parentTaskId,
}: CreateTaskDecisionInput): Promise<CreateTaskDecisionResult> {
  // The completion-audit path hands us a fully composed decision prompt; the
  // Generate-Task path hands us a raw user request that still needs the decision
  // framing. Only wrap the latter — wrapping an already-composed prompt is what
  // produced the doubled "Decide the implementation approach for… Original
  // request:…" text on auto-created decisions.
  const alreadyComposed = source === "completion-audit";
  const decisionPrompt = alreadyComposed ? prompt : buildDecisionPromptFromTaskPrompt(prompt);
  const title = alreadyComposed
    ? (prompt.split("\n")[0] || prompt)
    : titleFromDecisionPrompt(prompt);
  const decision = createDecision(
    namespaceId,
    orgId,
    {
      prompt: decisionPrompt,
      source,
    },
    workspacePath,
  );

  const task = taskCreate(
    orgId,
    {
      workspace_id: workspacePath,
      title,
      description: decisionPrompt,
      issue_type: "decision",
      priority: 2,
      parent_id: parentTaskId,
      metadata: {
        decision_id: decision.id,
        decision_status: decision.status,
        decision_source: source,
        ...(parentTaskId ? { decision_parent_task_id: parentTaskId } : {}),
      },
    },
    namespaceId,
  );

  const updatedDecision = await updateDecision(
    namespaceId,
    orgId,
    decision.id,
    {
      title,
      taskId: task.id,
      ...(parentTaskId ? { parentTaskId } : {}),
    },
    workspacePath,
  );

  return { decision: updatedDecision, task };
}
