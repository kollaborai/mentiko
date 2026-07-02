import { NextResponse } from "next/server";
import {
  taskCreate,
  taskList,
  taskCount,
  taskClose,
  taskUpdate,
  taskGet,
  taskGetAllDeps,
  taskGetComments,
} from "@/lib/tasks/task-store";
import type { TaskListFilter, TaskRecord, TaskUpdateFields } from "@/lib/tasks/task-store-types";
import { requireOpsAuth, requireOpsPermission } from "@/lib/ai-engine/mentiko-mcp-ops-auth";
import { resolveAuthorizedWorkspacePath } from "@/lib/auth/workspace-auth";

/**
 * /api/mentiko-mcp/ops/tasks
 *
 * GET   ?status=...     list tasks (summary fields, paginated). Paging params:
 *                      limit (1-200, default 50), offset (default 0), query
 *                      (title substring). Returns { tasks, total, limit, offset, has_more }.
 *                      Use the ?id= read for a single task's full record.
 * GET   ?id=TASK-123    single task + dependencies + dependents + comments
 * POST  {subject, desc?, parentId?, workspacePath?, issue_type?, priority?,
 *        owner?, assignee?, labels?, notes?, acceptance_criteria?, design?,
 *        estimated_minutes?, due_at?}   create task (owner defaults to the caller)
 * PATCH {id, done:true}                 close task (back-compat with mark_task_done)
 * PATCH {id, ...TaskUpdateFields}       update task fields
 */

export const dynamic = "force-dynamic";

// Fields the store's taskUpdate() accepts. Kept in sync with TaskUpdateFields.
const UPDATABLE_FIELDS = [
  "title",
  "description",
  "status",
  "priority",
  "assignee",
  "acceptance_criteria",
  "design",
  "notes",
  "labels",
  "metadata",
  "estimated_minutes",
  "due_at",
  "workspace_id",
] as const;

export async function GET(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;

  const { namespaceId, orgId } = ctx;
  const { searchParams } = new URL(req.url);

  // Single-task read: full record + dependency edges + comments.
  const id = searchParams.get("id");
  if (id) {
    const task = taskGet(orgId, id, namespaceId);
    if (!task) return new NextResponse("task not found", { status: 404 });
    const allDeps = taskGetAllDeps(orgId, namespaceId);
    return NextResponse.json({
      task,
      // dependencies = tasks THIS task depends on (its blockers)
      dependencies: allDeps.filter((d) => d.task_id === id),
      // dependents = tasks that depend on THIS task
      dependents: allDeps.filter((d) => d.depends_on_id === id),
      comments: taskGetComments(orgId, id, namespaceId),
    });
  }

  // List path: bounded, summarized, paginated. Returning full records here
  // was sending hundreds of KB (every task's description/notes/design/AC).
  // Agents get a summary list, then call get_task (?id=) for full detail.
  const status = searchParams.get("status") || undefined;
  const query = searchParams.get("query") || undefined;
  const rawLimit = Number(searchParams.get("limit"));
  const rawOffset = Number(searchParams.get("offset"));
  // Default 50, clamp to [1, 200] so a caller can't re-bloat the response.
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(Math.max(Math.floor(rawLimit), 1), 200)
    : 50;
  const offset = Number.isFinite(rawOffset) && rawOffset > 0
    ? Math.floor(rawOffset)
    : 0;

  const filter: TaskListFilter = { limit, offset };
  if (status) filter.status = status;
  if (query) filter.query = query;

  const tasks = taskList(orgId, filter, undefined, namespaceId);
  const total = taskCount(orgId, filter, undefined, namespaceId);
  return NextResponse.json({
    tasks: tasks.map(toTaskSummary),
    total,
    limit,
    offset,
    has_more: offset + tasks.length < total,
  });
}

// List-view projection: drops the heavy text columns (description, notes,
// acceptance_criteria, design) and metadata, which are the size offenders.
// Full record is available via the ?id= read / get_task.
function toTaskSummary(t: TaskRecord) {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    issue_type: t.issue_type,
    owner: t.owner,
    assignee: t.assignee,
    parent_id: t.parent_id,
    labels: t.labels,
    workspace_id: t.workspace_id,
    estimated_minutes: t.estimated_minutes,
    due_at: t.due_at,
    created_at: t.created_at,
    updated_at: t.updated_at,
    dependency_count: t.dependency_count,
    dependent_count: t.dependent_count,
    comment_count: t.comment_count,
  };
}

export async function POST(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  const perm = requireOpsPermission(ctx, "manage_tasks", "tasks:write");
  if (perm) return perm;

  const { namespaceId, orgId } = ctx;
  const body = (await req.json()) as {
    subject?: string;
    desc?: string;
    parentId?: string;
    workspacePath?: string;
    issue_type?: string;
    priority?: number;
    owner?: string;
    assignee?: string;
    labels?: string[];
    notes?: string;
    acceptance_criteria?: string;
    design?: string;
    estimated_minutes?: number;
    due_at?: string;
  };
  if (!body.subject) {
    return new NextResponse("subject required", { status: 400 });
  }
  const authorizedWorkspacePath =
    body.workspacePath === undefined
      ? undefined
      : resolveAuthorizedWorkspacePath(namespaceId, orgId, body.workspacePath, ctx.userId);
  if (body.workspacePath !== undefined && !authorizedWorkspacePath) {
    return new NextResponse("workspacePath is not authorized", { status: 403 });
  }

  const task = taskCreate(
    orgId,
    {
      title: body.subject,
      description: body.desc,
      parent_id: body.parentId,
      workspace_id: authorizedWorkspacePath,
      issue_type: body.issue_type,
      priority: body.priority,
      // The authenticated MCP identity owns the task unless an explicit owner is given.
      owner: body.owner ?? ctx.userId,
      assignee: body.assignee,
      labels: body.labels,
      notes: body.notes,
      acceptance_criteria: body.acceptance_criteria,
      design: body.design,
      estimated_minutes: body.estimated_minutes,
      due_at: body.due_at,
      created_by: "mentiko-mcp",
    },
    namespaceId,
  );
  return NextResponse.json({ task });
}

export async function PATCH(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  const perm = requireOpsPermission(ctx, "manage_tasks", "tasks:write");
  if (perm) return perm;

  const { namespaceId, orgId } = ctx;
  const body = (await req.json()) as Record<string, unknown> & {
    id?: string;
    done?: boolean;
  };
  const id = body.id;
  if (!id) return new NextResponse("id required", { status: 400 });

  // Back-compat: mark_task_done sends { id, done: true }.
  if (body.done === true) {
    taskClose(orgId, id, undefined, namespaceId);
    return NextResponse.json({ ok: true, id, closed: true });
  }

  const fields: TaskUpdateFields = {};
  for (const key of UPDATABLE_FIELDS) {
    if (key in body && body[key] !== undefined) {
      (fields as Record<string, unknown>)[key] = body[key];
    }
  }

  // If workspace_id is being reassigned, authorize the target path first.
  if (fields.workspace_id !== undefined && fields.workspace_id !== null) {
    const authorized = resolveAuthorizedWorkspacePath(
      namespaceId,
      orgId,
      fields.workspace_id,
      ctx.userId,
    );
    if (!authorized) {
      return new NextResponse("workspace_id is not authorized", { status: 403 });
    }
    fields.workspace_id = authorized;
  }

  if (Object.keys(fields).length === 0) {
    return new NextResponse("no updatable fields provided", { status: 400 });
  }

  taskUpdate(orgId, id, fields, namespaceId);
  return NextResponse.json({ ok: true, id, task: taskGet(orgId, id, namespaceId) });
}
