import { BadRequest, NotFound, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { existsSync } from "fs";
import { promises as fs } from "fs";
import { join } from "path";
import { orgPath } from "@/lib/config";
import type { SnoozeState } from "@/lib/types";
import { checkAuth } from "@/lib/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getSchedule } from "@/lib/schedule-storage";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const SAFE_SCHEDULE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function validateScheduleId(scheduleId: string): boolean {
  return SAFE_SCHEDULE_ID_RE.test(scheduleId);
}

function getSnoozeDir(namespaceId: string, orgId: string, scheduleId: string): string {
  return join(orgPath(namespaceId, orgId, "schedules"), scheduleId);
}

function getSnoozeFilePath(namespaceId: string, orgId: string, scheduleId: string): string {
  return join(getSnoozeDir(namespaceId, orgId, scheduleId), ".snooze");
}

function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)(min|h|d|w)?$/);
  if (!match) {
    throw new BadRequest("Invalid duration format. Use format like '30min', '2h', '1d', '1w'");
  }

  const value = parseInt(match[1], 10);
  const unit = match[2] || "min";

  const multipliers: Record<string, number> = {
    min: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
  };

  return value * multipliers[unit];
}

// ---------------------------------------------------------------------------
// POST /api/schedules/snooze - create snooze state
// ---------------------------------------------------------------------------

export const POST = withErrorHandling(async (req: Request) => {
  if (!(await checkAuth(req))) {
    throw new Unauthorized();
  }

  const body = await req.json();
  const { scheduleId, duration, customMinutes } = body as {
    scheduleId?: string;
    duration?: string;
    customMinutes?: number;
  };

  if (!validateScheduleId(scheduleId || "")) {
    throw new BadRequest("scheduleId is required", { field: "scheduleId" });
  }

  const namespaceId = await getNamespaceIdFromRequest(req);
  const orgId = await getOrgIdFromRequest(req);
  const schedule = await getSchedule(namespaceId, orgId, scheduleId!);
  if (!schedule) {
    throw new NotFound("Schedule", scheduleId);
  }

  if (!duration || typeof duration !== "string") {
    throw new BadRequest("duration is required (e.g., '30min', '2h', '1d')", { field: "duration" });
  }

  if (customMinutes !== undefined && (typeof customMinutes !== "number" || customMinutes <= 0)) {
    throw new BadRequest("customMinutes must be a positive number", { field: "customMinutes" });
  }

  const snoozedAt = new Date().toISOString();
  let snoozedUntil: string;

  if (customMinutes) {
    const ms = customMinutes * 60 * 1000;
    snoozedUntil = new Date(Date.now() + ms).toISOString();
  } else {
    const ms = parseDuration(duration);
    snoozedUntil = new Date(Date.now() + ms).toISOString();
  }

  const snoozeState: SnoozeState = {
    scheduleId: scheduleId!,
    duration,
    customMinutes,
    snoozedUntil,
    snoozedAt,
  };

  const snoozeFilePath = getSnoozeFilePath(namespaceId, orgId, scheduleId!);
  const snoozeDir = getSnoozeDir(namespaceId, orgId, scheduleId!);

  await fs.mkdir(snoozeDir, { recursive: true });
  await fs.writeFile(snoozeFilePath, JSON.stringify(snoozeState, null, 2));

  return apiSuccess({ success: true, snooze: snoozeState });
});

// ---------------------------------------------------------------------------
// GET /api/schedules/snooze - get snooze state
// ---------------------------------------------------------------------------

export const GET = withErrorHandling(async (req: Request) => {
  if (!(await checkAuth(req))) {
    throw new Unauthorized();
  }

  const { searchParams } = new URL(req.url);
  const scheduleId = searchParams.get("scheduleId");

  if (!scheduleId) {
    throw new BadRequest("scheduleId query parameter is required", { field: "scheduleId" });
  }

  if (!validateScheduleId(scheduleId)) {
    throw new BadRequest("Invalid scheduleId format", { field: "scheduleId" });
  }

  const namespaceId = await getNamespaceIdFromRequest(req);
  const orgId = await getOrgIdFromRequest(req);
  const schedule = await getSchedule(namespaceId, orgId, scheduleId);
  if (!schedule) {
    throw new NotFound("Schedule", scheduleId);
  }

  const snoozeFilePath = getSnoozeFilePath(namespaceId, orgId, scheduleId);

  if (!existsSync(snoozeFilePath)) {
    return apiSuccess({ snooze: null });
  }

  const content = await fs.readFile(snoozeFilePath, "utf-8");
  const snoozeState: SnoozeState = JSON.parse(content);

  // Check if snooze has expired
  if (new Date(snoozeState.snoozedUntil) < new Date()) {
    await fs.unlink(snoozeFilePath);
    return apiSuccess({ snooze: null });
  }

  return apiSuccess({ snooze: snoozeState });
});

// ---------------------------------------------------------------------------
// DELETE /api/schedules/snooze - remove snooze state
// ---------------------------------------------------------------------------

export const DELETE = withErrorHandling(async (req: Request) => {
  if (!(await checkAuth(req))) {
    throw new Unauthorized();
  }

  const { searchParams } = new URL(req.url);
  const scheduleId = searchParams.get("scheduleId");

  if (!scheduleId) {
    throw new BadRequest("scheduleId query parameter is required", { field: "scheduleId" });
  }

  if (!validateScheduleId(scheduleId)) {
    throw new BadRequest("Invalid scheduleId format", { field: "scheduleId" });
  }

  const namespaceId = await getNamespaceIdFromRequest(req);
  const orgId = await getOrgIdFromRequest(req);
  const schedule = await getSchedule(namespaceId, orgId, scheduleId);
  if (!schedule) {
    throw new NotFound("Schedule", scheduleId);
  }

  const snoozeFilePath = getSnoozeFilePath(namespaceId, orgId, scheduleId);

  if (!existsSync(snoozeFilePath)) {
    throw new NotFound("Snooze state", scheduleId);
  }

  await fs.unlink(snoozeFilePath);

  const snoozeDir = getSnoozeDir(namespaceId, orgId, scheduleId);
  if (existsSync(snoozeDir)) {
    const files = await fs.readdir(snoozeDir);
    if (files.length === 0) {
      await fs.rmdir(snoozeDir);
    }
  }

  return apiSuccess({ success: true, message: "Snooze state removed" });
});
