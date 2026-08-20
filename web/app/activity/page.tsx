"use client";

// Operations Timeline (/activity).
//
// Default view: the operational read model from /api/operations/timeline —
// system health, attention, running now, expected next, waiting, human gates,
// accomplishments, and a provenance-tagged timeline. The legacy chain/agent
// event feed (with the live output log panel) is preserved under the "Feed"
// view toggle.

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useRouter } from "next/navigation";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { useWorkspace } from "@/lib/ui-context/workspace-context";
import { unwrapApiData } from "@/lib/api/api-client";
import {
  RefreshCw,
  DocumentTextFilled,
  ExternalLink,
  Download,
  ActivityFilled,
  RouteSquareFilled,
  LinkFilled,
  SendFilled,
  TaskSquareFilled,
} from "@aliimam/icons";
import { WaveSpinner } from "@/components/ui/wave-spinner";
import { EmptyState } from "@/components/common/empty-state";
import {
  WorkflowSidebarPane,
  WorkflowSidebarItem,
  WorkflowSidebarResizeHandle,
  WorkflowSidebarSegmentedControl,
} from "@/components/ui/workflow-sidebar";
import { PageBanner } from "@/components/ui/page-banner";
import { PulseView } from "@/components/pulse/pulse-view";
import { TimeAgo } from "@/components/shared/time-ago";
import Link from "next/link";
import {
  AccomplishmentsSection,
  AttentionSection,
  GatesSection,
  RunningSection,
  SystemSection,
  UpNextSection,
  WaitingSection,
} from "@/components/operations/operations-sections";
import type { OperationsView, OpsTimelineItem } from "@/lib/operations/operations-read-model";

// ---------------- legacy feed (preserved behavior) ----------------

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

const feedFilters: { value: ActivityFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "chains", label: "Chains" },
  { value: "agents", label: "Agents" },
  { value: "system", label: "System" },
];

function LegacyFeed({ sidebarWidth, onDragStart }: {
  sidebarWidth: number;
  onDragStart: (event: React.MouseEvent) => void;
}) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [selected, setSelected] = useState<ActivityEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const pollingRef = useRef(true);

  const fetchActivity = useCallback(async (isPolling = false) => {
    if (!isPolling) setLoading(true);
    try {
      const res = await fetchWithNamespace(`/api/activity?limit=100&filter=${filter}`);
      const data = await res.json() as ActivityResponse;
      const nextEvents = data.events || [];
      setEvents(nextEvents);
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
    <div className="flex-1 flex gap-2 overflow-hidden pl-2 sm:pl-4">
      {/* Left: event list (resizable sidebar) */}
      <WorkflowSidebarPane style={{ width: sidebarWidth }}>
        <div className="shrink-0 space-y-2 bg-accent p-3">
          <WorkflowSidebarSegmentedControl
            options={feedFilters}
            value={filter}
            onChange={setFilter}
          />
        </div>

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
  );
}

// ---------------- operations timeline (default view) ----------------

type TimelineFilter = "all" | "tasks" | "runs" | "errors" | "recovery" | "decisions";
type TimeRange = "24h" | "7d" | "all";

const timelineFilters: { value: TimelineFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "tasks", label: "Tasks" },
  { value: "runs", label: "Runs" },
  { value: "errors", label: "Errors" },
  { value: "recovery", label: "Recovery" },
  { value: "decisions", label: "Decisions" },
];

const TIMELINE_FILTER_KINDS: Record<Exclude<TimelineFilter, "all">, Set<OpsTimelineItem["kind"]>> = {
  tasks: new Set(["task_created", "task_closed"]),
  runs: new Set(["run_started", "run_completed", "audit_completed"]),
  errors: new Set(["run_failed", "system_error"]),
  recovery: new Set(["run_reaped", "system_recovery"]),
  decisions: new Set(["decision_created", "decision_resolved"]),
};

const TIMELINE_ACCENT: Record<OpsTimelineItem["severity"], string> = {
  info: "bg-foreground/20",
  warn: "bg-orange-400",
  critical: "bg-red-400",
};

const TIMELINE_KIND_PILL: Record<string, string> = {
  task_created: "bg-blue-500/10 text-blue-300",
  task_closed: "bg-emerald-500/15 text-emerald-400",
  run_started: "bg-amber-500/15 text-amber-400",
  run_completed: "bg-emerald-500/15 text-emerald-400",
  run_failed: "bg-red-500/15 text-red-400",
  run_reaped: "bg-orange-500/15 text-orange-400",
  audit_completed: "bg-purple-500/15 text-purple-300",
  decision_created: "bg-blue-500/10 text-blue-300",
  decision_resolved: "bg-emerald-500/15 text-emerald-400",
  system_error: "bg-red-500/15 text-red-400",
  system_recovery: "bg-emerald-500/10 text-emerald-300",
};

function TimelineRow({ item, onOpen }: { item: OpsTimelineItem; onOpen: () => void }) {
  return (
    <WorkflowSidebarItem
      selected={false}
      onClick={onOpen}
      accentClassName={TIMELINE_ACCENT[item.severity]}
    >
      <div className="pl-4">
        <div className="flex items-start justify-between gap-2">
          <span className="line-clamp-2 text-sm font-semibold leading-5">{item.title}</span>
          <TimeAgo
            date={item.at}
            format="short"
            suffix={false}
            className="shrink-0 !text-[10px] text-foreground/30"
          />
        </div>
        {item.detail && (
          <p className="line-clamp-1 text-[11px] text-foreground/40 mt-0.5">{item.detail}</p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-foreground/40">
          <span className={`rounded-full px-2 py-0.5 uppercase tracking-[0.14em] ${TIMELINE_KIND_PILL[item.kind] ?? "bg-foreground/5"}`}>
            {item.kind.replace(/_/g, " ")}
          </span>
          {item.taskId && <span className="font-mono text-foreground/30">{item.taskId}</span>}
          {item.runId && <span className="font-mono text-foreground/30 truncate max-w-[140px]">{item.runId}</span>}
          {item.decisionId && <span className="font-mono text-foreground/30">{item.decisionId}</span>}
          <span className="text-foreground/25">{item.source}</span>
        </div>
      </div>
    </WorkflowSidebarItem>
  );
}

function OperationsTimeline({ sidebarWidth, onDragStart }: {
  sidebarWidth: number;
  onDragStart: (event: React.MouseEvent) => void;
}) {
  const router = useRouter();
  const { fetchWithNamespace } = useNamespaceFetch();
  const { workspacePath, workspaceReady } = useWorkspace();
  const [view, setView] = useState<OperationsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const [range, setRange] = useState<TimeRange>("7d");

  const fetchView = useCallback(async (isPolling = false) => {
    if (!isPolling) setLoading(true);
    try {
      const params = new URLSearchParams();
      if (workspacePath) params.set("workspace", workspacePath);
      const res = await fetchWithNamespace(`/api/operations/timeline?${params}`);
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const data = unwrapApiData<{ view: OperationsView | null }>(await res.json());
      setView(data.view);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [fetchWithNamespace, workspacePath]);

  useEffect(() => {
    if (!workspaceReady) return;
    fetchView();
    const interval = setInterval(() => fetchView(true), 15_000);
    return () => clearInterval(interval);
  }, [fetchView, workspaceReady]);

  const rangeMs = range === "24h" ? 24 * 60 * 60 * 1000 : range === "7d" ? 7 * 24 * 60 * 60 * 1000 : Infinity;
  const timeline = (view?.timeline ?? [])
    .filter((item) => filter === "all" || TIMELINE_FILTER_KINDS[filter].has(item.kind))
    .filter((item) => rangeMs === Infinity || Date.now() - Date.parse(item.at) <= rangeMs);

  if (loading && !view) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <WaveSpinner size="sm" color="primary" animation="ripple" />
      </div>
    );
  }

  if (!view) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <EmptyState
          icon={<ActivityFilled className="h-8 w-8" />}
          title="Operations view unavailable"
          description={error ?? "Select a workspace to see its operational state."}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 flex gap-2 overflow-hidden pl-2 sm:pl-4">
      {/* Left: timeline (resizable sidebar) */}
      <WorkflowSidebarPane style={{ width: sidebarWidth }} className="hidden md:flex">
        <div className="shrink-0 space-y-2 bg-accent p-3">
          <WorkflowSidebarSegmentedControl
            options={timelineFilters}
            value={filter}
            onChange={setFilter}
          />
          <WorkflowSidebarSegmentedControl
            options={[
              { value: "24h" as TimeRange, label: "24h" },
              { value: "7d" as TimeRange, label: "7d" },
              { value: "all" as TimeRange, label: "All" },
            ]}
            value={range}
            onChange={setRange}
          />
        </div>

        {timeline.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-6">
            <EmptyState
              icon={<ActivityFilled className="h-8 w-8" />}
              title="No timeline events"
              description="Nothing persisted matches this filter and time range."
            />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {timeline.map((item, index) => (
              <TimelineRow
                key={`${item.kind}-${item.at}-${index}`}
                item={item}
                onOpen={() => item.actionUrl && router.push(item.actionUrl)}
              />
            ))}
          </div>
        )}

        <WorkflowSidebarResizeHandle onMouseDown={onDragStart} />
      </WorkflowSidebarPane>

      {/* Right: operational overview */}
      <div className="flex-1 overflow-y-auto rounded-xl bg-muted p-3 space-y-3 min-w-0">
        <SystemSection view={view} />
        <AttentionSection items={view.attention} />
        <RunningSection items={view.runningNow} />
        <UpNextSection items={view.upNext} />
        <WaitingSection states={view.waiting} />
        <GatesSection gates={view.humanGates} />
        <AccomplishmentsSection items={view.recentAccomplishments} />
        {/* Mobile: the timeline lives below the overview instead of a sidebar */}
        <section className="md:hidden rounded-md bg-card p-3 space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground/40">Timeline</h2>
          <div className="space-y-1">
            {timeline.slice(0, 30).map((item, index) => (
              <TimelineRow
                key={`m-${item.kind}-${item.at}-${index}`}
                item={item}
                onOpen={() => item.actionUrl && router.push(item.actionUrl)}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

// ---------------- page shell ----------------

type PageView = "operations" | "feed" | "pulse";

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
  const [pageView, setPageView] = useState<PageView>(() => {
    if (typeof window === "undefined") return "operations";
    const v = new URLSearchParams(window.location.search).get("view");
    return v === "pulse" || v === "feed" ? v : "operations";
  });

  const SIDEBAR_KEY = "activity-sidebar-width";
  const MIN_W = 260;
  const MAX_W = 450;
  const DEFAULT_W = 320;
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_W;
    const saved = window.localStorage.getItem(SIDEBAR_KEY);
    const width = saved ? parseInt(saved, 10) : DEFAULT_W;
    return width >= MIN_W && width <= MAX_W ? width : DEFAULT_W;
  });
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(DEFAULT_W);

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

  return (
    <div className="h-full flex flex-col">
      <PageBanner
        title="Pulse"
        subtitle="One truthful view of the system: what is running, what runs next and why, what is blocked, what needs you, and what was accomplished — with the evidence."
        icon={ActivityFilled}
        sectionColor="#f59e0b"
        actions={[
          { label: "Tasks", href: "/tasks", icon: TaskSquareFilled, iconColor: "#5b9ef5" },
          { label: "Runs", href: "/runs", icon: RouteSquareFilled, iconColor: "#5b9ef5" },
          { label: "Chains", href: "/chains", icon: LinkFilled, iconColor: "#b07ee8" },
          { label: "Events", href: "/events", icon: SendFilled, iconColor: "#b07ee8" },
          { label: "Refresh", onClick: () => window.location.reload(), icon: RefreshCw },
        ]}
        docs={[
          { label: "Activity Guide", href: "/docs/activity", icon: ActivityFilled },
        ]}
      />

      <div className="shrink-0 flex items-center px-2 sm:px-4 pb-2">
        <div className="w-[320px]">
          <WorkflowSidebarSegmentedControl
            options={[
              { value: "operations" as PageView, label: "Operations" },
              { value: "feed" as PageView, label: "Feed" },
              { value: "pulse" as PageView, label: "Pulse" },
            ]}
            value={pageView}
            onChange={setPageView}
          />
        </div>
      </div>

      {pageView === "operations" ? (
        <OperationsTimeline sidebarWidth={sidebarWidth} onDragStart={onDragStart} />
      ) : pageView === "feed" ? (
        <LegacyFeed sidebarWidth={sidebarWidth} onDragStart={onDragStart} />
      ) : (
        <div className="dark relative min-h-0 flex-1 text-foreground">
          <PulseView />
        </div>
      )}
    </div>
  );
}
