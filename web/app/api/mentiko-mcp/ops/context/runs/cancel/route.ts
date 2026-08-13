import { NextResponse } from "next/server";
import { requireOpsAuth, requireOpsPermission } from "@/lib/ai-engine/mentiko-mcp-ops-auth";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { taskMergeMeta } from "@/lib/tasks/task-store";
import { writeLog } from "@/lib/system/system-logger";
import { pty } from "@/lib/pty/pty-client";
import { resolveLinkRunsDir } from "@/lib/links/link-run-runtime";
import { checkRunAccessForUser, normalizeRunId } from "@/lib/auth/run-acl";
import { isNonExecutionRun } from "@/lib/runs/run-provenance";
import type { RunStatusReason } from "@/lib/runs/run-record";

export const dynamic = "force-dynamic";

interface RunAgent {
  status?: string;
  session?: string;
  statusReason?: RunStatusReason;
}

interface RunObject {
  id?: string;
  chain?: string;
  status?: string;
  completed?: string;
  taskId?: string;
  agents?: RunAgent[];
  statusReason?: RunStatusReason;
}

/** POST /api/mentiko-mcp/ops/context/runs/cancel — cancel a run by ID */
export async function POST(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  const perm = requireOpsPermission(ctx, "manage_chains", "runs:cancel");
  if (perm) return perm;

  const { runId } = (await req.json()) as { runId?: string };
  const safeRunId = normalizeRunId(runId);
  if (!safeRunId) return new NextResponse("valid runId required", { status: 400 });

  const runsDir = resolveLinkRunsDir(ctx.namespaceId, ctx.orgId);
  const acl = checkRunAccessForUser(ctx.namespaceId, ctx.orgId, ctx.userId, safeRunId, runsDir);
  if (!acl.ok) {
    if (acl.reason === "run-not-found") {
      return new NextResponse(`Run not found: ${safeRunId}`, { status: 404 });
    }
    return new NextResponse("Forbidden", { status: 403 });
  }

  const runDir = join(runsDir, safeRunId);
  const metaPath = join(runDir, "run.json");

  if (!existsSync(metaPath)) {
    return new NextResponse(`Run not found: ${safeRunId}`, { status: 404 });
  }

  const run = JSON.parse(readFileSync(metaPath, "utf-8")) as RunObject;
  if (run.status !== "running" && run.status !== "pending") {
    return new NextResponse("Run is not active", { status: 409 });
  }

  for (const agent of run.agents || []) {
    if (agent.session) {
      await pty.remove(agent.session);
    }
  }

  run.status = "cancelled";
  run.completed = new Date().toISOString();
  run.statusReason = { actor: "user", reason: "cancelled via mentiko MCP ops" };
  for (const agent of run.agents || []) {
    if (agent.status === "running" || agent.status === "pending") {
      agent.status = "cancelled";
      agent.statusReason = { actor: "user", reason: "run cancelled via mentiko MCP ops" };
    }
  }

  writeFileSync(metaPath, JSON.stringify(run, null, 2));
  writeLog(ctx.namespaceId, ctx.orgId, "warn", "mcp-ops", `run ${safeRunId} cancelled`, `chain: ${run.chain || "unknown"}`);

  if (run.taskId && run.id && !isNonExecutionRun(run)) {
    try {
      taskMergeMeta(ctx.orgId, run.taskId, { last_run_status: "cancelled", last_run_id: run.id }, ctx.namespaceId);
    } catch {
      // best effort
    }
  }

  return NextResponse.json({ ok: true, runId: safeRunId });
}
