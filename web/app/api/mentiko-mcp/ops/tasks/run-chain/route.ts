import { NextResponse } from "next/server";
import { requireOpsAuth, requireOpsPermission } from "@/lib/ai-engine/mentiko-mcp-ops-auth";

export const dynamic = "force-dynamic";
const SAFE_TASK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * POST /api/mentiko-mcp/ops/tasks/run-chain
 * Run a task's ASSIGNED chain the tied way. Delegates to /api/tasks/[id]/run-chain
 * (writes last_run_id back onto the task, sets it in_progress, injects the full task
 * context as the agent prompt, reads the chain binding from the task's metadata) using
 * the trusted internal service bearer accepted by the auth bridge.
 *
 * This is the MCP equivalent of the task UI "Run chain" button — distinct from
 * start_run, which runs a chain by id with an ad-hoc prompt and does NOT tie to a task.
 */
export async function POST(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  const perm = requireOpsPermission(ctx, "manage_tasks", "tasks:run-chain");
  if (perm) return perm;

  const { namespaceId, orgId } = ctx;
  const { taskId, workspaceId, workspacePath } = (await req.json()) as {
    taskId?: string;
    workspaceId?: string;
    workspacePath?: string;
  };

  if (!taskId) return new NextResponse("taskId required", { status: 400 });
  if (!SAFE_TASK_ID_RE.test(taskId)) {
    return new NextResponse("invalid taskId", { status: 400 });
  }

  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    return new NextResponse("BETTER_AUTH_SECRET required for MCP run_task_chain", { status: 500 });
  }

  const res = await fetch(
    `${new URL(req.url).origin}/api/tasks/${encodeURIComponent(taskId)}/run-chain`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
        "x-namespace-id": namespaceId,
        "x-org-id": orgId,
      },
      body: JSON.stringify({
        ...(workspaceId ? { workspaceId } : {}),
        ...(workspacePath ? { workspacePath } : {}),
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    return new NextResponse(`Failed to run task chain: ${text}`, { status: res.status });
  }

  const data = await res.json();
  const runId = data?.data?.runId || data?.runId || data?.data?.run?.id;
  return NextResponse.json({ runId });
}
