"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { useWorkspace } from "@/lib/workspace-context";
import { useSharedRuns } from "@/lib/runs-store";

// ── types ──────────────────────────────────────────────────

export interface AttentionItem {
  id: string;
  kind: "decision" | "run_failed" | "task_ready" | "notification";
  label: string;
  description?: string;
  url: string;
  count?: number;
  timestamp?: string;
}

export interface HappeningItem {
  id: string;
  kind: "run_active" | "schedule_next";
  label: string;
  description?: string;
  url: string;
  progress?: string; // e.g. "3/5 agents"
  elapsed?: string;
  timestamp?: string;
}

export interface GoneItem {
  id: string;
  kind: "run_complete" | "decision_approved" | "notification_recent";
  label: string;
  description?: string;
  url: string;
  timestamp?: string;
}

export interface StartPageData {
  attention: AttentionItem[];
  happening: HappeningItem[];
  gone: GoneItem[];
  loading: boolean;
}

// ── cache ──────────────────────────────────────────────────

const CACHE_TTL = 30_000; // 30 seconds
let cachedData: Omit<StartPageData, "loading"> | null = null;
let cachedAt = 0;

function isCacheFresh(): boolean {
  return cachedData !== null && Date.now() - cachedAt < CACHE_TTL;
}

// ── relative time helper ───────────────────────────────────

function relativeTime(isoString: string): string {
  const ms = Date.now() - new Date(isoString).getTime();
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  if (sec < 60) return `${sec}s ago`;
  if (min < 60) return `${min}m ago`;
  if (hr < 24) return `${hr}h ago`;
  return `${day}d ago`;
}

function futureTime(isoString: string): string {
  const ms = new Date(isoString).getTime() - Date.now();
  if (ms < 0) return "now";
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  if (min < 1) return "< 1m";
  if (min < 60) return `in ${min}m`;
  if (hr < 24) return `in ${hr}h`;
  return `in ${Math.floor(hr / 24)}d`;
}

// ── run agent progress ─────────────────────────────────────

interface RunAgent {
  id?: string;
  status?: string;
}

function agentProgress(agents?: RunAgent[]): string | undefined {
  if (!agents || agents.length === 0) return undefined;
  const done = agents.filter(
    (a) => a.status === "complete" || a.status === "completed"
  ).length;
  return `${done}/${agents.length} agents`;
}

// ── hook ───────────────────────────────────────────────────

export function useStartPageData(enabled: boolean): StartPageData {
  const { fetchWithNamespace } = useNamespaceFetch();
  const { workspacePath } = useWorkspace();
  const { runs: sharedRuns } = useSharedRuns({ workspacePath: workspacePath || undefined });
  const [data, setData] = useState<Omit<StartPageData, "loading">>(
    cachedData ?? { attention: [], happening: [], gone: [] }
  );
  const [loading, setLoading] = useState(!isCacheFresh());
  const fetchingRef = useRef(false);

  const fetchAll = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;

    try {
      // fetch all data in parallel (runs come from shared store)
      const [decisionsRes, notificationsRes, schedulesRes, tasksRes] =
        await Promise.allSettled([
          fetchWithNamespace(`/api/decisions${workspacePath ? `?workspace=${encodeURIComponent(workspacePath)}` : ""}`),
          fetchWithNamespace("/api/notifications"),
          fetchWithNamespace("/api/schedules"),
          fetchWithNamespace("/api/tasks/list"),
        ]);

      // ── parse responses ──────────────────────────────────

      interface RunData {
        id: string;
        chain: string;
        goal: string;
        started: string;
        completed?: string;
        status: string;
        agents?: RunAgent[];
      }

      interface DecisionData {
        id: string;
        title?: string;
        prompt: string;
        status: string;
        createdAt: string;
        resolution?: { selectedAt?: string };
      }

      interface NotificationData {
        id: string;
        type: string;
        title: string;
        message: string;
        timestamp: string;
        read: boolean;
        metadata?: { actionUrl?: string };
      }

      interface ScheduleData {
        id: string;
        name: string;
        chainName?: string;
        chainId?: string;
        enabled: boolean;
        nextRun: string | null;
      }

      interface TaskData {
        id: string;
        title: string;
        status: string;
        dependencies?: string[];
        priority?: number;
      }

      // use shared store runs (already fetched + cached), cast to local RunData shape
      const runs: RunData[] = (sharedRuns as unknown as RunData[]).slice(0, 10);
      let decisions: DecisionData[] = [];
      let notifications: NotificationData[] = [];
      let schedules: ScheduleData[] = [];
      let tasks: TaskData[] = [];

      if (decisionsRes.status === "fulfilled" && decisionsRes.value.ok) {
        const d = (await decisionsRes.value.json()) as {
          decisions?: DecisionData[];
        };
        decisions = d.decisions || [];
      }
      if (
        notificationsRes.status === "fulfilled" &&
        notificationsRes.value.ok
      ) {
        const d = (await notificationsRes.value.json()) as {
          notifications?: NotificationData[];
        };
        notifications = d.notifications || [];
      }
      if (schedulesRes.status === "fulfilled" && schedulesRes.value.ok) {
        const d = (await schedulesRes.value.json()) as {
          schedules?: ScheduleData[];
        };
        schedules = d.schedules || [];
      }
      if (tasksRes.status === "fulfilled" && tasksRes.value.ok) {
        const d = (await tasksRes.value.json()) as {
          issues?: TaskData[];
          tasks?: TaskData[];
        };
        tasks = d.issues || d.tasks || [];
      }

      // ── build attention items ────────────────────────────

      const attention: AttentionItem[] = [];

      // pending decisions
      const pendingDecisions = decisions.filter(
        (d) => d.status === "pending" || d.status === "researching"
      );
      if (pendingDecisions.length > 0) {
        attention.push({
          id: "decisions-pending",
          kind: "decision",
          label: `${pendingDecisions.length} decision${pendingDecisions.length === 1 ? "" : "s"} awaiting approval`,
          url: "/decisions",
          count: pendingDecisions.length,
        });
      }

      // failed runs (last 24h)
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      const failedRuns = runs.filter(
        (r) =>
          (r.status === "error" || r.status === "failed") &&
          new Date(r.started).getTime() > oneDayAgo
      );
      if (failedRuns.length > 0) {
        const mostRecent = failedRuns[0];
        attention.push({
          id: "runs-failed",
          kind: "run_failed",
          label: `${failedRuns.length} chain run${failedRuns.length === 1 ? "" : "s"} failed`,
          description: mostRecent
            ? `"${mostRecent.chain}" ${relativeTime(mostRecent.started)}`
            : undefined,
          url:
            failedRuns.length === 1
              ? `/runs?runId=${mostRecent.id}`
              : "/runs",
          count: failedRuns.length,
          timestamp: mostRecent?.started,
        });
      }

      // unread notifications
      const unreadNotifs = notifications.filter((n) => !n.read);
      if (unreadNotifs.length > 0) {
        attention.push({
          id: "notifications-unread",
          kind: "notification",
          label: `${unreadNotifs.length} unread notification${unreadNotifs.length === 1 ? "" : "s"}`,
          url: "/notifications",
          count: unreadNotifs.length,
        });
      }

      // ready tasks (open, no unresolved deps)
      const openTasks = tasks.filter(
        (t) =>
          t.status === "open" &&
          (!t.dependencies || t.dependencies.length === 0)
      );
      if (openTasks.length > 0) {
        attention.push({
          id: "tasks-ready",
          kind: "task_ready",
          label: `${openTasks.length} task${openTasks.length === 1 ? "" : "s"} unblocked and ready`,
          url: "/tasks",
          count: openTasks.length,
        });
      }

      // ── build happening items ────────────────────────────

      const happening: HappeningItem[] = [];

      // running runs
      const runningRuns = runs.filter((r) => r.status === "running");
      for (const run of runningRuns) {
        happening.push({
          id: `run-${run.id}`,
          kind: "run_active",
          label: `"${run.chain}" running`,
          progress: agentProgress(run.agents),
          elapsed: relativeTime(run.started),
          url: `/runs?runId=${run.id}`,
          timestamp: run.started,
        });
      }

      // next scheduled job
      const enabledSchedules = schedules
        .filter((s) => s.enabled && s.nextRun)
        .sort(
          (a, b) =>
            new Date(a.nextRun!).getTime() - new Date(b.nextRun!).getTime()
        );
      if (enabledSchedules.length > 0) {
        const next = enabledSchedules[0];
        happening.push({
          id: `schedule-${next.id}`,
          kind: "schedule_next",
          label: `scheduled: "${next.chainName || next.name}"`,
          description: futureTime(next.nextRun!),
          url: "/schedules",
          timestamp: next.nextRun!,
        });
      }

      // ── build gone items ─────────────────────────────────

      const gone: GoneItem[] = [];

      // completed runs in last 24h
      const completedRuns = runs.filter(
        (r) =>
          (r.status === "complete" || r.status === "completed") &&
          new Date(r.started).getTime() > oneDayAgo
      );
      for (const run of completedRuns.slice(0, 3)) {
        gone.push({
          id: `done-run-${run.id}`,
          kind: "run_complete",
          label: `"${run.chain}" completed`,
          description: relativeTime(run.completed || run.started),
          url: `/runs?runId=${run.id}`,
          timestamp: run.completed || run.started,
        });
      }

      // approved decisions
      const approvedDecisions = decisions.filter(
        (d) =>
          d.status === "approved" &&
          d.resolution?.selectedAt &&
          new Date(d.resolution.selectedAt).getTime() > oneDayAgo
      );
      for (const dec of approvedDecisions.slice(0, 2)) {
        gone.push({
          id: `done-decision-${dec.id}`,
          kind: "decision_approved",
          label: `decision "${dec.title || dec.prompt.slice(0, 40)}" approved`,
          description: dec.resolution?.selectedAt
            ? relativeTime(dec.resolution.selectedAt)
            : undefined,
          url: `/decisions?decisionId=${dec.id}`,
          timestamp: dec.resolution?.selectedAt,
        });
      }

      // recent read notifications
      const recentRead = notifications
        .filter((n) => n.read)
        .slice(0, 3);
      for (const notif of recentRead) {
        if (gone.length >= 5) break;
        gone.push({
          id: `done-notif-${notif.id}`,
          kind: "notification_recent",
          label: notif.title,
          description: relativeTime(notif.timestamp),
          url: notif.metadata?.actionUrl || "/notifications",
          timestamp: notif.timestamp,
        });
      }

      const result = { attention, happening, gone };
      cachedData = result;
      cachedAt = Date.now();
      setData(result);
    } catch {
      // keep whatever we have
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, [fetchWithNamespace, workspacePath, sharedRuns]);

  useEffect(() => {
    if (!enabled) return;
    if (isCacheFresh()) {
      setData(cachedData!);
      setLoading(false);
      return;
    }
    fetchAll();
  }, [enabled, fetchAll]);

  return { ...data, loading };
}
