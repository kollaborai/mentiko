import { NextResponse } from "next/server";
import { requireOpsAuth, requireOpsPermission } from "@/lib/mentiko-mcp-ops-auth";
import {
  addSchedule,
  calculateAndStoreNextRun,
  getSchedule,
  listSchedules,
  removeSchedule,
  slugify,
  updateSchedule,
} from "@/lib/schedule-storage";
import { validateSchedule } from "@/lib/validators";
import { requiresElevatedScheduleTargetPermission, validateScheduleTarget } from "@/lib/schedule-targets";
import type { Schedule, ScheduleTarget, ScheduleTrigger } from "@/lib/types";

export const dynamic = "force-dynamic";

function requireElevatedTargetPermission(ctx: Awaited<ReturnType<typeof requireOpsAuth>>, target: ScheduleTarget | undefined) {
  if (ctx instanceof NextResponse) return ctx;
  if (!requiresElevatedScheduleTargetPermission(target)) return null;
  return requireOpsPermission(ctx, "manage_org", ["raw_exec:write", "applications:write"]);
}

export async function GET(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;

  const schedules = await listSchedules(ctx.namespaceId, ctx.orgId);
  return NextResponse.json({ schedules });
}

export async function POST(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  const perm = requireOpsPermission(ctx, "manage_chains", "schedules:write");
  if (perm) return perm;

  const body = await req.json();
  const schedule = buildSchedule(body);

  const validation = validateSchedule(schedule);
  if (!validation.valid) {
    return NextResponse.json({ errors: validation.errors }, { status: 400 });
  }

  if (schedule.target) {
    const targetErrors = validateScheduleTarget(schedule.target);
    if (targetErrors.length > 0) {
      return NextResponse.json({ errors: targetErrors }, { status: 400 });
    }
  }
  const elevatedPerm = requireElevatedTargetPermission(ctx, schedule.target);
  if (elevatedPerm) return elevatedPerm;

  await addSchedule(ctx.namespaceId, ctx.orgId, schedule);
  if (!schedule.trigger || schedule.trigger.type === "cron") {
    const nextRun = await calculateAndStoreNextRun(ctx.namespaceId, ctx.orgId, schedule.id);
    if (nextRun) {
      schedule.nextRun = nextRun;
      schedule.nextRunAt = nextRun;
    }
  }
  return NextResponse.json({ schedule });
}

export async function PATCH(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  const perm = requireOpsPermission(ctx, "manage_chains", "schedules:write");
  if (perm) return perm;

  const body = await req.json() as { id?: string; target?: ScheduleTarget };
  if (!body.id) return new NextResponse("id required", { status: 400 });

  const existing = await getSchedule(ctx.namespaceId, ctx.orgId, body.id);
  if (!existing) return new NextResponse("schedule not found", { status: 404 });

  if (body.target) {
    const targetErrors = validateScheduleTarget(body.target);
    if (targetErrors.length > 0) {
      return NextResponse.json({ errors: targetErrors }, { status: 400 });
    }
  }
  const elevatedPerm = requireElevatedTargetPermission(ctx, body.target || existing.target);
  if (elevatedPerm) return elevatedPerm;

  const updates = { ...body };
  delete updates.id;
  const updated = await updateSchedule(ctx.namespaceId, ctx.orgId, body.id, updates);
  return NextResponse.json({ schedule: updated });
}

export async function DELETE(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  const perm = requireOpsPermission(ctx, "manage_chains", "schedules:write");
  if (perm) return perm;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return new NextResponse("id required", { status: 400 });

  const existing = await getSchedule(ctx.namespaceId, ctx.orgId, id);
  if (!existing) return new NextResponse("schedule not found", { status: 404 });
  const elevatedPerm = requireElevatedTargetPermission(ctx, existing.target);
  if (elevatedPerm) return elevatedPerm;

  await removeSchedule(ctx.namespaceId, ctx.orgId, id);
  return NextResponse.json({ ok: true, id });
}

function buildSchedule(body: Record<string, unknown>): Schedule {
  const target = body.target as ScheduleTarget | undefined;
  const trigger = body.trigger as ScheduleTrigger | undefined;
  const cron = String(body.cron || body.schedule || (trigger?.type === "cron" ? trigger.cron : ""));
  const timezone = String(body.timezone || (trigger?.type === "cron" ? trigger.timezone : "UTC"));
  const fallbackName = target ? targetLabel(target) : String(body.chainName || body.chainId || "schedule");
  const name = String(body.name || fallbackName);
  const id = String(body.id || `${slugify(name)}-${Date.now().toString(36)}`);
  const compat = target ? compatChainFieldsFromTarget(target, id) : {
    chainId: String(body.chainId || id),
    chainName: String(body.chainName || body.chainId || name),
  };
  const now = new Date().toISOString();

  return {
    id,
    name,
    chainId: compat.chainId,
    chainName: compat.chainName,
    target: target || { type: "chain_run", chainId: compat.chainId },
    trigger: trigger || { type: "cron", cron, timezone },
    jobGroupId: typeof body.jobGroupId === "string" ? body.jobGroupId : undefined,
    workspaceId: typeof body.workspaceId === "string" ? body.workspaceId : undefined,
    cron,
    timezone,
    enabled: body.enabled === undefined ? true : body.enabled === true,
    status: body.enabled === false ? "disabled" : "enabled",
    goal: typeof body.goal === "string" ? body.goal : undefined,
    description: typeof body.description === "string" ? body.description : undefined,
    retryCount: typeof body.retryCount === "number" ? Math.max(0, Math.floor(body.retryCount)) : 0,
    runCount: 0,
    snoozedUntil: null,
    lastRun: null,
    nextRun: null,
    createdAt: now,
    updatedAt: now,
  };
}

function compatChainFieldsFromTarget(target: ScheduleTarget, fallbackId: string): { chainId: string; chainName: string } {
  if (target.type === "chain_run") return { chainId: target.chainId, chainName: target.chainId };
  return { chainId: fallbackId, chainName: targetLabel(target) };
}

function targetLabel(target: ScheduleTarget): string {
  switch (target.type) {
    case "chain_run":
      return target.chainId;
    case "generate_tasks":
      return "Generate Tasks";
    case "run_task":
      return `Run Task ${target.taskId}`;
    case "registered_app":
      return `App ${target.appId}`;
    case "raw_exec":
      return `Raw Exec ${target.executable}`;
  }
}
