import { NextResponse } from "next/server";
import { taskAddDep, taskRemoveDep, taskGetAllDeps } from "@/lib/tasks/task-store";
import { requireOpsAuth, requireOpsPermission } from "@/lib/ai-engine/mentiko-mcp-ops-auth";

/**
 * /api/mentiko-mcp/ops/tasks/deps
 *
 * GET                            list all dependency edges in the org
 * POST   {taskId, dependsOnId}   add edge: taskId depends on / is blocked by dependsOnId
 * DELETE ?taskId=&dependsOnId=   remove that edge
 *
 * Direction matches the store: a task unblocks when everything it depends on
 * (its dependsOnId targets) is closed (see taskDepsAllClosed).
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;

  const { namespaceId, orgId } = ctx;
  return NextResponse.json({ dependencies: taskGetAllDeps(orgId, namespaceId) });
}

export async function POST(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  const perm = requireOpsPermission(ctx, "manage_tasks", "tasks:write");
  if (perm) return perm;

  const { namespaceId, orgId } = ctx;
  const { taskId, dependsOnId } = (await req.json()) as {
    taskId?: string;
    dependsOnId?: string;
  };
  if (!taskId || !dependsOnId) {
    return new NextResponse("taskId and dependsOnId required", { status: 400 });
  }
  if (taskId === dependsOnId) {
    return new NextResponse("a task cannot depend on itself", { status: 400 });
  }
  try {
    taskAddDep(orgId, taskId, dependsOnId, namespaceId);
  } catch (e) {
    return new NextResponse((e as Error).message || "failed to add dependency", {
      status: 400,
    });
  }
  return NextResponse.json({ ok: true, taskId, dependsOnId });
}

export async function DELETE(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  const perm = requireOpsPermission(ctx, "manage_tasks", "tasks:write");
  if (perm) return perm;

  const { namespaceId, orgId } = ctx;
  const sp = new URL(req.url).searchParams;
  const taskId = sp.get("taskId");
  const dependsOnId = sp.get("dependsOnId");
  if (!taskId || !dependsOnId) {
    return new NextResponse("taskId and dependsOnId required", { status: 400 });
  }
  try {
    taskRemoveDep(orgId, taskId, dependsOnId, namespaceId);
  } catch (e) {
    return new NextResponse((e as Error).message || "failed to remove dependency", {
      status: 400,
    });
  }
  return NextResponse.json({ ok: true, taskId, dependsOnId });
}
