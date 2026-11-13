import { NextResponse } from "next/server";
import { requireOpsAuth, requireOpsPermission } from "@/lib/ai-engine/mentiko-mcp-ops-auth";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { taskMergeMeta } from "@/lib/tasks/task-store";
import { writeLog } from "@/lib/system/system-logger";
import { pty } from "@/lib/pty/pty-client";
import { resolveLinkRunsDir } from "@/lib/links/link-run-runtime";
import { checkRunAccessForUser, normalizeRunId } from "@/lib/auth/run-acl";
import { isNonExecutionRun } from "@/lib/runs/run-provenance";
import type { RunStatusReason } from "@/lib/runs/run-record";
import { updateRunJsonRecord } from "@/lib/runner-v2/run-state";

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

  let cancelled = false;
  const updatedRun = updateRunJsonRecord(metaPath, (current) => {
    if (!current) throw new Error(`run.json not found: ${safeRunId}`);
    if (current.status !== "running" && current.status !== "pending") return current;
    cancelled = true;
    const runReason = { actor: "user", reason: "cancelled via mentiko MCP ops" };
    const agentReason = { actor: "user", reason: "run cancelled via mentiko MCP ops" };
    return {
      ...current,
      status: "cancelled",
      completed: new Date().toISOString(),
      statusReason: runReason,
      agents: Array.isArray(current.agents)
        ? current.agents.map((agent) => {
          if (!agent || typeof agent !== "object" || Array.isArray(agent)) return agent;
          const record = agent as Record<string, unknown>;
          if (record.status !== "running" && record.status !== "pending") return record;
          return { ...record, status: "cancelled", statusReason: agentReason };
        })
        : current.agents,
    };
  });
  if (!cancelled) return new NextResponse("Run is not active", { status: 409 });

  const finalRun = updatedRun as RunObject;
  writeLog(ctx.namespaceId, ctx.orgId, "warn", "mcp-ops", `run ${safeRunId} cancelled`, `chain: ${finalRun.chain || "unknown"}`);

  if (finalRun.taskId && finalRun.id && !isNonExecutionRun(finalRun)) {
    try {
      taskMergeMeta(ctx.orgId, finalRun.taskId, { last_run_status: "cancelled", last_run_id: finalRun.id }, ctx.namespaceId);
    } catch {
      // best effort
    }
  }

  return NextResponse.json({ ok: true, runId: safeRunId });
}
