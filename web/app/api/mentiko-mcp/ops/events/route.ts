import { NextResponse } from "next/server";
import { requireOpsAuth, requireOpsPermission } from "@/lib/ai-engine/mentiko-mcp-ops-auth";
import { orgPath } from "@/lib/config";
import { emitRunnerEvent, type RunnerEventScope } from "@/lib/runner-v2/event-emitter";

export const dynamic = "force-dynamic";

/**
 * POST /api/mentiko-mcp/ops/events
 *
 * Emit a runner event server-side under the caller's verified identity. The write
 * is the existing `emitRunnerEvent`; what changes is who decides where it lands —
 * namespace and org come from the token claims (ctx), not process.env. This is the
 * `mentiko emit` completion protocol: every agent prompt interpolates
 * `mentiko emit <event>` (bootstrap-executor.ts), so routing it here gives every
 * emit caller identity, authorization, and attributable audit for free.
 */
export async function POST(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  const perm = requireOpsPermission(ctx, "manage_chains", "events:emit");
  if (perm) return perm;

  const { scope, event, source, runId, data } = (await req.json().catch(() => ({}))) as {
    scope?: string;
    event?: string;
    source?: string;
    runId?: string;
    data?: string;
  };

  if (!event || typeof event !== "string") {
    return new NextResponse("event required", { status: 400 });
  }

  // ns/org from the token. eventsDir matches the MENTIKO_PROJECT_ROOT startChainRun
  // sets in the agent env (orgPath(ns,org)), so an event written over HTTP and one
  // written by the local fallback land in the exact same place.
  const eventsDir = orgPath(ctx.namespaceId, ctx.orgId, "events");
  try {
    const result = emitRunnerEvent({
      event,
      source: typeof source === "string" ? source : "",
      runId: typeof runId === "string" ? runId : "",
      scope: (scope === "ingress" ? "ingress" : "run") as RunnerEventScope,
      data: typeof data === "string" ? data : "",
      filenameMode: "canonical",
      eventsDir,
    });
    return NextResponse.json({ ok: true, path: result.path, filename: result.filename });
  } catch (error) {
    return new NextResponse(
      `emit failed: ${error instanceof Error ? error.message : String(error)}`,
      { status: 400 },
    );
  }
}
