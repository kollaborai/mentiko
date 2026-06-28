import { NextResponse } from "next/server";
import { requireOpsAuth, requireOpsPermission } from "@/lib/ai-engine/mentiko-mcp-ops-auth";
import { getTaskSchema } from "@/lib/schema-loader";
import { getTemplate } from "@/lib/generation/generation-template-storage";
import { resolveTemplate } from "@/lib/system/template-resolver";
import { resolveAuthorizedWorkspacePath } from "@/lib/auth/workspace-auth";
import { startGenerationJob } from "@/lib/generation/generation-chain-dispatch";
import { createTaskDecision } from "@/lib/tasks/task-decision-link";

export const dynamic = "force-dynamic";

/**
 * POST /api/mentiko-mcp/ops/tasks/generate
 *
 * Agent-facing endpoint mirroring the UI task-generate dialog. Two paths:
 *
 *  - mode "decision": force the decision flow — createTaskDecision directly,
 *    returns at once { routedTo: "decision", decisionId, taskId }.
 *
 *  - mode "task" (default): start a generation job and return at once
 *    { jobId, runId, status }. The generation AGENT acts as the gate: its
 *    template asks it to decide task-vs-decision first. The completion backstop
 *    honors that (route "decision" -> createTaskDecision, else task tree).
 *    Poll get_job; the result carries routedTo:"decision" or the created task
 *    IDs. send_to_decision_if_warranted (default ON) toggles whether the agent
 *    is allowed to route to a decision — pass false to force a task tree.
 *
 * Body: { description, workspacePath?, autoRun?, sendToDecisionIfWarranted?=true, mode?="task" }
 */
export async function POST(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  const perm = requireOpsPermission(ctx, "manage_tasks", ["tasks:write", "tasks:generate"]);
  if (perm) return perm;

  const { namespaceId, orgId } = ctx;
  const {
    description,
    workspacePath,
    autoRun,
    sendToDecisionIfWarranted = true,
    mode = "task",
  } = (await req.json()) as {
    description?: string;
    workspacePath?: string;
    autoRun?: boolean;
    sendToDecisionIfWarranted?: boolean;
    mode?: "task" | "decision";
  };

  if (!description?.trim()) {
    return new NextResponse("description required", { status: 400 });
  }

  const authorizedWorkspacePath = resolveAuthorizedWorkspacePath(namespaceId, orgId, workspacePath, ctx.userId);
  const prompt = description.trim();
  const allowDecisionRouting = sendToDecisionIfWarranted !== false;

  // Explicit decision mode: skip generation, create a decision directly.
  if (mode === "decision") {
    const { decision, task } = await createTaskDecision({
      namespaceId,
      orgId,
      prompt,
      source: "task-generate-decision",
      workspacePath: authorizedWorkspacePath || undefined,
    });
    return NextResponse.json({
      routedTo: "decision",
      decisionId: decision.id,
      taskId: task.id,
    });
  }

  // Task mode: let the generation agent gate task-vs-decision.
  const workspaceContext = authorizedWorkspacePath
    ? `\nWORKSPACE CONTEXT: These tasks are for the project in "${authorizedWorkspacePath}". Tailor task descriptions and scope to this specific codebase.\n`
    : "";
  const allowDecisionRoutingContext = allowDecisionRouting
    ? ""
    : "\nDECISION ROUTING DISABLED: you MUST output route \"task\". Never choose \"decision\".\n";

  const schema = getTaskSchema();
  const template = getTemplate(namespaceId, orgId, "task_generation");
  const generationPrompt = resolveTemplate(template.content, {
    USER_PROMPT: prompt,
    SCHEMA: schema,
    WORKSPACE_CONTEXT: workspaceContext,
    ALLOW_DECISION_ROUTING: allowDecisionRoutingContext,
  });

  // Start the generation job + chain run and return immediately. The job's
  // completion backstop honors the agent's route decision (task vs decision),
  // stamps workspace_id, and fires auto-run continuation when autoRun is set.
  const handle = await startGenerationJob({
    request: req,
    namespaceId,
    orgId,
    kind: "task",
    prompt: generationPrompt,
    workspacePath: authorizedWorkspacePath || undefined,
    userId: ctx.userId,
    jobInput: {
      ...(autoRun === true ? { autoRun: true } : {}),
      allowDecisionRouting,
      taskGenerationMetadata: { created_by_session: ctx.sessionId },
    },
    runMetadata: { createdBySession: ctx.sessionId },
  });

  return NextResponse.json(handle);
}
