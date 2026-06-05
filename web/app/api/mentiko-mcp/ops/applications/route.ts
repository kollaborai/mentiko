import { NextResponse } from "next/server";
import { requireOpsAuth, requireOpsPermission } from "@/lib/ai-engine/mentiko-mcp-ops-auth";
import {
  getScheduledApplication,
  listScheduledApplications,
  removeScheduledApplication,
  upsertScheduledApplication,
  type ScheduledApplication,
} from "@/lib/schedules/scheduled-application-storage";
import { validateScheduleTarget } from "@/lib/schedules/schedule-targets";
import { slugify } from "@/lib/schedules/schedule-storage";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;

  return NextResponse.json({
    applications: listScheduledApplications(ctx.namespaceId, ctx.orgId),
  });
}

export async function POST(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  const perm = requireOpsPermission(ctx, "manage_org", "applications:write");
  if (perm) return perm;

  const body = await req.json() as Partial<ScheduledApplication>;
  const app = buildApplication(body);
  const errors = validateScheduleTarget({
    type: "raw_exec",
    executable: app.executable,
    args: app.args,
    workingDirectory: app.workingDirectory,
    env: app.env,
    timeoutMs: app.timeoutMs,
    successExitCodes: app.successExitCodes,
  });
  if (errors.length > 0) {
    return NextResponse.json({ errors }, { status: 400 });
  }

  const stored = upsertScheduledApplication(ctx.namespaceId, ctx.orgId, app);
  return NextResponse.json({ application: stored });
}

export async function PATCH(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  const perm = requireOpsPermission(ctx, "manage_org", "applications:write");
  if (perm) return perm;

  const body = await req.json() as Partial<ScheduledApplication> & { id?: string };
  if (!body.id) return new NextResponse("id required", { status: 400 });

  const existing = getScheduledApplication(ctx.namespaceId, ctx.orgId, body.id);
  if (!existing) return new NextResponse("application not found", { status: 404 });

  const app = buildApplication({ ...existing, ...body });
  const errors = validateScheduleTarget({
    type: "raw_exec",
    executable: app.executable,
    args: app.args,
    workingDirectory: app.workingDirectory,
    env: app.env,
    timeoutMs: app.timeoutMs,
    successExitCodes: app.successExitCodes,
  });
  if (errors.length > 0) {
    return NextResponse.json({ errors }, { status: 400 });
  }

  const stored = upsertScheduledApplication(ctx.namespaceId, ctx.orgId, app);
  return NextResponse.json({ application: stored });
}

export async function DELETE(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  const perm = requireOpsPermission(ctx, "manage_org", "applications:write");
  if (perm) return perm;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return new NextResponse("id required", { status: 400 });

  removeScheduledApplication(ctx.namespaceId, ctx.orgId, id);
  return NextResponse.json({ ok: true, id });
}

function buildApplication(body: Partial<ScheduledApplication>): ScheduledApplication {
  const name = body.name || body.id || "application";
  const id = body.id || slugify(name);
  return {
    id,
    name,
    description: body.description,
    executable: body.executable || "",
    args: Array.isArray(body.args) ? body.args : [],
    workingDirectory: body.workingDirectory,
    env: body.env,
    timeoutMs: body.timeoutMs,
    successExitCodes: body.successExitCodes,
  };
}
