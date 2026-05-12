/**
 * scheduler service
 *
 * shared scheduler loop used by the standalone background worker.
 * reads schedules.json, checks cron expressions, fires chain-runner.sh
 * for due schedules, and creates notifications on failure.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { spawn } from "child_process";
import config, { nsPath, orgPath } from "./config";
import type { Schedule } from "./types";
import { getWorkspace } from "./workspace-storage";
import { writeLog } from "./system-logger";
import { dispatchScheduleTarget, type ScheduleDispatchAdapters } from "./schedule-dispatcher";
import { canAdmitJobToGroup, normalizeScheduleTarget } from "./schedule-targets";
import { mintSessionToken } from "./session-token";
import { getScheduledApplicationsFile, resolveScheduledApplicationRun } from "./scheduled-application-storage";
import {
  collectFileTriggerEvents,
  scanFileTriggerDirectory,
  type FileTriggerState,
} from "./schedule-file-triggers";
import { calculateCronNextRun } from "./cron-next-run";

// ---------------------------------------------------------------------------
// state (on globalThis to survive module reloads within a long-running host)
// ---------------------------------------------------------------------------

interface SchedulerState {
  interval: ReturnType<typeof setInterval> | null;
  startedAt: string | null;
  lastCheck: string | null;
  checkCount: number;
  running: boolean;
  runningGroups: Record<string, number>;
}

const g = globalThis as typeof globalThis & { __schedulerState?: SchedulerState };
if (!g.__schedulerState) {
  g.__schedulerState = {
    interval: null,
    startedAt: null,
    lastCheck: null,
    checkCount: 0,
    running: false,
    runningGroups: {},
  };
}
const state = g.__schedulerState;
state.runningGroups ||= {};

const CHECK_INTERVAL_MS = 60_000; // 60s

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

export function startScheduler() {
  if (state.interval) return; // already running

  state.startedAt = new Date().toISOString();
  state.running = true;
  console.log("[scheduler] started (60s interval)");

  // run first check immediately (non-blocking)
  checkDueSchedules().catch((err) =>
    console.warn("[scheduler] initial check failed:", err)
  );

  state.interval = setInterval(() => {
    checkDueSchedules().catch((err) =>
      console.warn("[scheduler] check failed:", err)
    );
  }, CHECK_INTERVAL_MS);
}

export function stopScheduler() {
  if (state.interval) {
    clearInterval(state.interval);
    state.interval = null;
  }
  state.running = false;
  state.startedAt = null;
  state.lastCheck = null;
  state.checkCount = 0;
  console.log("[scheduler] stopped");
}

export function getSchedulerStatus() {
  const uptime = state.startedAt
    ? Math.floor((Date.now() - new Date(state.startedAt).getTime()) / 1000)
    : undefined;

  return {
    status: state.running ? ("running" as const) : ("stopped" as const),
    uptime,
    lastCheck: state.lastCheck,
    checkCount: state.checkCount,
    startedAt: state.startedAt,
  };
}

// ---------------------------------------------------------------------------
// core loop
// ---------------------------------------------------------------------------

async function checkDueSchedules() {
  const nsId = config.namespaceId;
  const orgId = config.orgId || "default";

  const schedulesFile = orgPath(nsId, orgId, "schedules.json");
  if (!existsSync(schedulesFile)) {
    state.lastCheck = new Date().toISOString();
    state.checkCount++;
    return;
  }

  let schedules: Schedule[];
  try {
    schedules = JSON.parse(readFileSync(schedulesFile, "utf-8"));
  } catch {
    state.lastCheck = new Date().toISOString();
    state.checkCount++;
    return;
  }

  const now = Date.now();
  let updated = false;
  let fileTriggerState = readFileTriggerState(nsId, orgId);
  let fileTriggerStateUpdated = false;

  for (const schedule of schedules) {
    if (!schedule.enabled || schedule.status === "paused") continue;

    // check snooze
    if (schedule.snoozedUntil && new Date(schedule.snoozedUntil).getTime() > now) {
      continue;
    }

    if (schedule.trigger?.type === "file") {
      const files = scanFileTriggerDirectory(schedule.trigger.directory, schedule.trigger.glob);
      const collected = collectFileTriggerEvents({ schedule, files, state: fileTriggerState, nowMs: now });
      fileTriggerState = collected.state;
      if (collected.events.length > 0) fileTriggerStateUpdated = true;
      for (const event of collected.events) {
        const fired = await fireScheduleTarget(nsId, orgId, schedule, event.payload);
        if (fired.updatedSchedule) updated = true;
      }
      continue;
    }

    if (schedule.trigger?.type === "interval") {
      if (!isIntervalDue(schedule, now)) continue;
    } else {
      if (!isDue(schedule, now)) continue;
    }

    const fired = await fireScheduleTarget(nsId, orgId, schedule, { triggeredAt: new Date().toISOString() });
    if (fired.updatedSchedule) updated = true;
  }

  if (updated) {
    try {
      writeFileSync(schedulesFile, JSON.stringify(schedules, null, 2));
    } catch (err) {
      console.warn("[scheduler] failed to update schedules.json:", err);
    }
  }
  if (fileTriggerStateUpdated) {
    writeFileTriggerState(nsId, orgId, fileTriggerState);
  }

  state.lastCheck = new Date().toISOString();
  state.checkCount++;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function fireScheduleTarget(
  nsId: string,
  orgId: string,
  schedule: Schedule,
  payload: { triggeredAt: string; file?: { path: string; name: string; directory: string; extension: string } },
): Promise<{ updatedSchedule: boolean }> {
  const target = normalizeScheduleTarget(schedule);
  const groupId = schedule.jobGroupId;
  let groupAcquired = false;
  if (groupId) {
    const admission = canAdmitJobToGroup({
      maxConcurrent: 1,
      running: state.runningGroups[groupId] || 0,
      policy: "skip",
    });
    if (!admission.admitted) {
      writeLog(nsId, orgId, "info", "scheduler", `schedule skipped by job group: ${schedule.name}`, `group: ${groupId}`);
      return { updatedSchedule: false };
    }
    state.runningGroups[groupId] = (state.runningGroups[groupId] || 0) + 1;
    groupAcquired = true;
  }

  console.log(`[scheduler] firing: ${schedule.name} (${schedule.cron || schedule.trigger?.type || "manual"})`);
  writeLog(nsId, orgId, "info", "scheduler", `schedule fired: ${schedule.name}`, `trigger: ${schedule.trigger?.type || "cron"}, target: ${target.type}`);
  const result = await dispatchScheduleTarget({
    target,
    payload,
    adapters: createSchedulerAdapters(nsId, orgId, schedule),
  }).finally(() => {
    if (groupAcquired && groupId) {
      state.runningGroups[groupId] = Math.max(0, (state.runningGroups[groupId] || 1) - 1);
    }
  });

  schedule.lastRun = new Date().toISOString();
  schedule.lastRunAt = schedule.lastRun;
  schedule.runCount = (schedule.runCount || 0) + 1;
  schedule.updatedAt = new Date().toISOString();

  if (!schedule.trigger || schedule.trigger.type === "cron") {
    const nextRun = calculateNextRun(schedule.cron);
    if (nextRun) {
      schedule.nextRun = nextRun;
      schedule.nextRunAt = nextRun;
    }
  }

  if (!result.success) {
    const message = result.error || "Schedule execution failed";
    writeLog(nsId, orgId, "error", "scheduler", `schedule failed: ${schedule.name}`, message);
    await createScheduleNotification(nsId, schedule, message);
  }

  return { updatedSchedule: true };
}

function getFileTriggerStatePath(nsId: string, orgId: string): string {
  return orgPath(nsId, orgId, "schedules", "file-trigger-state.json");
}

function readFileTriggerState(nsId: string, orgId: string): FileTriggerState {
  const file = getFileTriggerStatePath(nsId, orgId);
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return {};
  }
}

function writeFileTriggerState(nsId: string, orgId: string, triggerState: FileTriggerState) {
  const file = getFileTriggerStatePath(nsId, orgId);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(triggerState, null, 2));
}

function createSchedulerAdapters(nsId: string, orgId: string, schedule: Schedule): ScheduleDispatchAdapters {
  return {
    runChain: async ({ chainId }) => {
      const chainDir = orgPath(nsId, orgId, "chains", chainId);
      const chainFile = join(chainDir, "chain.json");
      if (!existsSync(chainFile)) {
        const message = "Chain not found: " + chainId;
        console.warn(`[scheduler] ${message}`);
        writeLog(nsId, orgId, "warn", "scheduler", `chain not found: ${chainId}`, `schedule: ${schedule.name}`);
        return { success: false, error: message };
      }

      const success = await fireChain(chainFile, nsId, orgId, schedule);
      return { success };
    },
    generateTasks: async ({ prompt, workspacePath, autoRun }) => {
      try {
        const token = await mintSessionToken({
          sub: "scheduler",
          jti: `schedule-${schedule.id}-${Date.now()}`,
          ns: nsId,
          org: orgId,
          scopes: ["tasks:generate"],
        });
        const port = process.env.PORT || 3000;
        const res = await fetch(`http://localhost:${port}/api/mentiko-mcp/ops/tasks/generate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            description: prompt,
            workspacePath,
            autoRun,
          }),
          signal: AbortSignal.timeout(130_000),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          return {
            success: false,
            error: typeof data?.error === "string" ? data.error : `generate_tasks failed with HTTP ${res.status}`,
          };
        }
        return { success: true, parentId: data.parentId };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    runTask: async ({ taskId, workspaceId, workspacePath }) => {
      try {
        const secret = process.env.BETTER_AUTH_SECRET;
        if (!secret) return { success: false, error: "BETTER_AUTH_SECRET is required to run scheduled tasks" };
        const port = process.env.PORT || 3000;
        const res = await fetch(`http://localhost:${port}/api/tasks/${encodeURIComponent(taskId)}/run-chain`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${secret}`,
            "x-namespace-id": nsId,
            "x-org-id": orgId,
          },
          body: JSON.stringify({
            ...(workspaceId ? { workspaceId } : {}),
            ...(workspacePath ? { workspacePath } : {}),
          }),
          signal: AbortSignal.timeout(30_000),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const error = data?.error?.message || data?.error || `run_task failed with HTTP ${res.status}`;
          return { success: false, error };
        }
        const runId = data?.data?.runId || data?.runId;
        return { success: true, runId };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    runRegisteredApp: async ({ appId, args }) => {
      try {
        const file = getScheduledApplicationsFile(nsId, orgId);
        const request = resolveScheduledApplicationRun(file, appId, args);
        const result = await dispatchScheduleTarget({
          target: { type: "raw_exec", ...request },
          payload: { triggeredAt: new Date().toISOString() },
        });
        return {
          success: result.success,
          error: result.error,
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

function isDue(schedule: Schedule, nowMs: number): boolean {
  // if never run, check if cron matches within the last interval
  const lastRunMs = schedule.lastRun
    ? new Date(schedule.lastRun).getTime()
    : 0;

  // calculate next run after last run
  const nextRunStr = schedule.nextRun || schedule.nextRunAt;
  if (nextRunStr) {
    const nextMs = new Date(nextRunStr).getTime();
    // due if next run time has passed and we haven't run since
    return nextMs <= nowMs && lastRunMs < nextMs;
  }

  // fallback: calculate from cron
  const nextCalc = calculateNextRunAfter(schedule.cron, lastRunMs || (nowMs - CHECK_INTERVAL_MS));
  if (!nextCalc) return false;

  const nextCalcMs = new Date(nextCalc).getTime();
  return nextCalcMs <= nowMs;
}

function isIntervalDue(schedule: Schedule, nowMs: number): boolean {
  const trigger = schedule.trigger;
  if (!trigger || trigger.type !== "interval") return false;
  const lastRunMs = schedule.lastRun ? new Date(schedule.lastRun).getTime() : 0;
  return nowMs - lastRunMs >= trigger.everyMs;
}

function calculateNextRun(cron: string): string | null {
  try {
    return calculateCronNextRun(cron);
  } catch {
    return null;
  }
}

function calculateNextRunAfter(cron: string, afterMs: number): string | null {
  try {
    return calculateCronNextRun(cron, { afterMs });
  } catch {
    return null;
  }
}

function fireChain(
  chainFile: string,
  nsId: string,
  orgId: string,
  schedule: Schedule
): Promise<boolean> {
  return new Promise((resolve) => {
    const chainRunner = join(config.codeRoot, "lib", "chain-runner.sh");
    if (!existsSync(chainRunner)) {
      console.warn("[scheduler] chain-runner.sh not found");
      resolve(false);
      return;
    }

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      MENTIKO_GLOBAL_ROOT: config.globalRoot,
      MENTIKO_CODE_ROOT: config.codeRoot,
      MENTIKO_PROJECT_ROOT: config.projectRoot,
      MENTIKO_ORG_ROOT: config.orgRoot,
      MENTIKO_NAMESPACE_ROOT: config.namespaceRoot,
      NAMESPACE_ID: nsId,
      ORG_ID: orgId,
    };
    delete env.CLAUDECODE;

    // resolve workspace path from schedule's workspaceId
    const args = [chainRunner, chainFile];
    if (schedule.workspaceId) {
      const ws = getWorkspace(nsId, orgId, schedule.workspaceId);
      if (ws?.path) {
        args.push("--workspace", ws.path);
      }
    }

    try {
      const proc = spawn("bash", args, {
        detached: true,
        stdio: "ignore",
        env,
      });

      proc.unref();

      proc.on("error", () => {
        resolve(false);
      });

      // we don't wait for completion - fire and forget
      resolve(true);
    } catch {
      resolve(false);
    }
  });
}

async function createScheduleNotification(
  nsId: string,
  schedule: Schedule,
  errorMessage: string
) {
  try {
    const notifDir = nsPath(nsId, "notifications");
    if (!existsSync(notifDir)) {
      mkdirSync(notifDir, { recursive: true });
    }

    const notifFile = join(notifDir, "notifications.json");
    let notifications: Array<Record<string, unknown>> = [];

    if (existsSync(notifFile)) {
      try {
        notifications = JSON.parse(readFileSync(notifFile, "utf-8"));
      } catch {
        notifications = [];
      }
    }

    const notification = {
      id: `notif_sched_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      type: "chain_failed",
      title: `Schedule failed: ${schedule.name}`,
      message: errorMessage,
      timestamp: new Date().toISOString(),
      read: false,
      metadata: {
        chainId: schedule.chainId,
        error: errorMessage,
        actionUrl: "/schedules",
        actionLabel: "View Schedules",
      },
    };

    notifications.unshift(notification);
    if (notifications.length > 200) {
      notifications.splice(200);
    }

    writeFileSync(notifFile, JSON.stringify(notifications, null, 2));
    console.log(`[scheduler] notification: ${notification.title}`);
  } catch (err) {
    console.warn("[scheduler] failed to create notification:", err);
  }
}
