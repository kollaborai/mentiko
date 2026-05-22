import { NextResponse } from "next/server";
import { requireOpsAuth, requireOpsPermission } from "@/lib/mentiko-mcp-ops-auth";
import { createJob, getJob } from "@/lib/job-store";
import { _getDb, taskCreate, taskAddDep } from "@/lib/task-store";
import { getTaskSchema } from "@/lib/schema-loader";
import { getTemplate } from "@/lib/generation-template-storage";
import { resolveTemplate } from "@/lib/template-resolver";
import { launchJobRunner } from "@/lib/job-runner-launch";
import { resolveAuthorizedWorkspacePath } from "@/lib/workspace-auth";
import { internalApiUrl } from "@/lib/internal-web-origin";

export const dynamic = "force-dynamic";

// AI models sometimes return acceptance_criteria as a string array instead of a string.
// Join to a single string so it doesn't get spread as extra params into the SQLite .run() call.
function normalizeTextOrArray(val: string | string[] | undefined | null): string | undefined {
  if (!val) return undefined;
  if (Array.isArray(val)) return val.join("\n");
  return val;
}

const JOB_POLL_INTERVAL_MS = 1000;
const JOB_TIMEOUT_MS = 120_000;

interface GeneratedSubtask {
  title: string;
  description?: string;
  type: string;
  priority: number;
  acceptance_criteria?: string | string[];
  labels?: string[];
  depends_on?: number[];
}

interface GeneratedTask {
  title: string;
  description?: string;
  type: string;
  priority: number;
  acceptance_criteria?: string | string[];
  design?: string;
  design_notes?: string | string[];
  notes?: string;
  labels?: string[];
  subtasks?: GeneratedSubtask[];
}

interface CreatedTaskSummary {
  id: string;
  title: string;
  type: string;
  priority: number;
}

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

  // create a job (same mechanism as /api/tasks/generate)
  const job = createJob("task", { prompt: generationPrompt, workspacePath: authorizedWorkspacePath }, undefined, undefined, ctx.userId, namespaceId);

  launchJobRunner({ job, namespaceId, orgId });

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

  const traceMetadata = {
    created_by_session: ctx.sessionId,
    ...(autoRun === true ? { auto_run: true } : {}),
  };

  // Atomically create the full task tree using the task store.
  const createTree = _getDb(namespaceId).transaction(() => {
    const parentIssueType = (generated.subtasks?.length ? "epic" : generated.type) as
      | "epic" | "feature" | "task" | "bug" | "chore";

    const parent = taskCreate(
      orgId,
      {
        title: generated.title,
        description: generated.description ?? "",
        issue_type: parentIssueType,
        priority: generated.priority,
        labels: generated.labels,
        acceptance_criteria: normalizeTextOrArray(generated.acceptance_criteria),
        design: normalizeTextOrArray(generated.design ?? generated.design_notes),
        notes: generated.notes,
        created_by: "mentiko-mcp",
        workspace_id: authorizedWorkspacePath || undefined,
        metadata: traceMetadata,
      },
      namespaceId,
    );

    const created: CreatedTaskSummary[] = [
      { id: parent.id, title: parent.title, type: parent.issue_type, priority: parent.priority },
    ];

    const subtaskIds: string[] = [];

    if (generated.subtasks?.length) {
      for (const st of generated.subtasks) {
        const child = taskCreate(
          orgId,
          {
            title: st.title,
            description: st.description ?? "",
            issue_type: (st.type as "feature" | "task" | "bug" | "chore") ?? "task",
            priority: st.priority,
            labels: st.labels,
            acceptance_criteria: normalizeTextOrArray(st.acceptance_criteria),
            parent_id: parent.id,
            created_by: "mentiko-mcp",
            workspace_id: authorizedWorkspacePath || undefined,
            metadata: traceMetadata,
          },
          namespaceId,
        );
        subtaskIds.push(child.id);
        created.push({ id: child.id, title: child.title, type: child.issue_type, priority: child.priority });
      }

      for (let i = 0; i < generated.subtasks.length; i++) {
        const deps = generated.subtasks[i].depends_on;
        if (!deps?.length) continue;
        const fromId = subtaskIds[i];
        if (!fromId) continue;
        for (const depIdx of deps) {
          const toId = subtaskIds[depIdx];
          if (!toId) continue;
          taskAddDep(orgId, fromId, toId, namespaceId, authorizedWorkspacePath || undefined);
        }
      }
    }

    return { parentId: parent.id, tasks: created };
  });

  const result = createTree();

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
