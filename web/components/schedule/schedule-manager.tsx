"use client";

import { useState, useEffect, useCallback } from "react";
import { CalendarFilled as Calendar, AddCircleFilled as Plus, TrashFilled as Trash2, PlayFilled } from "@aliimam/icons";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { CRON_PRESETS, getTimezones, getUserTimezone, getCronDescription, formatNextRun } from "@/lib/schedule-utils";
import type { Chain } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace-context";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";

interface ScheduleManagerProps {
  chain: Chain;
  onScheduleChange?: (schedule: { cron: string; timezone: string; enabled: boolean }) => void;
}

export function ScheduleManager({ chain, onScheduleChange }: ScheduleManagerProps) {
  const { workspacePath } = useWorkspace();
  const { fetchWithNamespace } = useNamespaceFetch();
  const configSchedule = chain.config?.schedule;
  const initialCron = typeof configSchedule === "object" && configSchedule && "cron" in configSchedule
    ? (configSchedule as { cron: string }).cron
    : typeof configSchedule === "string"
      ? configSchedule
      : "";
  const initialTimezone = typeof configSchedule === "object" && configSchedule && "timezone" in configSchedule
    ? (configSchedule as { timezone: string }).timezone
    : chain.config?.timezone || getUserTimezone();

  const [schedule, setSchedule] = useState<{
    cron: string;
    timezone: string;
    enabled: boolean;
  }>({
    cron: initialCron,
    timezone: initialTimezone,
    enabled: true,
  });
  const [loading, setLoading] = useState(false);
  const [nextRun, setNextRun] = useState<string | null>(null);
  const [customMode, setCustomMode] = useState(false);

  const calculateNextRun = useCallback(async () => {
    try {
      const res = await fetchWithNamespace("/api/schedules/next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cron: schedule.cron, timezone: schedule.timezone }),
      });
      if (res.ok) {
        const data = await res.json();
        setNextRun(data.next);
      }
    } catch {
      setNextRun(null);
    }
  }, [schedule.cron, schedule.timezone, fetchWithNamespace]);

  useEffect(() => {
    if (schedule.cron) {
      calculateNextRun();
    }
  }, [calculateNextRun, schedule.cron]);

  const handleSave = async () => {
    setLoading(true);
    try {
      const res = await fetchWithNamespace("/api/schedules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chainId: chain.id,
          schedule: schedule.cron,
          timezone: schedule.timezone,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setNextRun(data.next);
        onScheduleChange?.(schedule);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async () => {
    const newEnabled = !schedule.enabled;
    setSchedule({ ...schedule, enabled: newEnabled });
    try {
      await fetchWithNamespace("/api/schedules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chainId: chain.id,
          enabled: newEnabled,
        }),
      });
      onScheduleChange?.({ ...schedule, enabled: newEnabled });
    } catch {
      // revert on error
      setSchedule({ ...schedule, enabled: !newEnabled });
    }
  };

  const handleRunNow = async () => {
    if (!confirm("Run this chain now?")) return;
    try {
      await fetchWithNamespace("/api/chains/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chainId: chain.id, ...(workspacePath ? { workspacePath } : {}) }),
      });
    } catch {
      alert("Failed to run chain");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-foreground">Schedule</h3>
        <div className="flex items-center gap-2">
          {schedule.cron && (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleRunNow}
              className="h-7 text-xs"
            >
              <PlayFilled className="h-3 w-3 mr-1" />
              Run Now
            </Button>
          )}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-foreground/50">enabled</span>
            <Switch
              checked={schedule.enabled}
              onCheckedChange={handleToggle}
              className="scale-75"
            />
          </div>
        </div>
      </div>

      {!schedule.cron ? (
        <div className="text-center py-6 bg-muted rounded-md">
          <Calendar className="h-8 w-8 mx-auto mb-2 text-foreground/30" />
          <p className="text-xs text-foreground/40 mb-3">No schedule configured</p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setSchedule({ ...schedule, cron: "0 * * * *", enabled: true })}
            className="text-xs"
          >
            <Plus className="h-3 w-3 mr-1" />
            Add Schedule
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-foreground/50 mb-1 block">frequency</label>
              {customMode ? (
                <input
                  type="text"
                  value={schedule.cron}
                  onChange={(e) => setSchedule({ ...schedule, cron: e.target.value })}
                  placeholder="* * * * *"
                  className="w-full px-2 py-1.5 text-xs bg-muted rounded-md outline-none focus:ring-1 focus:ring-accent"
                />
              ) : (
                <Select
                  value={schedule.cron}
                  onValueChange={(value) => setSchedule({ ...schedule, cron: value })}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CRON_PRESETS.map((preset) => (
                      <SelectItem key={preset.expression} value={preset.expression}>
                        <div>
                          <div className="text-xs">{preset.label}</div>
                          <div className="text-[10px] text-foreground/50">{preset.description}</div>
                        </div>
                      </SelectItem>
                    ))}
                    <SelectItem value="custom">
                      <div className="text-foreground/40">Custom cron expression...</div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              )}
              {schedule.cron === "custom" && (setCustomMode(true), null)}
            </div>

            <div>
              <label className="text-[10px] text-foreground/50 mb-1 block">timezone</label>
              <Select
                value={schedule.timezone}
                onValueChange={(value) => setSchedule({ ...schedule, timezone: value })}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {getTimezones().slice(0, 20).map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      <span className="text-xs">{tz}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {customMode && (
            <div className="bg-muted rounded-md p-2">
              <div className="text-[10px] text-foreground/50 mb-1">cron format: minute hour day month dow</div>
              <div className="text-[10px] text-foreground/30 font-mono">
                * * * * * = every minute
              </div>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="text-[10px] text-foreground/40">
              {getCronDescription(schedule.cron)}
            </div>
            {nextRun && (
              <div className="text-[10px] text-cyan-400">
                {formatNextRun(nextRun, schedule.timezone)}
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={handleSave}
              disabled={loading}
              className="text-xs flex-1"
            >
              {loading ? "Saving..." : "Save Schedule"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSchedule({ ...schedule, cron: "", enabled: false })}
              className="h-7 text-xs text-destructive hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
