import { NextResponse } from "next/server";
import { taskCreate, taskList, taskClose } from "@/lib/task-store";
import { requireOpsAuth, requireOpsPermission } from "@/lib/mentiko-mcp-ops-auth";
import { resolveAuthorizedWorkspacePath } from "@/lib/workspace-auth";

/**
 * /api/mentiko-mcp/ops/tasks
 *
 * GET   ?status=...   list tasks
 * POST  {subject, desc?, parentId?}   create task
 * PATCH {id, done?}   mark done (only supported transition for now)
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;

  const { namespaceId, orgId } = ctx;
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || undefined;

  const tasks = taskList(
    orgId,
    status
      ? {
          status: status as
            | "open"
            | "in_progress"
            | "blocked"
            | "closed"
            | "all",
        }
      : undefined,
    undefined,
    namespaceId,
  );
  return NextResponse.json({ tasks });
}

export async function POST(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  const perm = requireOpsPermission(ctx, "manage_tasks", "tasks:write");
  if (perm) return perm;

  const { namespaceId, orgId } = ctx;
  const { subject, desc, parentId, workspacePath } = (await req.json()) as {
    subject?: string;
    desc?: string;
    parentId?: string;
    workspacePath?: string;
  };
  if (!subject) {
    return new NextResponse("subject required", { status: 400 });
  }
  const authorizedWorkspacePath = workspacePath === undefined
    ? undefined
    : resolveAuthorizedWorkspacePath(namespaceId, orgId, workspacePath, ctx.userId);
  if (workspacePath !== undefined && !authorizedWorkspacePath) {
    return new NextResponse("workspacePath is not authorized", { status: 403 });
  }

  const task = taskCreate(
    orgId,
    {
      title: subject,
      description: desc,
      parent_id: parentId,
      created_by: "mentiko-mcp",
      workspace_id: authorizedWorkspacePath,
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
  const { id, done } = (await req.json()) as { id?: string; done?: boolean };
  if (!id) return new NextResponse("id required", { status: 400 });
  if (!done) return new NextResponse("only done:true supported", { status: 400 });

  taskClose(orgId, id, undefined, namespaceId);
  return NextResponse.json({ ok: true, id });
}
