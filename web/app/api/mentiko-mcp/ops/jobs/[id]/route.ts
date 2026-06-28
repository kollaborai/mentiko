import { NextResponse } from "next/server";
import { requireOpsAuth } from "@/lib/ai-engine/mentiko-mcp-ops-auth";
import { getJob } from "@/lib/runs/job-store";

export const dynamic = "force-dynamic";

/**
 * GET /api/mentiko-mcp/ops/jobs/[id]
 *
 * Generic poll primitive for async generation jobs (task gen, and any future
 * generate-style op that returns a { jobId, runId } handle). Returns the job
 * record — `status` (pending|running|complete|failed), and on completion
 * `result` (which for task generation carries the created `parentId` /
 * `createdTaskIds`), plus `runId` / `error`.
 *
 * Scoped to the session's namespace via requireOpsAuth; jobs are namespaced.
 */
export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await context.params;
  const job = getJob(id, ctx.namespaceId);
  if (!job) {
    return new NextResponse("job not found", { status: 404 });
  }
  return NextResponse.json({ job });
}
