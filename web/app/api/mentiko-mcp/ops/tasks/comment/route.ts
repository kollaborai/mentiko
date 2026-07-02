import { NextResponse } from "next/server";
import { taskAddComment, taskGetComments } from "@/lib/tasks/task-store";
import { requireOpsAuth, requireOpsPermission } from "@/lib/ai-engine/mentiko-mcp-ops-auth";

/**
 * /api/mentiko-mcp/ops/tasks/comment
 *
 * GET  ?id=TASK-123   list comments on a task
 * POST {id, text}     add a comment (author = the authenticated caller)
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;

  const { namespaceId, orgId } = ctx;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return new NextResponse("id required", { status: 400 });
  return NextResponse.json({ comments: taskGetComments(orgId, id, namespaceId) });
}

export async function POST(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  const perm = requireOpsPermission(ctx, "manage_tasks", "tasks:write");
  if (perm) return perm;

  const { namespaceId, orgId } = ctx;
  const { id, text } = (await req.json()) as { id?: string; text?: string };
  if (!id) return new NextResponse("id required", { status: 400 });
  if (!text || !text.trim()) return new NextResponse("text required", { status: 400 });

  // Author is the authenticated MCP identity, not a generic channel label.
  taskAddComment(orgId, id, ctx.userId, text, namespaceId);
  return NextResponse.json({
    ok: true,
    id,
    comments: taskGetComments(orgId, id, namespaceId),
  });
}
