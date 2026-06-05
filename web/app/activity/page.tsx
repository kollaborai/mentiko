"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import {
  RefreshCw,
  DocumentTextFilled,
  ExternalLink,
  Download,
  ActivityFilled,
  RouteSquareFilled,
  LinkFilled,
  SendFilled,
} from "@aliimam/icons";
import { WaveSpinner } from "@/components/ui/wave-spinner";
import { EmptyState } from "@/components/empty-state";
import {
  WorkflowSidebarPane,
  WorkflowSidebarItem,
  WorkflowSidebarResizeHandle,
  WorkflowSidebarSegmentedControl,
} from "@/components/ui/workflow-sidebar";
import { PageBanner } from "@/components/ui/page-banner";
import { TimeAgo } from "@/components/shared/time-ago";
import Link from "next/link";

type ActivityFilter = "all" | "chains" | "agents" | "system";

interface ActivityEvent {
  id: string;
  type: "chain_started" | "chain_completed" | "chain_failed" | "agent_started" | "agent_completed" | "schedule_triggered" | "error" | "system";
  title: string;
  message: string;
  timestamp: string;
  metadata: {
    runId?: string;
    agentId?: string;
    chainId?: string;
    chainName?: string;
    agentName?: string;
    status?: string;
  };
}

interface ActivityResponse {
  events: ActivityEvent[];
}

function getEventAccentColor(type: ActivityEvent["type"]): string {
  switch (type) {
    case "chain_started":
    case "chain_completed":
    case "chain_failed":
      return "bg-amber-400";
    case "agent_started":
    case "agent_completed":
      return "bg-blue-400";
    case "error":
      return "bg-red-400";
    case "schedule_triggered":
      return "bg-purple-400";
    default:
      return "bg-foreground/20";
  }
}

function getEventPillColor(type: ActivityEvent["type"]): string {
  switch (type) {
    case "chain_started":
    case "agent_started":
      return "bg-amber-500/15 text-amber-400";
    case "chain_completed":
      return "bg-emerald-500/15 text-emerald-400";
    case "agent_completed":
      return "bg-blue-500/15 text-blue-400";
    case "chain_failed":
    case "error":
      return "bg-red-500/15 text-red-400";
    case "schedule_triggered":
      return "bg-purple-500/15 text-purple-400";
    default:
      return "bg-foreground/5 text-foreground/40";
  }
}

function getEventTypeLabel(type: ActivityEvent["type"]): string {
  return type.replace(/_/g, " ");
}

function ActivityRow({
  event,
  isSelected,
  onClick,
}: {
  event: ActivityEvent;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <WorkflowSidebarItem
      selected={isSelected}
      onClick={onClick}
      accentClassName={getEventAccentColor(event.type)}
    >
      <div className="pl-4">
        {/* row 1: title + time ago */}
        <div className="flex items-start justify-between gap-2">
          <span className="line-clamp-1 text-sm font-semibold leading-5">
            {event.title}
          </span>
          <TimeAgo
            date={event.timestamp}
            format="short"
            suffix={false}
            className="shrink-0 !text-[10px] text-foreground/30"
          />
        </div>

        {/* row 2: description */}
        <p className="line-clamp-1 text-[11px] text-foreground/40 mt-0.5">
          {event.message}
        </p>

        {/* row 3: run id + status */}
        {(event.metadata.runId || event.metadata.status) && (
          <div className="mt-1 flex items-center gap-2 text-[10px] text-foreground/30 font-mono">
            {event.metadata.runId && (
              <span className="truncate">{event.metadata.runId}</span>
            )}
            {event.metadata.status && (
              <span className="shrink-0">{event.metadata.status}</span>
            )}
          </div>
        )}

        {/* row 4: pills */}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-foreground/40">
          <span className={`rounded-full px-2 py-0.5 uppercase tracking-[0.14em] ${getEventPillColor(event.type)}`}>
            {getEventTypeLabel(event.type)}
          </span>
          {event.metadata.chainName && (
            <span className="rounded-full bg-foreground/5 px-2 py-0.5">
              {event.metadata.chainName}
            </span>
          )}
          {event.metadata.agentName && (
            <span className="rounded-full bg-foreground/5 px-2 py-0.5">
              {event.metadata.agentName}
            </span>
          )}
        </div>
      </div>
    </WorkflowSidebarItem>
  );
}

function LogPanel({
  runId,
  fetchWithNamespace,
}: {
  runId: string | undefined;
  fetchWithNamespace: ReturnType<typeof useNamespaceFetch>["fetchWithNamespace"];
}) {
  const [log, setLog] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const logRef = useRef<HTMLPreElement>(null);
  const prevRunId = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!runId) {
      setLog(null);
      setError(null);
      return;
    }

    const currentRunId = runId;
    let cancelled = false;

    async function fetchLog() {
      if (currentRunId !== prevRunId.current) {
        setLoading(true);
        setLog(null);
        setError(null);
      }
      prevRunId.current = currentRunId;

      try {
        const res = await fetchWithNamespace(`/api/runs/${encodeURIComponent(currentRunId)}/output`);
        if (cancelled) return;
        if (!res.ok) {
          if (res.status === 404) {
            setLog(null);
            setError("No output log for this run yet.");
          } else {
            setError(`HTTP ${res.status}`);
          }
          return;
        }
        const text = await res.text();
        if (!cancelled) {
          setLog(text);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchLog();
    const interval = setInterval(fetchLog, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [runId, fetchWithNamespace]);

  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log, autoScroll]);

  if (!runId) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-foreground/30 p-4 text-center">
        Select an event to view output
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-2.5 bg-accent shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <DocumentTextFilled className="h-3.5 w-3.5 text-foreground/40 shrink-0" />
          <span className="text-xs font-medium truncate">output.log</span>
          <span className="text-[10px] text-foreground/40 truncate">{runId}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${
              autoScroll ? "bg-green-500/15 text-green-400" : "text-foreground/40 hover:text-foreground"
            }`}
            title={autoScroll ? "Auto-scroll on" : "Auto-scroll off"}
          >
            {autoScroll ? "follow" : "paused"}
          </button>
          <a
            href={`/api/runs/${encodeURIComponent(runId)}/output`}
            download
            className="p-1 text-foreground/40 hover:text-foreground transition-colors"
            title="Download log"
          >
            <Download className="h-3 w-3" />
          </a>
        </div>
      </div>

      <pre
        ref={logRef}
        onScroll={() => {
          if (!logRef.current) return;
          const { scrollTop, scrollHeight, clientHeight } = logRef.current;
          const atBottom = scrollHeight - scrollTop - clientHeight < 40;
          if (autoScroll && !atBottom) setAutoScroll(false);
          if (!autoScroll && atBottom) setAutoScroll(true);
        }}
        className="flex-1 overflow-auto p-4 text-[11px] leading-relaxed font-mono text-foreground/40 whitespace-pre-wrap break-all"
      >
        {loading && !log ? (
          <span className="text-foreground/30">Loading...</span>
        ) : error ? (
          <span className="text-foreground/30">{error}</span>
        ) : log ? (
          log
        ) : (
          <span className="text-foreground/30">Empty log</span>
        )}
      </pre>
    </div>
  );
}

const filters: { value: ActivityFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "chains", label: "Chains" },
  { value: "agents", label: "Agents" },
  { value: "system", label: "System" },
];

export default function ActivityPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-full">
        <WaveSpinner size="sm" color="primary" animation="ripple" />
      </div>
    }>
      <ActivityPageContent />
    </Suspense>
  );
}

function ActivityPageContent() {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [selected, setSelected] = useState<ActivityEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [, setSseConnected] = useState(false);
  const pollingRef = useRef(true);

  const SIDEBAR_KEY = "activity-sidebar-width";
  const MIN_W = 260;
  const MAX_W = 450;
  const DEFAULT_W = 320;
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_W);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(DEFAULT_W);

  useEffect(() => {
    const saved = localStorage.getItem(SIDEBAR_KEY);
    if (saved) {
      const width = parseInt(saved, 10);
      if (width >= MIN_W && width <= MAX_W) setSidebarWidth(width);
    }
  }, []);

  const onDragStart = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      dragging.current = true;
      startX.current = event.clientX;
      startW.current = sidebarWidth;

      const onMove = (moveEvent: MouseEvent) => {
        if (!dragging.current) return;
        const delta = moveEvent.clientX - startX.current;
        const next = Math.min(MAX_W, Math.max(MIN_W, startW.current + delta));
        setSidebarWidth(next);
      };

      const onUp = () => {
        dragging.current = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        setSidebarWidth((width) => {
          localStorage.setItem(SIDEBAR_KEY, String(width));
          return width;
        });
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [sidebarWidth]
  );

  const fetchActivity = useCallback(async (isPolling = false) => {
    if (!isPolling) setLoading(true);
    try {
      const res = await fetchWithNamespace(`/api/activity?limit=100&filter=${filter}`);
      const data = await res.json() as ActivityResponse;
      const nextEvents = data.events || [];
      setEvents(nextEvents);
      // only auto-select first item on initial load, not on poll
      if (!isPolling) {
        setSelected((current) => {
          if (current && nextEvents.some((event) => event.id === current.id)) {
            return current;
          }
          return nextEvents[0] || null;
        });
      }
    } catch (e) {
      console.error("Failed to fetch activity", e);
    } finally {
      setLoading(false);
    }
  }, [fetchWithNamespace, filter]);

  // SSE connection for real-time updates (reserved for future use)
  useEffect(() => {
    // Reserved for global SSE stream endpoint
    // For now, we use 5-second polling
    setSseConnected(false);
  }, [filter]);

  // Poll for updates
  useEffect(() => {
    fetchActivity();
    const interval = setInterval(() => {
      if (pollingRef.current) {
        fetchActivity(true);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [fetchActivity]);

  return (
    <div className="h-full flex flex-col">
      <PageBanner
        title="Activity Feed"
        subtitle="Real-time chain and agent events across your workspace. Monitor pipeline execution, track agent completions, and catch errors as they happen."
        icon={ActivityFilled}
        sectionColor="#5b9ef5"
        actions={[
          { label: "Runs", href: "/runs", icon: RouteSquareFilled, iconColor: "#5b9ef5" },
          { label: "Chains", href: "/chains", icon: LinkFilled, iconColor: "#b07ee8" },
          { label: "Events", href: "/events", icon: SendFilled, iconColor: "#b07ee8" },
          { label: "Refresh", onClick: () => fetchActivity(), icon: RefreshCw },
        ]}
        docs={[
          { label: "Activity Guide", href: "/docs/activity", icon: ActivityFilled },
        ]}
      />

      {/* 2-panel: list | logs */}
      <div className="flex-1 flex gap-2 overflow-hidden pl-2 sm:pl-4">
        {/* Left: event list (resizable sidebar) */}
        <WorkflowSidebarPane style={{ width: sidebarWidth }}>
          {/* Filters */}
          <div className="shrink-0 space-y-2 bg-accent p-3">
            <WorkflowSidebarSegmentedControl
              options={filters}
              value={filter}
              onChange={setFilter}
            />
          </div>

          {/* Event list */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <WaveSpinner size="sm" color="primary" animation="ripple" />
            </div>
          ) : events.length === 0 ? (
            <div className="flex-1 flex items-center justify-center p-6">
              <EmptyState
                icon={<ActivityFilled className="h-8 w-8" />}
                title="No activity yet"
                description="Run a chain to see activity events here."
                action={{ label: "Go to chains", href: "/chains" }}
              />
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {events.map((event) => (
                <ActivityRow
                  key={event.id}
                  event={event}
                  isSelected={selected?.id === event.id}
                  onClick={() => setSelected(event)}
                />
              ))}
            </div>
          )}

          <WorkflowSidebarResizeHandle onMouseDown={onDragStart} />
        </WorkflowSidebarPane>

        {/* Right: log viewer (full width) */}
        <div className="flex flex-1 flex-col overflow-hidden rounded-xl bg-card">
          {selected && selected.metadata.runId && (
            <div className="flex items-center gap-3 px-4 py-2.5 bg-accent/50 text-xs text-foreground/50 shrink-0">
              <span className="font-semibold text-foreground/70 truncate">{selected.title}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] shrink-0 ${getEventPillColor(selected.type)}`}>
                {getEventTypeLabel(selected.type)}
              </span>
              <span className="ml-auto shrink-0">
                <Link
                  href={`/runs?runId=${selected.metadata.runId}`}
                  className="flex items-center gap-1 text-foreground/40 hover:text-foreground transition-colors"
                >
                  <ExternalLink className="h-3 w-3" />
                  Open run
                </Link>
              </span>
            </div>
          )}
          <div className="flex-1 overflow-hidden">
            <LogPanel
              runId={selected?.metadata.runId}
              fetchWithNamespace={fetchWithNamespace}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
