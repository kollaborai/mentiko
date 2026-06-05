"use client";

import { useState, useEffect } from "react";
import { CalendarEventCard } from "@/components/ui/calendar-event-card";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { useWorkspace } from "@/lib/ui-context/workspace-context";

interface Schedule {
  chainId: string;
  chainName: string;
  schedule: string;
  timezone: string;
  enabled: boolean;
  status: "enabled" | "disabled" | "snoozed" | "paused";
  snoozedUntil: string | null;
  lastRun: string | null;
  nextRun: string | null;
  avgDuration?: number;
  runCount?: number;
  conflictDetected?: boolean;
  conflictingChains?: string[];
}

interface ScheduleListProps {
  onEdit?: (schedule: Schedule) => void;
  onHistory?: (schedule: Schedule) => void;
  refreshKey?: number;
}

export function ScheduleList({ onEdit, onHistory, refreshKey }: ScheduleListProps) {
  const { workspacePath } = useWorkspace();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const { fetchWithNamespace } = useNamespaceFetch();

  useEffect(() => {
    fetchSchedules();
  }, [workspacePath, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchSchedules = async () => {
    setLoading(true);
    try {
      const params = workspacePath ? `?workspace=${encodeURIComponent(workspacePath)}` : "";
      const res = await fetchWithNamespace(`/api/schedules${params}`);
      const data = await res.json();
      setSchedules(data.schedules || []);
    } catch {
      setSchedules([]);
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await fetchWithNamespace("/api/schedules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chainId: id, enabled }),
      });
      setSchedules((prev) =>
        prev.map((s) =>
          s.chainId === id ? { ...s, enabled, status: enabled ? "enabled" : "disabled" } : s
        )
      );
    } catch {
      // handle error
    }
  };

  const handleRunNow = async (id: string) => {
    try {
      await fetchWithNamespace("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chainId: id }),
      });
    } catch {
      // handle error
    }
  };

  const handleSnooze = async (id: string, duration: string) => {
    try {
      await fetchWithNamespace(`/api/schedules?chainId=${id}&action=snooze&duration=${duration}`, {
        method: "DELETE",
      });
      fetchSchedules();
    } catch {
      // handle error
    }
  };

  const handleUnsnooze = async (id: string) => {
    try {
      await fetchWithNamespace(`/api/schedules?chainId=${id}&action=unsnooze`, {
        method: "DELETE",
      });
      fetchSchedules();
    } catch {
      // handle error
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-card rounded-md p-4 animate-pulse">
            <div className="h-4 bg-accent rounded w-1/3 mb-2" />
            <div className="h-3 bg-accent rounded w-1/2 mb-1" />
            <div className="h-3 bg-accent rounded w-1/4" />
          </div>
        ))}
      </div>
    );
  }

  if (schedules.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-xs text-foreground/40">No scheduled chains found</p>
        <p className="text-[10px] text-foreground/30">
          Add a schedule to a chain config to see it here
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {schedules.map((schedule) => (
        <CalendarEventCard
          key={schedule.chainId}
          id={schedule.chainId}
          title={schedule.chainName}
          schedule={schedule.schedule}
          timezone={schedule.timezone}
          status={schedule.status}
          nextRun={schedule.nextRun}
          lastRun={schedule.lastRun}
          runCount={schedule.runCount}
          conflictDetected={schedule.conflictDetected}
          conflictingChains={schedule.conflictingChains}
          snoozedUntil={schedule.snoozedUntil}
          enabled={schedule.enabled}
          onToggle={handleToggle}
          onRunNow={handleRunNow}
          onSnooze={handleSnooze}
          onUnsnooze={handleUnsnooze}
          onEdit={onEdit ? () => onEdit(schedule) : undefined}
          onHistory={onHistory ? () => onHistory(schedule) : undefined}
        />
      ))}
    </div>
  );
}
