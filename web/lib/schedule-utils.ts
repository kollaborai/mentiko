import { Schedule, ScheduleConflict, ScheduleExecution, CronPreset } from "./types";

const COMMON_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Vancouver",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Rome",
  "Europe/Amsterdam",
  "Europe/Madrid",
  "Europe/Moscow",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Singapore",
  "Asia/Seoul",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Pacific/Auckland",
];

export const CRON_PRESETS: CronPreset[] = [
  { label: "Every minute", expression: "* * * * *", description: "Runs every minute" },
  { label: "Every 5 minutes", expression: "*/5 * * * *", description: "Runs every 5 minutes" },
  { label: "Every 15 minutes", expression: "*/15 * * * *", description: "Runs every 15 minutes" },
  { label: "Every 30 minutes", expression: "*/30 * * * *", description: "Runs every 30 minutes" },
  { label: "Hourly", expression: "0 * * * *", description: "Runs at the top of every hour" },
  { label: "Every 2 hours", expression: "0 */2 * * *", description: "Runs every 2 hours" },
  { label: "Every 6 hours", expression: "0 */6 * * *", description: "Runs every 6 hours" },
  { label: "Daily at midnight", expression: "0 0 * * *", description: "Runs every day at midnight" },
  { label: "Daily at 9am", expression: "0 9 * * *", description: "Runs every day at 9:00 AM" },
  { label: "Daily at 5pm", expression: "0 17 * * *", description: "Runs every day at 5:00 PM" },
  { label: "Weekly (Monday 9am)", expression: "0 9 * * 1", description: "Runs every Monday at 9:00 AM" },
  { label: "Weekly (Friday 5pm)", expression: "0 17 * * 5", description: "Runs every Friday at 5:00 PM" },
  { label: "Monthly (1st midnight)", expression: "0 0 1 * *", description: "Runs on the 1st of every month at midnight" },
  { label: "Weekdays 9am", expression: "0 9 * * 1-5", description: "Runs Monday-Friday at 9:00 AM" },
  { label: "Weekends 10am", expression: "0 10 * * 6,0", description: "Runs Saturday-Sunday at 10:00 AM" },
];

export function getTimezones(): string[] {
  return COMMON_TIMEZONES;
}

export function getUserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function isValidCron(cron: string): boolean {
  const parts = cron.trim().split(/\s+/);
  return parts.length >= 5 && parts.length <= 6;
}

export function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function getCronDescription(cron: string): string {
  const preset = CRON_PRESETS.find(p => p.expression === cron);
  if (preset) return preset.description;

  const parts = cron.split(/\s+/);
  if (parts.length < 5) return "Custom schedule";

  const [min, hour, day, month, dow] = parts;

  if (min === "*" && hour === "*") return "Every minute";
  if (min === "0" && hour === "*") return "Every hour";
  if (min === "0" && hour === "0" && day === "*" && month === "*") return "Daily at midnight";
  if (day === "*" && month === "*" && dow === "*") {
    if (hour !== "*" && min !== "0") return `Daily at ${formatTime(hour, min)}`;
    if (hour !== "*") return `Daily at ${formatTime(hour, "0")}`;
  }

  return "Custom schedule";
}

function formatTime(hour: string, min: string): string {
  const h = parseInt(hour);
  const m = parseInt(min);
  const ampm = h >= 12 ? "PM" : "AM";
  const formattedH = h % 12 || 12;
  return `${formattedH}:${m.toString().padStart(2, "0")} ${ampm}`;
}

export function formatNextRun(nextRun: string | null, timezone: string): string {
  if (!nextRun) return "Not scheduled";

  const date = new Date(nextRun);
  const now = new Date();
  const diff = date.getTime() - now.getTime();

  if (diff < 0) return "Due now";
  if (diff < 60000) return "In less than a minute";
  if (diff < 3600000) return `In ${Math.floor(diff / 60000)} min`;

  const userTz = timezone || getUserTimezone();
  return date.toLocaleString("en-US", {
    timeZone: userTz,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function checkScheduleConflicts(
  schedules: Schedule[],
  windowMinutes: number = 15
): ScheduleConflict[] {
  const conflicts: ScheduleConflict[] = [];

  for (const schedule of schedules) {
    if (!schedule.enabled || schedule.status === "disabled" || schedule.status === "snoozed") {
      continue;
    }

    const conflicting: ScheduleConflict["conflictsWith"] = [];

    for (const other of schedules) {
      if (schedule.id === other.id) continue;
      if (!other.enabled || other.status === "disabled" || other.status === "snoozed") {
        continue;
      }

      const overlap = calculateScheduleOverlap(
        schedule.cron,
        schedule.timezone,
        other.cron,
        other.timezone,
        windowMinutes
      );

      if (overlap) {
        conflicting.push({
          scheduleId: other.id,
          chainId: other.chainId,
          chainName: other.chainName,
          overlapWindow: overlap,
          probability: overlap.includes("exact") ? "high" : "medium",
        });
      }
    }

    if (conflicting.length > 0) {
      conflicts.push({
        scheduleId: schedule.id,
        chainId: schedule.chainId,
        chainName: schedule.chainName,
        cron: schedule.cron,
        timezone: schedule.timezone,
        conflictsWith: conflicting,
      });
    }
  }

  return conflicts;
}

function calculateScheduleOverlap(
  cronA: string,
  tzA: string,
  cronB: string,
  tzB: string,
  windowMinutes: number
): string | null {
  if (cronA === cronB && tzA === tzB) {
    return "exact same schedule";
  }

  const partsA = cronA.split(/\s+/);
  const partsB = cronB.split(/\s+/);

  if (partsA.length < 5 || partsB.length < 5) return null;

  const [minA, hourA] = partsA;
  const [minB, hourB] = partsB;

  if (minA === minB && hourA === hourB && tzA === tzB) {
    return "same daily time";
  }

  if (hourA === hourB && tzA === tzB) {
    const minDiff = Math.abs(parseInt(minA || "0") - parseInt(minB || "0"));
    if (minDiff <= windowMinutes) {
      return `within ${minDiff} minutes`;
    }
  }

  return null;
}

export function estimateExecutionTime(schedule: Schedule): number | undefined {
  return schedule.avgDuration;
}

export function calculateMissedRuns(
  lastRun: string | null,
  cron: string,
  _timezone: string
): number {
  if (!lastRun) return 0;

  const last = new Date(lastRun);
  const now = new Date();
  const hoursSince = (now.getTime() - last.getTime()) / (1000 * 60 * 60);

  const parts = cron.split(/\s+/);
  if (parts.length < 5) return 0;

  const [, hour] = parts;

  if (hour === "*") {
    return Math.floor(hoursSince * 60);
  }
  if (hour.includes("*/")) {
    const interval = parseInt(hour.replace(/\*\//, ""));
    return Math.floor(hoursSince / interval);
  }
  if (!hour.includes("*")) {
    return Math.floor(hoursSince / 24);
  }

  return 0;
}

export function isSnoozed(snoozedUntil: string | null | undefined): boolean {
  if (!snoozedUntil) return false;
  return new Date(snoozedUntil) > new Date();
}

export function getSnoozeRemaining(snoozedUntil: string | null | undefined): string | null {
  if (!snoozedUntil) return null;

  const until = new Date(snoozedUntil);
  const now = new Date();
  const diff = until.getTime() - now.getTime();

  if (diff <= 0) return null;

  if (diff < 3600000) return `${Math.ceil(diff / 60000)} min`;
  if (diff < 86400000) return `${Math.ceil(diff / 3600000)} hours`;
  return `${Math.ceil(diff / 86400000)} days`;
}

export function calculateSnoozeUntil(duration: string): string {
  const now = new Date();
  const match = duration.match(/^(\d+)(min|h|d|w)?$/);

  if (!match) throw new Error("Invalid duration format");

  const value = parseInt(match[1]);
  const unit = match[2] || "min";

  const multipliers: Record<string, number> = {
    min: 60000,
    h: 3600000,
    d: 86400000,
    w: 604800000,
  };

  return new Date(now.getTime() + value * multipliers[unit]).toISOString();
}

export function generateExecutionId(): string {
  return `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function parseExecutionHistory(
  history: unknown
): ScheduleExecution[] {
  if (!Array.isArray(history)) return [];
  return history.filter((h): h is ScheduleExecution => {
    return (
      typeof h === "object" &&
      h !== null &&
      "id" in h &&
      "scheduleId" in h &&
      "startedAt" in h &&
      "status" in h
    );
  });
}

export function aggregateExecutionStats(
  executions: ScheduleExecution[]
): { avgDuration: number; successRate: number; totalRuns: number } {
  const completed = executions.filter(e => e.status === "completed");
  const failed = executions.filter(e => e.status === "failed");
  const total = completed.length + failed.length;

  const avgDuration =
    completed.length > 0
      ? completed.reduce((sum, e) => sum + (e.duration || 0), 0) / completed.length
      : 0;

  const successRate = total > 0 ? completed.length / total : 1;

  return {
    avgDuration: Math.round(avgDuration),
    successRate: Math.round(successRate * 100),
    totalRuns: total,
  };
}
