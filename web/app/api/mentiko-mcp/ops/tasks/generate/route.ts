import { NextResponse } from "next/server";
import { requireOpsAuth, requireOpsPermission } from "@/lib/mentiko-mcp-ops-auth";
import { createJob, getJob } from "@/lib/job-store";
import { getTaskSchema } from "@/lib/schema-loader";
import { getTemplate } from "@/lib/generation-template-storage";
import { resolveTemplate } from "@/lib/template-resolver";
import { resolveAuthorizedWorkspacePath } from "@/lib/workspace-auth";
import { internalApiUrl } from "@/lib/internal-web-origin";
import { importGeneratedTaskTree, type GeneratedTask } from "@/lib/generated-task-import";
import { startGenerationChainRun } from "@/lib/generation-chain-dispatch";

export const dynamic = "force-dynamic";

const JOB_POLL_INTERVAL_MS = 1000;
// Task generation runs an AI agent and routinely takes 2-4 min; the old 120s cap
// 504'd while the job was still working (tasks then landed async, so the call
// "failed" even on success). Kept under Node's default 300s server requestTimeout
// / undici headers timeout. Override via MENTIKO_TASKGEN_TIMEOUT_MS if needed.
const JOB_TIMEOUT_MS = Number(process.env.MENTIKO_TASKGEN_TIMEOUT_MS) || 240_000;

/**
 * POST /api/mentiko-mcp/ops/tasks/generate
 *
 * Agent-facing endpoint: takes a description, runs it through the same
 * task_generation template the UI uses (via job-runner), then atomically
 * creates the full task tree (parent + subtasks + deps) and returns IDs.
 *
 * Body: { description: string, workspacePath?: string, autoRun?: boolean, createdByRun?: string, createdByAgent?: string }
 *
 * Returns: { parentId, tasks: [{ id, title, type, priority }] }
 */
export async function POST(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  const perm = requireOpsPermission(ctx, "manage_tasks", ["tasks:write", "tasks:generate"]);
  if (perm) return perm;

  const { namespaceId, orgId } = ctx;
  const { description, workspacePath, autoRun } = (await req.json()) as {
    description?: string;
    workspacePath?: string;
    autoRun?: boolean;
  };

  if (!description?.trim()) {
    return new NextResponse("description required", { status: 400 });
  }

  const authorizedWorkspacePath = resolveAuthorizedWorkspacePath(namespaceId, orgId, workspacePath, ctx.userId);

  // build the generation prompt using the same template the UI uses
  const workspaceContext = authorizedWorkspacePath
    ? `\nWORKSPACE CONTEXT: These tasks are for the project in "${authorizedWorkspacePath}". Tailor task descriptions and scope to this specific codebase.\n`
    : "";

  const schema = getTaskSchema();
  const template = getTemplate(namespaceId, orgId, "task_generation");
  const generationPrompt = resolveTemplate(template.content, {
    USER_PROMPT: description.trim(),
    SCHEMA: schema,
    WORKSPACE_CONTEXT: workspaceContext,
  });

  const taskGenerationMetadata = {
    created_by_session: ctx.sessionId,
  };

  // create a job (same mechanism as /api/tasks/generate)
  const job = createJob(
    "task",
    {
      prompt: generationPrompt,
      workspacePath: authorizedWorkspacePath,
      taskGenerationMetadata,
      ...(autoRun === true ? { autoRun: true } : {}),
    },
    undefined,
    undefined,
    ctx.userId,
    namespaceId,
  );

  await startGenerationChainRun({
    request: req,
    namespaceId,
    orgId,
    kind: "task",
    job,
    prompt: generationPrompt,
    workspacePath: authorizedWorkspacePath,
    metadata: {
      createdBySession: ctx.sessionId,
    },
  });

  // poll the job until complete or timed out (server-side — agent waits on this response)
  const deadline = Date.now() + JOB_TIMEOUT_MS;
  let generated: GeneratedTask | null = null;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, JOB_POLL_INTERVAL_MS));
    const current = getJob(job.id, namespaceId);
    if (!current) break;
    if (current.status === "complete" && current.result) {
      generated = current.result as unknown as GeneratedTask;
      break;
    }
    if (current.status === "failed") {
      return new NextResponse(
        JSON.stringify({ error: current.error || "generation failed" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  if (!generated) {
    return new NextResponse(
      JSON.stringify({ error: "generation timed out" }),
      { status: 504, headers: { "Content-Type": "application/json" } },
    );
  }

  const result = importGeneratedTaskTree({
    namespaceId,
    orgId,
    generated,
    workspacePath: authorizedWorkspacePath || undefined,
    createdBy: "mentiko-mcp",
    generationJobId: job.id,
    metadata: taskGenerationMetadata,
    autoRun: autoRun === true,
  });

  if (autoRun === true && process.env.BETTER_AUTH_SECRET) {
    void fetch(internalApiUrl("/api/tasks/auto-run", req.url), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.BETTER_AUTH_SECRET}`,
        "x-namespace-id": namespaceId,
        "x-org-id": orgId,
      },
      body: JSON.stringify({}),
    }).catch(() => {
      // background worker will pick this up on its next poll
    });
  }

  return NextResponse.json(result);
}
