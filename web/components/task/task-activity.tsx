"use client";

import { useState, useEffect } from "react";
import { timeAgo } from "@/lib/tasks/task-transforms";
import type { TaskActivity as TaskActivityEntry } from "@/lib/tasks/task-types";
import { WaveSpinner } from "@/components/ui/wave-spinner";
import { unwrapApiData } from "@/lib/api/api-client";

interface TaskActivityProps {
  taskId: string;
}

export function TaskActivity({ taskId }: TaskActivityProps) {
  const [activities, setActivities] = useState<TaskActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/tasks/activity?since=7d`, { signal: controller.signal })
      .then((res) => res.json())
      .then((raw) => {
        const data = unwrapApiData<{ activities?: TaskActivityEntry[] }>(raw);
        const all: TaskActivityEntry[] = data.activities || [];
        setActivities(all.filter((a) => a.issue_id === taskId));
      })
      .catch((err) => { if (err.name !== "AbortError") setActivities([]); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [taskId]);

  if (loading) {
    return (
      <div className="px-4 py-3">
        <span className="text-xs text-foreground/40 font-medium">
          Activity
        </span>
        <div className="mt-2">
          <WaveSpinner size="xs" color="primary" animation="ripple" />
        </div>
      </div>
    );
  }

  if (activities.length === 0) return null;

  return (
    <div className="px-4 py-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-foreground/40 font-medium hover:text-foreground/60"
      >
        Activity ({activities.length}) {expanded ? "−" : "+"}
      </button>

      {expanded && (
        <div className="mt-2 space-y-1.5">
          {activities.map((a, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <span className="text-foreground/30 shrink-0 w-4 text-center">
                {a.symbol}
              </span>
              <span className="text-foreground/50 flex-1">
                {a.message}
              </span>
              <span className="text-[10px] text-foreground/30 shrink-0">
                {timeAgo(a.timestamp)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
