import { NextRequest } from "next/server";
import { BadRequest, Conflict, NotFound, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import config from "@/lib/config";
import { existsSync } from "fs";
import { join } from "path";
import { getNamespaceConfig, getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { checkAuth } from "@/lib/api-auth";
import { requirePermission } from "@/lib/rbac-auth";
import { enforceGuestWrites } from "@/lib/middleware";
import { spawn } from "child_process";
import { validateSchedule } from "@/lib/validators";
import { checkScheduleConflicts } from "@/lib/schedule-utils";
import { canExecute, incrementActiveRuns, decrementActiveRuns } from "@/lib/circuit-breaker";
import { buildChildEnv } from "@/lib/child-env";
import {
  requiresElevatedScheduleTargetPermission,
  scheduleMatchesWorkspace,
  validateScheduleTarget,
} from "@/lib/schedule-targets";
import {
  listSchedules,
  getSchedule,
  updateSchedule,
  migrateFromChainConfigs,
  calculateAndStoreNextRun,
  addSchedule,
  removeSchedule,
  slugify,
} from "@/lib/schedule-storage";
import { listWorkspaces, getWorkspace } from "@/lib/workspace-storage";
import type { Schedule, ScheduleTarget, ScheduleTrigger } from "@/lib/types";

export const dynamic = "force-dynamic";

async function requireScheduleMutation(req: NextRequest) {
  const perm = await requirePermission(req, "manage_chains");
  if (perm) return perm;

  const blockResult = await enforceGuestWrites(req);
  if (blockResult?.blocked) return blockResult.response;

  return null;
}

async function requireElevatedScheduleTarget(req: NextRequest, target: ScheduleTarget | undefined) {
  if (!requiresElevatedScheduleTargetPermission(target)) return null;
  return await requirePermission(req, "manage_org");
}

// ---------------------------------------------------------------------------
// helpers: map storage Schedule -> frontend ScheduleState
// ---------------------------------------------------------------------------

interface ScheduleResponse {
  id: string;
  name: string;
  chainId: string;
  chainName: string;
  target?: ScheduleTarget;
  trigger?: ScheduleTrigger;
  jobGroupId?: string;
  schedule: string;
  timezone: string;
  enabled: boolean;
  status: "enabled" | "disabled" | "snoozed" | "paused";
  workspaceId?: string;
  goal?: string;
  description?: string;
  retryCount: number;
  snoozedUntil: string | null;
  lastRun: string | null;
  nextRun: string | null;
  avgDuration?: number;
  runCount?: number;
  createdAt?: string;
  conflictDetected?: boolean;
  conflictingChains?: string[];
}

function toResponse(s: Schedule): ScheduleResponse {
  let status: ScheduleResponse["status"] = s.enabled ? "enabled" : "disabled";
  if (s.snoozedUntil && new Date(s.snoozedUntil) > new Date()) {
    status = "snoozed";
  }
  if (s.status === "paused") status = "paused";

  return {
    id: s.id,
    name: s.name,
    chainId: s.chainId,
    chainName: s.chainName || s.name,
    target: s.target,
    trigger: s.trigger,
    jobGroupId: s.jobGroupId,
    schedule: s.cron,
    timezone: s.timezone,
    enabled: s.enabled,
    status,
    workspaceId: s.workspaceId,
    goal: s.goal,
    description: s.description,
    retryCount: s.retryCount || 0,
    snoozedUntil: s.snoozedUntil ?? null,
    lastRun: s.lastRun ?? s.lastRunAt ?? null,
    nextRun: s.nextRun ?? s.nextRunAt ?? null,
    avgDuration: s.avgDuration,
    runCount: s.runCount || 0,
    createdAt: s.createdAt,
  };
}

function addConflictInfo(schedules: ScheduleResponse[]): ScheduleResponse[] {
  // checkScheduleConflicts only reads id, cron, timezone, chainId, chainName, enabled, status
  const forConflict = schedules.map((s) => ({
    id: s.chainId,
    name: s.chainName,
    chainId: s.chainId,
    chainName: s.chainName,
    cron: s.schedule,
    timezone: s.timezone,
    enabled: s.enabled,
    status: s.status,
    retryCount: 0,
    runCount: 0,
    snoozedUntil: s.snoozedUntil,
    lastRun: s.lastRun,
    nextRun: s.nextRun,
  })) as import("@/lib/types").Schedule[];

  const conflicts = checkScheduleConflicts(forConflict, 15);

  return schedules.map((s) => {
    const mine = conflicts.find((c) => c.scheduleId === s.chainId);
    if (mine) {
      return {
        ...s,
        conflictDetected: true,
        conflictingChains: mine.conflictsWith.map((c) => c.chainName),
      };
    }
    return s;
  });
}

// ---------------------------------------------------------------------------
// GET /api/schedules - list all schedules
// ---------------------------------------------------------------------------

export const GET = withErrorHandling(async (req: Request) => {
  if (!(await checkAuth(req))) {
    throw new Unauthorized();
  }

  const nsId = await getNamespaceIdFromRequest(req);
  const orgId = await getOrgIdFromRequest(req);

  // auto-migrate embedded chain configs on first load
  await migrateFromChainConfigs(nsId, orgId);

  const { searchParams } = new URL(req.url);
  const workspace = searchParams.get("workspace");

  let schedules = await listSchedules(nsId, orgId);

  if (workspace) {
    const workspaceRecord = getWorkspace(nsId, orgId, workspace);
    schedules = schedules.filter((s) =>
      scheduleMatchesWorkspace(s, workspace, workspaceRecord?.path)
    );
  }

  const mapped = schedules.map(toResponse);
  return apiSuccess({ schedules: addConflictInfo(mapped) });
});

// ---------------------------------------------------------------------------
// PUT /api/schedules - toggle enabled/disabled
// ---------------------------------------------------------------------------

export const PUT = withErrorHandling(async (req: NextRequest) => {
  const authError = await requireScheduleMutation(req);
  if (authError) return authError;

  const body = await req.json();
  const { id, chainId, enabled } = body;
  const scheduleId = id || chainId;

  if (typeof scheduleId !== "string" || typeof enabled !== "boolean") {
    throw new BadRequest("Invalid request");
  }

  const nsId = await getNamespaceIdFromRequest(req);
  const orgId = await getOrgIdFromRequest(req);

  const schedule = await getSchedule(nsId, orgId, scheduleId);
  if (!schedule) {
    throw new NotFound("Schedule", scheduleId);
  }

  const elevatedError = await requireElevatedScheduleTarget(req, schedule.target);
  if (elevatedError) return elevatedError;

  await updateSchedule(nsId, orgId, scheduleId, {
    enabled,
    status: enabled ? "enabled" : "disabled",
  });

  return apiSuccess({ success: true, enabled });
});

// ---------------------------------------------------------------------------
// PATCH /api/schedules - update cron expression and/or timezone
// ---------------------------------------------------------------------------

export const PATCH = withErrorHandling(async (req: NextRequest) => {
  const authError = await requireScheduleMutation(req);
  if (authError) return authError;

  const body = await req.json();
  const {
    id, chainId: bodyChainId, schedule: cron, timezone, workspacePath,
    name, description, chainId: newChainId, chainName, goal,
    retryCount: retryCountRaw, enabled, target, trigger, jobGroupId,
  } = body;
  const schedId = id || bodyChainId;

  if (!schedId) {
    throw new BadRequest("id or chainId required", { field: "id" });
  }

  const nsId = await getNamespaceIdFromRequest(req);
  const orgId = await getOrgIdFromRequest(req);

  const existing = await getSchedule(nsId, orgId, schedId);
  if (!existing) {
    throw new NotFound("Schedule", schedId);
  }

  // validate if changing cron or timezone
  if (cron || timezone || target) {
    const validation = validateSchedule({
      id: schedId,
      chainId: existing.chainId,
      target: target || existing.target,
      trigger: trigger || existing.trigger,
      cron: cron || existing.cron,
      timezone: timezone || existing.timezone,
      enabled: existing.enabled,
    });
    if (!validation.valid) {
      throw new BadRequest("Invalid schedule", { errors: validation.errors });
    }
  }

  // validate workspace if changing it
  if (workspacePath) {
    const workspaces = listWorkspaces(nsId, orgId);
    if (!workspaces.some((w) => w.id === workspacePath || w.path === workspacePath)) {
      throw new NotFound("Workspace", workspacePath);
    }
  }

  const updates: Partial<Schedule> = {};
  if (cron !== undefined) updates.cron = cron;
  if (timezone !== undefined) updates.timezone = timezone;
  if (workspacePath !== undefined) updates.workspaceId = workspacePath;
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (newChainId !== undefined) updates.chainId = newChainId;
  if (chainName !== undefined) updates.chainName = chainName;
  if (target !== undefined) {
    const targetErrors = validateScheduleTarget(target as ScheduleTarget);
    if (targetErrors.length > 0) {
      throw new BadRequest("Invalid schedule target", { errors: targetErrors });
    }
    const elevatedError = await requireElevatedScheduleTarget(req, target as ScheduleTarget);
    if (elevatedError) return elevatedError;
    updates.target = target as ScheduleTarget;
    const compat = compatChainFieldsFromTarget(target as ScheduleTarget, existing.id);
    updates.chainId = newChainId || compat.chainId;
    updates.chainName = chainName || compat.chainName;
  } else {
    const elevatedError = await requireElevatedScheduleTarget(req, existing.target);
    if (elevatedError) return elevatedError;
  }
  if (trigger !== undefined) updates.trigger = trigger as ScheduleTrigger;
  if (jobGroupId !== undefined) updates.jobGroupId = typeof jobGroupId === "string" ? jobGroupId : undefined;
  if (goal !== undefined) updates.goal = goal;
  if (typeof retryCountRaw === "number") {
    updates.retryCount = Math.max(0, Math.min(3, Math.floor(retryCountRaw)));
  }
  if (typeof enabled === "boolean") {
    updates.enabled = enabled;
    updates.status = enabled ? "enabled" : "disabled";
  }

  const updated = await updateSchedule(nsId, orgId, schedId, updates);

  // recalculate next run if cron/tz changed
  let nextRun: string | null = null;
  if (cron !== undefined || timezone !== undefined) {
    nextRun = await calculateAndStoreNextRun(nsId, orgId, schedId);
  }

  return apiSuccess({
    success: true,
    schedule: toResponse(updated),
    nextRun,
  });
});

// ---------------------------------------------------------------------------
// POST /api/schedules - trigger a scheduled chain now (or create new schedule)
// ---------------------------------------------------------------------------

export const POST = withErrorHandling(async (req: NextRequest) => {
  const authError = await requireScheduleMutation(req);
  if (authError) return authError;

  const body = await req.json();

  // if body has `cron`/`trigger`/`target`, it's a create request
  if (body.cron || body.trigger || body.target) {
    return handleCreate(req, body);
  }

  // otherwise it's a trigger-now request
  const { chainId } = body;

  if (!chainId) {
    throw new BadRequest("chainId required", { field: "chainId" });
  }

  const circuitCheck = canExecute();
  if (!circuitCheck.allowed) {
    throw new Conflict("Execution blocked by circuit breaker", { reason: circuitCheck.reason });
  }

  const nsId = await getNamespaceIdFromRequest(req);
  const orgId = await getOrgIdFromRequest(req);

  const namespaceConfig = await getNamespaceConfig(req);
  const chainPath = join(namespaceConfig.chainsDir, chainId, "chain.json");

  if (!existsSync(chainPath)) {
    throw new NotFound("Chain", chainId);
  }

  incrementActiveRuns();

  const chainRunner = join(config.codeRoot, "lib", "chain-runner.sh");

  const schedEnv = buildChildEnv({
    MENTIKO_GLOBAL_ROOT: config.globalRoot,
    MENTIKO_CODE_ROOT: config.codeRoot,
    MENTIKO_PROJECT_ROOT: config.projectRoot,
    MENTIKO_ORG_ROOT: config.orgRoot,
    MENTIKO_NAMESPACE_ROOT: config.namespaceRoot,
    NAMESPACE_ID: nsId,
    ORG_ID: orgId,
  });
  delete schedEnv.CLAUDECODE;

  // resolve workspace from schedule's workspaceId
  const chainArgs = [chainRunner, chainPath];
  const schedules = await listSchedules(nsId, orgId);
  const matchedSchedule = schedules.find((s) => s.chainId === chainId);
  if (matchedSchedule?.workspaceId) {
    const ws = getWorkspace(nsId, orgId, matchedSchedule.workspaceId);
    if (ws?.path) {
      chainArgs.push("--workspace", ws.path);
    }
  }

  const proc = spawn("bash", chainArgs, {
    detached: true,
    stdio: "ignore",
    env: schedEnv,
  });

  proc.unref();

  proc.on("exit", () => {
    decrementActiveRuns();
  });
  proc.on("error", () => {
    decrementActiveRuns();
  });

  return apiSuccess({
    success: true,
    message: "Chain started",
    pid: proc.pid,
  });
});

async function handleCreate(req: NextRequest, body: Record<string, unknown>) {
  const {
    name: scheduleName, chainId, chainName, cron, timezone, workspacePath, goal,
    retryCount: retryCountRaw, taskBinding: taskBindingRaw, target: rawTarget,
    trigger: rawTrigger, jobGroupId, description, enabled: enabledRaw,
  } = body as {
    name?: string;  // schedule display name
    description?: string;
    chainId?: string;
    chainName?: string;
    cron?: string;
    timezone?: string;
    workspacePath?: string;
    goal?: string;
    retryCount?: number;
    taskBinding?: { taskId: string; title: string };
    target?: ScheduleTarget;
    trigger?: ScheduleTrigger;
    jobGroupId?: string;
    enabled?: boolean;
  };

  const trigger = rawTrigger;
  const resolvedCron = cron || (trigger?.type === "cron" ? trigger.cron : undefined);
  const resolvedTimezone = timezone || (trigger?.type === "cron" ? trigger.timezone : undefined) || "UTC";
  const requiresCron = !trigger || trigger.type === "cron";

  if (!rawTarget && !chainId) {
    throw new BadRequest("chainId or target required");
  }
  if (requiresCron && !resolvedCron) {
    throw new BadRequest("cron required");
  }

  const target = rawTarget || {
    type: "chain_run",
    chainId: chainId as string,
    goal,
    workspaceId: workspacePath,
  } satisfies ScheduleTarget;

  const targetErrors = validateScheduleTarget(target);
  if (targetErrors.length > 0) {
    throw new BadRequest("Invalid schedule target", { errors: targetErrors });
  }
  const elevatedError = await requireElevatedScheduleTarget(req, target);
  if (elevatedError) return elevatedError;

  const validation = validateSchedule({
    id: chainId || "schedule",
    chainId,
    target,
    trigger,
    cron: resolvedCron || "",
    timezone: resolvedTimezone,
    enabled: true,
  });
  if (!validation.valid) {
    throw new BadRequest("Invalid schedule", { errors: validation.errors });
  }

  const nsId = await getNamespaceIdFromRequest(req);
  const orgId = await getOrgIdFromRequest(req);

  // validate workspace exists if provided
  if (workspacePath) {
    const workspaces = listWorkspaces(nsId, orgId);
    if (!workspaces.some((w) => w.id === workspacePath || w.path === workspacePath)) {
      throw new NotFound("Workspace", workspacePath);
    }
  }

  // clamp retryCount to 0-3
  const retryCount = typeof retryCountRaw === "number"
    ? Math.max(0, Math.min(3, Math.floor(retryCountRaw)))
    : 0;
  const scheduleEnabled = typeof enabledRaw === "boolean" ? enabledRaw : true;

  const now = new Date().toISOString();
  const initialCompat = compatChainFieldsFromTarget(target, chainId || "schedule");
  const displayName = (scheduleName as string) || (chainName as string) || initialCompat.chainName;
  const scheduleId = `${slugify(displayName)}-${Date.now().toString(36)}`;
  const compat = compatChainFieldsFromTarget(target, chainId || scheduleId);
  const schedule: Schedule = {
    id: scheduleId,
    name: displayName,
    chainId: chainId || compat.chainId || scheduleId,
    chainName: (chainName as string) || compat.chainName,
    target,
    trigger: trigger || { type: "cron", cron: resolvedCron || "", timezone: resolvedTimezone },
    jobGroupId: typeof jobGroupId === "string" ? jobGroupId : undefined,
    workspaceId: workspacePath as string | undefined,
    cron: resolvedCron || "",
    timezone: resolvedTimezone,
    enabled: scheduleEnabled,
    status: scheduleEnabled ? "enabled" : "disabled",
    goal: goal as string | undefined,
    description: typeof description === "string" && description.trim() ? description.trim() : undefined,
    retryCount,
    taskBinding: taskBindingRaw,
    runCount: 0,
    snoozedUntil: null,
    lastRun: null,
    nextRun: null,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await addSchedule(nsId, orgId, schedule);
    if (!schedule.trigger || schedule.trigger.type === "cron") {
      await calculateAndStoreNextRun(nsId, orgId, schedule.id);
    }
    return apiSuccess({ success: true, schedule: toResponse(schedule) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create schedule";
    throw new Conflict(msg);
  }
}

function compatChainFieldsFromTarget(target: ScheduleTarget, fallbackId: string): { chainId: string; chainName: string } {
  switch (target.type) {
    case "chain_run":
      return { chainId: target.chainId, chainName: target.chainId };
    case "generate_tasks":
      return { chainId: fallbackId, chainName: "Generate Tasks" };
    case "run_task":
      return { chainId: fallbackId, chainName: `Run Task ${target.taskId}` };
    case "registered_app":
      return { chainId: fallbackId, chainName: `App ${target.appId}` };
    case "raw_exec":
      return { chainId: fallbackId, chainName: `Raw Exec ${target.executable}` };
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/schedules - snooze or unsnooze
// ---------------------------------------------------------------------------

export const DELETE = withErrorHandling(async (req: NextRequest) => {
  const authError = await requireScheduleMutation(req);
  if (authError) return authError;

  const { searchParams } = new URL(req.url);
  const scheduleId = searchParams.get("id") || searchParams.get("chainId");
  const action = searchParams.get("action");
  const duration = searchParams.get("duration");

  if (!scheduleId) {
    throw new BadRequest("id or chainId required", { field: "id" });
  }

  if (!action || !["snooze", "unsnooze", "delete"].includes(action)) {
    throw new BadRequest("action must be 'snooze', 'unsnooze', or 'delete'", { field: "action" });
  }

  const nsId = await getNamespaceIdFromRequest(req);
  const orgId = await getOrgIdFromRequest(req);

  const schedule = await getSchedule(nsId, orgId, scheduleId);
  if (!schedule) {
    throw new NotFound("Schedule", scheduleId);
  }

  const elevatedError = await requireElevatedScheduleTarget(req, schedule.target);
  if (elevatedError) return elevatedError;

  if (action === "delete") {
    await removeSchedule(nsId, orgId, scheduleId);
    return apiSuccess({ success: true, deleted: true });
  }

  if (action === "snooze") {
    if (!duration) {
      throw new BadRequest("duration required for snooze", { field: "duration" });
    }

    const until = new Date(Date.now() + parseDuration(duration));
    await updateSchedule(nsId, orgId, scheduleId, {
      snoozedUntil: until.toISOString(),
      status: "snoozed",
    });

    return apiSuccess({
      success: true,
      snoozedUntil: until.toISOString(),
    });
  } else {
    await updateSchedule(nsId, orgId, scheduleId, {
      snoozedUntil: null,
      status: schedule.enabled ? "enabled" : "disabled",
    });

    return apiSuccess({ success: true, unsnoozed: true });
  }
});

function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)(min|h|d|w)?$/);
  if (!match) throw new BadRequest("Invalid duration format. Use format like '30min', '2h', '1d', '1w'");

  const value = parseInt(match[1], 10);
  const unit = match[2] || "min";

  const multipliers: Record<string, number> = {
    min: 60000,
    h: 3600000,
    d: 86400000,
    w: 604800000,
  };

  return value * multipliers[unit];
}
