"use client";

import { useState, useEffect, memo, useCallback } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { MessageSquareFilled as MessageSquare, PlayFilled as Play, TickCircleFilled as CheckCircle2, InfoCircleFilled as AlertCircle, ActivityFilled as Activity, RecordCircleFilled as Circle, CloseCircleFilled as X, StopFilled as Square } from "@aliimam/icons";
import { ActivityItemSkeleton } from "@/components/skeletons";
import { useWorkspace } from "@/lib/ui-context/workspace-context";
import { unwrapApiData } from "@/lib/api/api-client";
import { useSharedRuns } from "@/lib/runs/runs-store";

interface AgentEvent {
  filename: string;
  event: string;
  source: string;
  timestamp: string;
  processed: boolean;
  data: string;
}

interface Run {
  id: string;
  chain: string;
  status: string;
  started: string;
}

interface EventsResponse {
  events: AgentEvent[];
}

interface RunsResponse {
  runs: Run[];
}

type ActivityItem =
  | { type: "event"; data: AgentEvent }
  | { type: "run"; data: Run };

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);

  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  return `${Math.floor(diffHour / 24)}d ago`;
}

function getEventType(status: string | undefined): string {
  if (status === "running") return "started";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "stopped") return "stopped";
  return "started";
}

function getEventBadgeContent(status: string | undefined): { icon: typeof Circle; label: string; colorClass: string } {
  const eventType = getEventType(status);
  switch (eventType) {
    case "started":
      return { icon: Circle, label: "started", colorClass: "text-blue-400" };
    case "completed":
      return { icon: CheckCircle2, label: "completed", colorClass: "text-green-400" };
    case "failed":
      return { icon: X, label: "failed", colorClass: "text-red-400" };
    case "stopped":
      return { icon: Square, label: "stopped", colorClass: "text-orange-400" };
    default:
      return { icon: Circle, label: "started", colorClass: "text-blue-400" };
  }
}

function getActivityIcon(item: ActivityItem) {
  if (item.type === "event") {
    return <MessageSquare className="h-3.5 w-3.5 text-blue-400" />;
  }
  const status = item.data.status;
  if (status === "running") {
    return <Play className="h-3.5 w-3.5 text-green-400" />;
  } else if (status === "completed") {
    return <CheckCircle2 className="h-3.5 w-3.5 text-blue-400" />;
  } else if (status === "failed") {
    return <AlertCircle className="h-3.5 w-3.5 text-red-400" />;
  }
  return <Play className="h-3.5 w-3.5 text-foreground/40" />;
}

interface ActivityFeedProps {
  className?: string;
}

export const ActivityFeed = memo(function ActivityFeed({ className }: ActivityFeedProps) {
  const { workspacePath } = useWorkspace();
  const { runs: sharedRuns } = useSharedRuns({ workspacePath: workspacePath || undefined });
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchActivity = useCallback(async () => {
    try {
      const [eventsRes] = await Promise.all([
        fetch("/api/events?" + Date.now()),
      ]);

      const items: ActivityItem[] = [];

      if (eventsRes.ok) {
        const eventsData = unwrapApiData<EventsResponse>(await eventsRes.json());
        (eventsData.events || []).slice(0, 5).forEach((ev) => {
          items.push({ type: "event", data: ev });
        });
      }

      // use shared runs instead of a separate fetch
      sharedRuns.slice(0, 5).forEach((run) => {
        items.push({ type: "run", data: run as Run });
      });

      items.sort((a, b) => {
        const aTime =
          a.type === "event"
            ? new Date(a.data.timestamp).getTime()
            : new Date(a.data.started).getTime();
        const bTime =
          b.type === "event"
            ? new Date(b.data.timestamp).getTime()
            : new Date(b.data.started).getTime();
        return bTime - aTime;
      });

      setActivities(items.slice(0, 8));
    } catch (e) {
      console.error("Failed to fetch activity", e);
    } finally {
      setLoading(false);
    }
  }, [workspacePath, sharedRuns]);

  useEffect(() => {
    fetchActivity();
    const interval = setInterval(fetchActivity, 10000);
    return () => clearInterval(interval);
  }, [workspacePath, fetchActivity]);

  return (
    <div className={className}>
      <div className="relative bg-background border border-border/40 rounded-xl overflow-hidden h-full">
        <div
          className="absolute inset-0 z-0 pointer-events-none"
          style={{
            backgroundImage: "repeating-linear-gradient(-45deg, #f59e0b 0, #f59e0b 1px, transparent 1px, transparent 12px), repeating-linear-gradient(45deg, #f59e0b 0, #f59e0b 1px, transparent 1px, transparent 12px)",
            opacity: 0.05,
          }}
        />
        <div className="relative z-10 flex items-center justify-between px-3 md:px-4 py-3 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Activity className="h-4 w-4 shrink-0" style={{ color: "#f59e0b" }} />
            <div className="min-w-0">
              <h3 className="text-sm font-bold tracking-tight">Recent Activity</h3>
              <p className="text-xs text-foreground/40">
                Events and runs from across the system
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-foreground/30">
            <Activity className="h-3 w-3 animate-pulse" style={{ color: "#5cb88a" }} />
            <span className="text-xs">polling</span>
          </div>
        </div>

        <div className="relative z-10 max-h-72 overflow-y-auto">
        {loading ? (
          <>
            <ActivityItemSkeleton />
            <ActivityItemSkeleton />
            <ActivityItemSkeleton />
          </>
        ) : activities.length === 0 ? (
          <div className="p-4 md:p-6 text-center text-foreground/40 text-sm">
            No recent activity
          </div>
        ) : (
          activities.map((item, idx) => {
            if (item.type === "event") {
              const ev = item.data;
              return (
                <div key={`event-${idx}`}>
                  {idx > 0 && <div className="h-px bg-accent" />}
                  <div className="p-3 flex items-start gap-3">
                    <div className="mt-0.5 shrink-0">{getActivityIcon(item)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-sm font-medium truncate">
                          {ev.event}
                        </span>
                        <Badge
                          variant="secondary"
                          className={`text-[10px] ${
                            ev.processed
                              ? "bg-green-500/20 text-green-400"
                              : "bg-amber-500/20 text-amber-400"
                          }`}
                        >
                          {ev.processed ? "done" : "pending"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-foreground/40 flex-wrap">
                        <span className="font-mono text-[10px]">{ev.source}</span>
                        <span>{formatRelativeTime(ev.timestamp)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            } else {
              const run = item.data;
              const eventBadge = getEventBadgeContent(run.status);
              const EventIcon = eventBadge.icon;
              return (
                <Link key={`run-${idx}`} href={`/runs?runId=${run.id}`} className="block hover:bg-accent/40 transition-colors">
                  {idx > 0 && <div className="h-px bg-accent" />}
                  <div className="p-3 flex items-start gap-3">
                    <div className="mt-0.5 shrink-0">{getActivityIcon(item)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`inline-flex items-center gap-1 text-[9px] px-1 py-0.5 rounded ${eventBadge.colorClass}`}>
                          <EventIcon className="h-2.5 w-2.5" />
                          <span>{eventBadge.label}</span>
                        </span>
                        <span className="text-sm font-medium truncate">
                          {run.chain}
                        </span>
                      </div>
                      <p className="text-xs text-foreground/40">
                        run started {formatRelativeTime(run.started)}
                      </p>
                    </div>
                  </div>
                </Link>
              );
            }
          })
        )}
      </div>
    </div>
    </div>
  );
});
