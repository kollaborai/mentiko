/**
 * mentiko schedule storage
 *
 * Standalone CRUD for schedules stored at org-level in schedules.json.
 * Migrates from chain.json embedded configs on first load.
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { promises as fs } from "fs";
import path from "path";
import { orgPath } from "./config";
import type { Schedule } from "./types";
import { calculateCronNextRun } from "./cron-next-run";

// ---------------------------------------------------------------------------
// storage paths
// ---------------------------------------------------------------------------

function getSchedulesFile(namespaceId: string, orgId: string): string {
  return orgPath(namespaceId, orgId, "schedules.json");
}

function getChainsDir(namespaceId: string, orgId: string): string {
  return orgPath(namespaceId, orgId, "chains");
}

const SAFE_SCHEDULE_FILE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function isSafeScheduleFileId(scheduleId: string): boolean {
  return SAFE_SCHEDULE_FILE_ID_RE.test(scheduleId);
}

function getSnoozeFilePath(namespaceId: string, orgId: string, scheduleId: string): string {
  return path.join(orgPath(namespaceId, orgId, "schedules"), scheduleId, ".snooze");
}

async function readSnoozeState(namespaceId: string, orgId: string, scheduleId: string): Promise<string | null> {
  try {
    if (!isSafeScheduleFileId(scheduleId)) return null;
    const snoozeFilePath = getSnoozeFilePath(namespaceId, orgId, scheduleId);
    if (!existsSync(snoozeFilePath)) {
      return null;
    }
    const content = await fs.readFile(snoozeFilePath, "utf-8");
    const snoozeState = JSON.parse(content);

    // Check if snooze has expired
    if (new Date(snoozeState.snoozedUntil) < new Date()) {
      await fs.unlink(snoozeFilePath);
      return null;
    }

    return snoozeState.snoozedUntil;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// async CRUD (primary API)
// ---------------------------------------------------------------------------

export async function listSchedules(namespaceId: string, orgId: string): Promise<Schedule[]> {
  const file = getSchedulesFile(namespaceId, orgId);
  if (!existsSync(file)) return [];
  try {
    const content = await fs.readFile(file, "utf-8");
    const schedules: Schedule[] = JSON.parse(content);

    // Populate snooze state from .snooze files
    const schedulesWithSnooze = await Promise.all(
      schedules.map(async (schedule) => {
        const snoozedUntil = await readSnoozeState(namespaceId, orgId, schedule.id);
        return {
          ...schedule,
          snoozedUntil: snoozedUntil ?? schedule.snoozedUntil ?? null,
        };
      })
    );

    return schedulesWithSnooze;
  } catch {
    return [];
  }
}

export async function getSchedule(namespaceId: string, orgId: string, scheduleId: string): Promise<Schedule | null> {
  const schedules = await listSchedules(namespaceId, orgId);
  return schedules.find((s) => s.id === scheduleId) ?? null;
}

export async function getScheduleById(namespaceId: string, orgId: string, scheduleId: string): Promise<Schedule | null> {
  return getSchedule(namespaceId, orgId, scheduleId);
}

export async function addSchedule(namespaceId: string, orgId: string, schedule: Schedule): Promise<void> {
  const file = getSchedulesFile(namespaceId, orgId);
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const schedules = await listSchedules(namespaceId, orgId);
  if (schedules.some((s) => s.id === schedule.id)) {
    throw new Error(`Schedule '${schedule.id}' already exists`);
  }
  schedules.push(schedule);
  await fs.writeFile(file, JSON.stringify(schedules, null, 2));
}

export async function updateSchedule(
  namespaceId: string,
  orgId: string,
  scheduleId: string,
  updates: Partial<Omit<Schedule, "id" | "createdAt">>
): Promise<Schedule> {
  const file = getSchedulesFile(namespaceId, orgId);
  const schedules = await listSchedules(namespaceId, orgId);
  const idx = schedules.findIndex((s) => s.id === scheduleId);
  if (idx === -1) throw new Error(`Schedule '${scheduleId}' not found`);
  schedules[idx] = { ...schedules[idx], ...updates, updatedAt: new Date().toISOString() };
  await fs.writeFile(file, JSON.stringify(schedules, null, 2));
  return schedules[idx];
}

export async function removeSchedule(namespaceId: string, orgId: string, scheduleId: string): Promise<void> {
  const file = getSchedulesFile(namespaceId, orgId);
  const schedules = await listSchedules(namespaceId, orgId);
  const filtered = schedules.filter((s) => s.id !== scheduleId);
  if (filtered.length === schedules.length) {
    throw new Error(`Schedule '${scheduleId}' not found`);
  }
  await fs.writeFile(file, JSON.stringify(filtered, null, 2));
}

export async function getSchedulesForWorkspace(namespaceId: string, orgId: string, workspaceId: string): Promise<Schedule[]> {
  return (await listSchedules(namespaceId, orgId)).filter((s) => s.workspaceId === workspaceId);
}

export async function getSchedulesForChain(namespaceId: string, orgId: string, chainId: string): Promise<Schedule[]> {
  return (await listSchedules(namespaceId, orgId)).filter((s) => s.chainId === chainId);
}

export async function getEnabledSchedules(namespaceId: string, orgId: string): Promise<Schedule[]> {
  return (await listSchedules(namespaceId, orgId)).filter((s) => s.enabled);
}

// ---------------------------------------------------------------------------
// schedule operations
// ---------------------------------------------------------------------------

export async function incrementRunCount(namespaceId: string, orgId: string, scheduleId: string): Promise<Schedule> {
  const schedules = await listSchedules(namespaceId, orgId);
  const idx = schedules.findIndex((s) => s.id === scheduleId);
  if (idx === -1) throw new Error(`Schedule '${scheduleId}' not found`);

  const schedule = schedules[idx];
  const updated: Schedule = {
    ...schedule,
    runCount: schedule.runCount + 1,
    lastRunAt: new Date().toISOString(),
    lastRun: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  schedules[idx] = updated;
  const file = getSchedulesFile(namespaceId, orgId);
  await fs.writeFile(file, JSON.stringify(schedules, null, 2));
  return updated;
}

export async function updateNextRun(namespaceId: string, orgId: string, scheduleId: string, nextRunAt: string): Promise<Schedule> {
  return updateSchedule(namespaceId, orgId, scheduleId, { nextRunAt });
}

export async function calculateAndStoreNextRun(namespaceId: string, orgId: string, scheduleId: string): Promise<string | null> {
  const schedule = await getSchedule(namespaceId, orgId, scheduleId);
  if (!schedule) return null;

  const nextRun = calculateNextRun(schedule.cron);
  if (nextRun) {
    await updateNextRun(namespaceId, orgId, scheduleId, nextRun);
  }
  return nextRun;
}

// Scan chains dir for embedded schedule configs and create standalone records.
// Does NOT modify chain.json files (read-only). Returns count of migrated schedules.
export async function migrateFromChainConfigs(namespaceId: string, orgId: string): Promise<number> {
  const chainsDir = getChainsDir(namespaceId, orgId);
  if (!existsSync(chainsDir)) return 0;

  const schedules = await listSchedules(namespaceId, orgId);
  const existingIds = new Set(schedules.map((s) => s.id));

  let migrated = 0;
  const now = new Date().toISOString();

  function scanDir(dir: string, basePath = "") {
    if (!existsSync(dir)) return;

    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath, entry.name);
      } else if (entry.name === "chain.json") {
        try {
          const content = readFileSync(fullPath, "utf-8");
          const chain = JSON.parse(content);

          const scheduleConfig = chain.config?.schedule;
          const cron = extractCron(scheduleConfig);
          if (!cron) return;

          const chainId = basePath || chain.name || entry.name;
          if (existingIds.has(chainId)) return;

          const schedule: Schedule = {
            id: chainId,
            name: chain.name || chainId,
            chainId,
            chainName: chain.name || chainId,
            workspaceId: chain.config?.workspace?.type ? chainId : undefined,
            cron,
            timezone: extractTimezone(scheduleConfig, chain.config?.timezone),
            enabled: true,
            status: "enabled",
            goal: chain.goal,
            retryCount: 0,
            runCount: 0,
            snoozedUntil: null,
            lastRun: null,
            nextRun: null,
            createdAt: now,
            updatedAt: now,
          };

          schedules.push(schedule);
          existingIds.add(chainId);
          migrated++;
        } catch {
          // skip invalid chains
        }
      }
    }
  }

  scanDir(chainsDir);

  if (migrated > 0) {
    const file = getSchedulesFile(namespaceId, orgId);
    const dir = path.dirname(file);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, JSON.stringify(schedules, null, 2));
  }

  return migrated;
}

// ---------------------------------------------------------------------------
// utilities
// ---------------------------------------------------------------------------

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function extractCron(schedule: string | { cron?: string; timezone?: string } | undefined): string | null {
  if (!schedule) return null;
  if (typeof schedule === "string") return schedule;
  return schedule.cron || null;
}

function extractTimezone(schedule: string | { cron?: string; timezone?: string } | undefined, fallback?: string): string {
  if (!schedule) return fallback || "UTC";
  if (typeof schedule === "string") return fallback || "UTC";
  return schedule.timezone || fallback || "UTC";
}

function calculateNextRun(cron: string): string | null {
  try {
    return calculateCronNextRun(cron);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// sync compat (for legacy code)
// ---------------------------------------------------------------------------

export function listSchedulesSync(namespaceId: string, orgId: string): Schedule[] {
  const file = getSchedulesFile(namespaceId, orgId);
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return [];
  }
}

export function getScheduleSync(namespaceId: string, orgId: string, scheduleId: string): Schedule | null {
  const schedules = listSchedulesSync(namespaceId, orgId);
  return schedules.find((s) => s.id === scheduleId) ?? null;
}
