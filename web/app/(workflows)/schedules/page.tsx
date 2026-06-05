"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { useWorkspace } from "@/lib/ui-context/workspace-context";
import { useSharedChains } from "@/lib/chains/chains-store";
import { Button } from "@/components/ui/button";
import { DetailHeader } from "@/components/ui/detail-header";
import { PageBanner } from "@/components/ui/page-banner";
import { LinkFilled, RouteSquareFilled, SendFilled } from "@aliimam/icons";
import {
  WorkflowSidebarFilters,
  WorkflowSidebarItem,
  WorkflowSidebarPane,
  WorkflowSidebarResizeHandle,
  WorkflowSidebarSearchInput,
  WorkflowSidebarSegmentedControl,
} from "@/components/ui/workflow-sidebar";
import { WaveSpinner } from "@/components/ui/wave-spinner";
import { EmptyState } from "@/components/empty-state";
import { TimeAgo } from "@/components/shared/time-ago";
import { ScheduleHistory, ScheduleCreateDialog, ScheduleGenerateDialog } from "@/components/schedule";
import { SnoozeButton, CountdownTimer, UnSnoozeButton } from "@/components/schedule/snooze";
import {
  getScheduleCreateTargetLabel,
  getScheduleTargetSummary,
  getScheduleTriggerSummary,
} from "@/components/schedule/schedule-create-payload";
import { useSnoozeState } from "@/lib/hooks/use-snooze-state";
import { CRON_PRESETS, getTimezones, isValidCron, isValidTimezone, getCronDescription } from "@/lib/schedules/schedule-utils";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AddFilled,
  RefreshCw,
  PlayFilled,
  MagicStarFilled,
  DangerFilled as AlertTriangle,
  StopFilled,
  SecurityTimeFilled as ShieldIcon,
  ClockFilled,
  TickCircleFilled as CheckIcon,
  CloseCircleFilled as XIcon,
  TrashFilled,
} from "@aliimam/icons";
import { cn } from "@/lib/utils";
import type { ScheduleTarget, ScheduleTrigger } from "@/lib/types";

interface Schedule {
  id: string;
  name: string;
  chainId: string;
  chainName: string;
  target?: ScheduleTarget;
  trigger?: ScheduleTrigger;
  jobGroupId?: string;
  schedule: string;
  timezone: string;
  enabled: boolean;
  status: "enabled" | "disabled" | "snoozed" | "paused";
  workspaceId?: string;
  goal?: string;
  description?: string;
  retryCount: number;
  snoozedUntil: string | null;
  lastRun: string | null;
  nextRun: string | null;
  avgDuration?: number;
  runCount?: number;
  createdAt?: string;
  conflictDetected?: boolean;
  conflictingChains?: string[];
}

interface CircuitBreakerState {
  enabled: boolean;
  maxConcurrentRuns: number;
  tripped: boolean;
  tripTime?: string;
  tripReason?: string;
  activeRuns: number;
  totalRunsToday: number;
}

interface DaemonStatus {
  status: "running" | "stopped";
  pid?: number;
  uptime?: number;
  lastCheck?: string;
}

type FilterStatus = "all" | "enabled" | "disabled" | "paused";

const STATUS_FILTER_OPTIONS: Array<{ value: FilterStatus; label: string }> = [
  { value: "all", label: "All" },
  { value: "enabled", label: "Enabled" },
  { value: "disabled", label: "Disabled" },
  { value: "paused", label: "Paused" },
];

const SIDEBAR_KEY = "schedules-sidebar-width";
const MIN_W = 280;
const MAX_W = 600;
const DEFAULT_W = 340;

function statusAccent(schedule: Schedule): string {
  if (schedule.enabled && schedule.status === "enabled") return "bg-emerald-400";
  if (schedule.status === "paused" || schedule.status === "snoozed") return "bg-amber-400";
  return "bg-foreground/20";
}

function statusPillColor(status: Schedule["status"]): string {
  switch (status) {
    case "enabled":
      return "bg-emerald-500/15 text-emerald-400";
    case "disabled":
      return "bg-foreground/5 text-foreground/40";
    case "paused":
    case "snoozed":
      return "bg-amber-500/15 text-amber-400";
    default:
      return "bg-foreground/5 text-foreground/40";
  }
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export default function SchedulesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <WaveSpinner size="sm" color="primary" animation="ripple" />
        </div>
      }
    >
      <SchedulesPageContent />
    </Suspense>
  );
}

function SchedulesPageContent() {
  const { workspaceId, workspacePath, workspaceReady } = useWorkspace();
  const { fetchWithNamespace } = useNamespaceFetch();

  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [selected, setSelected] = useState<Schedule | null>(null);
  const selectedRef = useRef<Schedule | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");

  // circuit breaker + daemon
  const [circuitBreaker, setCircuitBreaker] = useState<CircuitBreakerState | null>(null);
  const [daemon, setDaemon] = useState<DaemonStatus | null>(null);

  // new schedule dialog
  const [newOpen, setNewOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);


  // resizable sidebar
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_W);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(DEFAULT_W);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    const saved = localStorage.getItem(SIDEBAR_KEY);
    if (saved) {
      const w = parseInt(saved, 10);
      if (w >= MIN_W && w <= MAX_W) setSidebarWidth(w);
    }
  }, []);

  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      startX.current = e.clientX;
      startW.current = sidebarWidth;

      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const delta = ev.clientX - startX.current;
        const next = Math.min(MAX_W, Math.max(MIN_W, startW.current + delta));
        setSidebarWidth(next);
      };

      const onUp = () => {
        dragging.current = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        setSidebarWidth((w) => {
          localStorage.setItem(SIDEBAR_KEY, String(w));
          return w;
        });
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [sidebarWidth]
  );

  const fetchSchedules = useCallback(
    async (isPolling = false) => {
      if (!isPolling) setLoading(true);
      try {
        const params = workspaceId ? `?workspace=${encodeURIComponent(workspaceId)}` : "";
        const res = await fetchWithNamespace(`/api/schedules${params}`);
        const data = await res.json();
        const items: Schedule[] = data.schedules || [];
        setSchedules(items);

        if (items.length && !selectedRef.current) {
          setSelected(items[0]);
        }
        if (selectedRef.current) {
          const updated = items.find(
            (s) => s.id === selectedRef.current!.id
          );
          if (updated) setSelected(updated);
        }
      } catch {
        setSchedules([]);
      } finally {
        setLoading(false);
      }
    },
    [workspaceId, fetchWithNamespace]
  );

  const fetchControlPlane = useCallback(async () => {
    try {
      const [cbRes, dmRes] = await Promise.all([
        fetchWithNamespace("/api/schedules/circuit-breaker"),
        fetchWithNamespace("/api/schedules/daemon"),
      ]);
      if (cbRes.ok) setCircuitBreaker(await cbRes.json());
      if (dmRes.ok) setDaemon(await dmRes.json());
    } catch {
      // non-fatal
    }
  }, [fetchWithNamespace]);

  useEffect(() => {
    if (!workspaceReady) return;
    setSelected(null);
    selectedRef.current = null;
    fetchSchedules();
    fetchControlPlane();
    const interval = setInterval(() => {
      fetchSchedules(true);
      fetchControlPlane();
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchSchedules, fetchControlPlane, workspaceReady]);


  const handleToggle = async (schedId: string, enabled: boolean) => {
    try {
      await fetchWithNamespace("/api/schedules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: schedId, enabled }),
      });
      setSchedules((prev) =>
        prev.map((s) =>
          s.id === schedId
            ? { ...s, enabled, status: enabled ? "enabled" : "disabled" }
            : s
        )
      );
      if (selectedRef.current?.id === schedId) {
        setSelected((prev) =>
          prev
            ? { ...prev, enabled, status: enabled ? "enabled" : "disabled" }
            : prev
        );
      }
    } catch {
      // ignore
    }
  };

  const handleRunNow = async (schedId: string) => {
    try {
      await fetchWithNamespace("/api/schedules/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: schedId, triggeredBy: "manual" }),
      });
      fetchSchedules();
    } catch {
      // ignore
    }
  };

  const handleSaveSchedule = async (updates: Record<string, unknown>) => {
    if (!selected) return;
    try {
      const res = await fetchWithNamespace("/api/schedules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selected.id,
          ...updates,
        }),
      });
      if (res.ok) {
        fetchSchedules();
      }
    } catch {
      // ignore
    }
  };

  const handleSnooze = async (schedId: string, duration: string) => {
    try {
      await fetchWithNamespace("/api/schedules/snooze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleId: schedId, duration }),
      });
      fetchSchedules();
    } catch {
      // ignore
    }
  };

  const handleUnsnooze = async (schedId: string) => {
    try {
      await fetchWithNamespace(
        `/api/schedules/snooze?scheduleId=${encodeURIComponent(schedId)}`,
        { method: "DELETE" }
      );
      fetchSchedules();
    } catch {
      // ignore
    }
  };

  const handleDeleteSchedule = async (schedId: string) => {
    try {
      const res = await fetchWithNamespace(
        `/api/schedules?id=${encodeURIComponent(schedId)}&action=delete`,
        { method: "DELETE" }
      );
      if (res.ok) {
        setSelected(null);
        selectedRef.current = null;
        fetchSchedules();
      }
    } catch {
      // ignore
    }
  };


  const handleSelect = (schedule: Schedule) => {
    setSelected(schedule);
    setMobileView("detail");
  };


  // circuit breaker actions
  const handleCBAction = async (action: string, reason?: string) => {
    try {
      await fetchWithNamespace("/api/schedules/circuit-breaker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason }),
      });
      fetchControlPlane();
    } catch {
      // ignore
    }
  };

  const handleCBUpdate = async (updates: Partial<CircuitBreakerState>) => {
    try {
      await fetchWithNamespace("/api/schedules/circuit-breaker", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      fetchControlPlane();
    } catch {
      // ignore
    }
  };

  const handleDaemonToggle = async () => {
    try {
      if (daemon?.status === "running") {
        await fetchWithNamespace("/api/schedules/daemon", { method: "DELETE" });
      } else {
        await fetchWithNamespace("/api/schedules/daemon", { method: "POST" });
      }
      fetchControlPlane();
    } catch {
      // ignore
    }
  };

  const filtered = schedules
    .filter((s) => {
      const targetSummary = getScheduleTargetSummary(s.target, s.chainName).toLowerCase();
      const triggerSummary = getScheduleTriggerSummary(s.trigger, s.schedule, s.timezone).toLowerCase();
      const matchesSearch =
        searchQuery === "" ||
        s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.chainName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.schedule.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.chainId.toLowerCase().includes(searchQuery.toLowerCase()) ||
        targetSummary.includes(searchQuery.toLowerCase()) ||
        triggerSummary.includes(searchQuery.toLowerCase());
      const matchesFilter =
        filterStatus === "all" || s.status === filterStatus;
      return matchesSearch && matchesFilter;
    })
    .sort((a, b) => {
      // enabled first, then by target summary
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      return getScheduleTargetSummary(a.target, a.chainName).localeCompare(
        getScheduleTargetSummary(b.target, b.chainName),
      );
    });

  return (
    <>
      <div className="flex h-full flex-col">
        <PageBanner
          title={workspacePath ? "Workspace Schedules" : "Schedules"}
          subtitle={workspacePath ? "Scheduled targets filtered by the active workspace." : "Run chains, generated tasks, tasks, applications, and executables from cron or file triggers."}
          icon={ClockFilled}
          sectionColor="#b07ee8"
          actions={[
            { label: "Chains", href: "/chains", icon: LinkFilled, iconColor: "#b07ee8" },
            { label: "Runs", href: "/runs", icon: RouteSquareFilled, iconColor: "#5b9ef5" },
            { label: "Events", href: "/events", icon: SendFilled, iconColor: "#b07ee8" },
          ]}
          docs={[
            { label: "Schedules Guide", href: "/docs/schedules", icon: ClockFilled },
          ]}
        />

        {/* control plane banner */}
        <ControlPlaneBanner
          circuitBreaker={circuitBreaker}
          daemon={daemon}
          onCBAction={handleCBAction}
          onCBUpdate={handleCBUpdate}
          onDaemonToggle={handleDaemonToggle}
        />

        <div className="flex flex-1 overflow-hidden pl-4">
          {/* left sidebar */}
          <WorkflowSidebarPane
            className={cn(
              mobileView === "detail" ? "hidden md:flex" : "flex"
            )}
            style={{ width: sidebarWidth }}
          >
            <WorkflowSidebarFilters>
              <div className="flex items-center gap-1.5">
                <WorkflowSidebarSearchInput
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder="Search schedules..."
                />
                <Button size="sm" variant="default" className="shrink-0" onClick={() => setNewOpen(true)} title="New schedule">
                  <AddFilled className="h-3 w-3" />
                </Button>
                <Button size="sm" variant="default" className="shrink-0" onClick={() => setGenerateOpen(true)} title="Schedule task generation">
                  <MagicStarFilled className="h-3 w-3" />
                </Button>
                <Button size="sm" variant="default" className="shrink-0" onClick={() => fetchSchedules()} title="Refresh">
                  <RefreshCw className="h-3 w-3" />
                </Button>
              </div>
              <WorkflowSidebarSegmentedControl
                options={STATUS_FILTER_OPTIONS}
                value={filterStatus}
                onChange={setFilterStatus}
              />
            </WorkflowSidebarFilters>

            <div className="flex-1 overflow-y-auto">
              {loading && schedules.length === 0 ? (
                <div className="flex items-center justify-center py-12">
                  <WaveSpinner size="sm" color="primary" animation="ripple" />
                </div>
              ) : filtered.length === 0 ? (
                searchQuery || filterStatus !== "all" ? (
                  <div className="text-center py-12 text-xs text-foreground/40">
                    No schedules match filters
                  </div>
                ) : (
                  <EmptyState
                    icon={<ClockFilled className="h-8 w-8" />}
                    title="No schedules"
                    description="Create a scheduled chain, generated task, task run, app, or executable"
                    action={{
                      label: "New Schedule",
                      onClick: () => setNewOpen(true),
                    }}
                  />
                )
              ) : (
                <div className="p-2 space-y-1">
                  {filtered.map((schedule) => (
                    <WorkflowSidebarItem
                      key={schedule.id}
                      selected={selected?.id === schedule.id}
                      onClick={() => handleSelect(schedule)}
                      accentClassName={statusAccent(schedule)}
                    >
                      <div className="pl-4">
                        <div className="flex items-start justify-between gap-2">
                          <span className="line-clamp-1 text-sm font-semibold leading-5">
                            {schedule.name || schedule.chainName}
                          </span>
                          <span className="shrink-0 text-[10px] text-foreground/30">
                            {schedule.lastRun ? (
                              <TimeAgo
                                date={schedule.lastRun}
                                format="short"
                                suffix={false}
                              />
                            ) : null}
                          </span>
                        </div>
                        <p className="line-clamp-1 text-[11px] text-foreground/40 mt-0.5">
                          {getScheduleTriggerSummary(schedule.trigger, schedule.schedule, schedule.timezone)}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-foreground/40">
                          <span
                            className={`rounded-full px-2 py-0.5 uppercase tracking-[0.14em] ${statusPillColor(schedule.status)}`}
                          >
                            {schedule.status}
                          </span>
                          <span className="rounded-full bg-foreground/5 px-2 py-0.5">
                            {getScheduleCreateTargetLabel(schedule.target)}
                          </span>
                          {schedule.jobGroupId ? (
                            <span className="rounded-full bg-foreground/5 px-2 py-0.5 font-mono">
                              {schedule.jobGroupId}
                            </span>
                          ) : null}
                          {schedule.snoozedUntil && (
                            <CountdownTimer snoozedUntil={schedule.snoozedUntil} />
                          )}
                          {schedule.runCount ? (
                            <span className="rounded-full bg-foreground/5 px-2 py-0.5">
                              {schedule.runCount} runs
                            </span>
                          ) : null}
                          {schedule.conflictDetected ? (
                            <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-red-400">
                              conflict
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </WorkflowSidebarItem>
                  ))}
                </div>
              )}
            </div>

            <WorkflowSidebarResizeHandle onMouseDown={onDragStart} />
          </WorkflowSidebarPane>

          {/* right detail panel */}
          <div
            className={`${mobileView === "list" ? "hidden md:flex" : "flex"} flex-1 flex-col overflow-hidden`}
          >
            {selected ? (
                <ScheduleDetailPanel
                  key={selected.id}
                  schedule={selected}
                  onSave={handleSaveSchedule}
                  onToggle={handleToggle}
                  onRunNow={handleRunNow}
                  onDelete={handleDeleteSchedule}
                  onSnooze={handleSnooze}
                  onUnsnooze={handleUnsnooze}
                  onBack={
                    mobileView === "detail"
                      ? () => setMobileView("list")
                      : undefined
                  }
                />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground/60">
                Select a schedule to view details
              </div>
            )}
          </div>
        </div>
      </div>

      {/* new schedule dialog */}
      <ScheduleCreateDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={() => fetchSchedules()}
      />

      <ScheduleGenerateDialog
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        onCreated={() => fetchSchedules()}
      />

    </>
  );
}

// ---------------------------------------------------------------------------
// control plane banner: daemon status + circuit breaker
// ---------------------------------------------------------------------------

interface ControlPlaneBannerProps {
  circuitBreaker: CircuitBreakerState | null;
  daemon: DaemonStatus | null;
  onCBAction: (action: string, reason?: string) => void;
  onCBUpdate: (updates: Partial<CircuitBreakerState>) => void;
  onDaemonToggle: () => void;
}

function ControlPlaneBanner({
  circuitBreaker,
  daemon,
  onCBAction,
  onCBUpdate,
  onDaemonToggle,
}: ControlPlaneBannerProps) {
  const [maxRunsInput, setMaxRunsInput] = useState("");
  const cb = circuitBreaker;

  // tripped banner
  if (cb?.tripped) {
    return (
      <div className="mx-4 mb-2 rounded-md bg-red-500/10 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-400" />
            <span className="text-xs font-medium text-red-400">
              Circuit breaker tripped
            </span>
            {cb.tripReason && (
              <span className="text-[11px] text-red-400/60">
                {cb.tripReason}
              </span>
            )}
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[11px] text-red-400 hover:text-red-300"
            onClick={() => onCBAction("reset")}
          >
            Reset
          </Button>
        </div>
      </div>
    );
  }

  // kill switch active
  if (cb && !cb.enabled) {
    return (
      <div className="mx-4 mb-2 rounded-md bg-amber-500/10 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StopFilled className="h-4 w-4 text-amber-400" />
            <span className="text-xs font-medium text-amber-400">
              Scheduler disabled (kill switch active)
            </span>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[11px] text-amber-400 hover:text-amber-300"
            onClick={() => onCBAction("enable")}
          >
            Re-enable
          </Button>
        </div>
      </div>
    );
  }

  // normal status bar
  return (
    <div className="mx-4 mb-2 flex items-center justify-between rounded-md bg-foreground/[0.03] px-4 py-2">
      <div className="flex items-center gap-4 text-[11px] text-foreground/50">
        {/* daemon status */}
        <div className="flex items-center gap-1.5">
          <div
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              daemon?.status === "running" ? "bg-emerald-400" : "bg-foreground/20"
            )}
          />
          <span>
            daemon {daemon?.status === "running" ? "running" : "stopped"}
          </span>
          {daemon?.status === "running" && daemon.uptime != null && (
            <span className="text-foreground/30">
              ({formatUptime(daemon.uptime)})
            </span>
          )}
          <button
            onClick={onDaemonToggle}
            className="ml-1 text-[10px] text-foreground/40 hover:text-foreground/70 underline underline-offset-2"
          >
            {daemon?.status === "running" ? "stop" : "start"}
          </button>
        </div>

        {/* separator */}
        <div className="h-3 w-px bg-foreground/10" />

        {/* circuit breaker stats */}
        {cb && (
          <>
            <div className="flex items-center gap-1.5">
              <ShieldIcon className="h-3 w-3" />
              <span>
                {cb.activeRuns}/{cb.maxConcurrentRuns} active
              </span>
            </div>

            <span className="text-foreground/30">
              {cb.totalRunsToday} today
            </span>
          </>
        )}
      </div>

      {/* controls */}
      {cb && (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <label className="text-[10px] text-foreground/30">max</label>
            <Input
              type="number"
              min={1}
              max={20}
              value={maxRunsInput || String(cb.maxConcurrentRuns)}
              onChange={(e) => setMaxRunsInput(e.target.value)}
              onBlur={() => {
                const val = parseInt(maxRunsInput);
                if (val > 0 && val !== cb.maxConcurrentRuns) {
                  onCBUpdate({ maxConcurrentRuns: val });
                }
                setMaxRunsInput("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  (e.target as HTMLInputElement).blur();
                }
              }}
              className="h-6 w-12 text-center text-[11px] px-1"
            />
          </div>
          <button
            onClick={() => onCBAction("kill-switch")}
            className="text-[10px] text-foreground/30 hover:text-red-400 underline underline-offset-2"
            title="Kill switch: stop all scheduled runs"
          >
            kill switch
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// detail panel: viewer (default) + editor (on edit click)
// ---------------------------------------------------------------------------

interface ScheduleDetailPanelProps {
  schedule: Schedule;
  onSave: (updates: Record<string, unknown>) => void;
  onToggle: (scheduleId: string, enabled: boolean) => void;
  onRunNow: (scheduleId: string) => void;
  onDelete: (scheduleId: string) => void;
  onSnooze: (scheduleId: string, duration: string) => void;
  onUnsnooze: (scheduleId: string) => void;
  onBack?: () => void;
}

function ScheduleDetailPanel({
  schedule,
  onSave,
  onToggle,
  onRunNow,
  onDelete,
  onSnooze,
  onUnsnooze,
  onBack,
}: ScheduleDetailPanelProps) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Poll for snooze state
  const { snoozeState, loading: snoozeLoading } = useSnoozeState(schedule.id, {
    pollInterval: 5000,
    enabled: schedule.status === "snoozed" || !!schedule.snoozedUntil,
  });
  const targetLabel = getScheduleCreateTargetLabel(schedule.target);
  const targetSummary = getScheduleTargetSummary(schedule.target, schedule.chainName);
  const triggerSummary = getScheduleTriggerSummary(schedule.trigger, schedule.schedule, schedule.timezone);
  const canEditInline = !schedule.target || schedule.target.type === "chain_run";

  if (editing) {
    return (
      <ScheduleEditForm
        schedule={schedule}
        onSave={(updates) => {
          onSave(updates);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* header */}
      <div className="shrink-0 px-3 pt-2">
        <DetailHeader>
          <div className="relative flex items-center gap-3">
            {onBack && (
              <button
                onClick={onBack}
                className="md:hidden text-xs text-foreground/50 hover:text-foreground"
              >
                Back
              </button>
            )}
            <div>
              <h2 className="text-base font-bold tracking-tighter">{schedule.name || schedule.chainName}</h2>
              <p className="mt-0.5 text-[11px] text-foreground/30">
                {targetLabel} - {targetSummary}
              </p>
            </div>
          </div>
          <div className="relative flex items-center gap-2">
            {canEditInline && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => setEditing(true)}
              >
                Edit
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => onRunNow(schedule.id)}
            >
              <PlayFilled className="h-3 w-3 mr-1" />
              Run Now
            </Button>
            <Switch
              checked={schedule.enabled}
              onCheckedChange={(checked) => onToggle(schedule.id, checked)}
              className="scale-75"
            />
          </div>
        </DetailHeader>
      </div>

      <div className="mx-6 h-px bg-foreground/5" />

      {/* schedule info cards */}
      <div className="px-6 py-4 space-y-4">
        {/* status + schedule row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <InfoCard label="status">
            <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] ${statusPillColor(schedule.status)}`}>
              {schedule.status}
            </span>
          </InfoCard>
          <InfoCard label="trigger">
            <span className="truncate font-mono text-xs">{triggerSummary}</span>
          </InfoCard>
        </div>

        {/* target + workspace row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <InfoCard label={targetLabel.toLowerCase()}>
            <span className="truncate text-xs">{targetSummary}</span>
          </InfoCard>
          <InfoCard label="workspace">
            <span className="text-xs">{schedule.workspaceId || "none"}</span>
          </InfoCard>
        </div>

        {schedule.jobGroupId && (
          <InfoCard label="job group">
            <span className="font-mono text-xs">{schedule.jobGroupId}</span>
          </InfoCard>
        )}

        {/* runs + timing row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <InfoCard label="runs">
            <span className="text-xs">{schedule.runCount || 0}</span>
            {schedule.avgDuration ? (
              <span className="text-[10px] text-foreground/25 ml-1.5">
                avg {schedule.avgDuration < 1000 ? `${schedule.avgDuration}ms` : `${(schedule.avgDuration / 1000).toFixed(1)}s`}
              </span>
            ) : null}
          </InfoCard>
          <InfoCard label="last run">
            {schedule.lastRun ? (
              <TimeAgo date={schedule.lastRun} format="long" className="text-xs" />
            ) : (
              <span className="text-xs text-foreground/25">never</span>
            )}
          </InfoCard>
          <InfoCard label="next run">
            {schedule.nextRun ? (
              <span className="text-xs">
                {new Date(schedule.nextRun).toLocaleString(undefined, {
                  month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                })}
              </span>
            ) : (
              <span className="text-xs text-foreground/25">-</span>
            )}
          </InfoCard>
        </div>

        {/* description */}
        {schedule.description && (
          <InfoCard label="description">
            <p className="text-xs text-foreground/70">{schedule.description}</p>
          </InfoCard>
        )}

        {/* goal */}
        {schedule.goal && (
          <InfoCard label="goal">
            <p className="text-xs text-foreground/70">{schedule.goal}</p>
          </InfoCard>
        )}

        {/* retry */}
        {schedule.retryCount > 0 && (
          <InfoCard label="retries">
            <span className="text-xs">{schedule.retryCount} on failure</span>
          </InfoCard>
        )}

        {/* alerts */}
        {schedule.conflictDetected && schedule.conflictingChains?.length ? (
          <div className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-400">
            Conflict detected with: {schedule.conflictingChains.join(", ")}
          </div>
        ) : null}

        {/* snooze */}
        {schedule.snoozedUntil || snoozeState ? (
          <div className="rounded-md bg-amber-500/10 px-3 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs text-amber-400">
                {schedule.snoozedUntil && snoozeState ? (
                  <>Snoozed until {new Date(schedule.snoozedUntil).toLocaleString()}</>
                ) : (
                  <>Snoozed</>
                )}
              </span>
              {(schedule.snoozedUntil || snoozeState?.snoozedUntil) && (
                <CountdownTimer snoozedUntil={schedule.snoozedUntil || snoozeState!.snoozedUntil} />
              )}
            </div>
            <UnSnoozeButton
              onUnsnooze={() => onUnsnooze(schedule.id)}
              disabled={snoozeLoading}
            />
          </div>
        ) : (
          <SnoozeButton
            onSnooze={(duration) => onSnooze(schedule.id, duration)}
            disabled={snoozeLoading}
          />
        )}

        {/* delete */}
        <div className="pt-2">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-400">Delete this schedule?</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-xs text-red-400 hover:text-red-300"
                onClick={() => onDelete(schedule.id)}
              >
                Confirm
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-xs"
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 text-xs text-foreground/30 hover:text-red-400 transition-colors"
            >
              <TrashFilled className="h-3 w-3" />
              Delete schedule
            </button>
          )}
        </div>
      </div>

      <div className="mx-6 h-px bg-foreground/5" />

      {/* inline history */}
      <div className="flex-1 min-h-0">
        <ScheduleHistory
          scheduleId={schedule.chainId}
          chainName={schedule.chainName}
          open={true}
          onClose={() => {}}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// full edit form
// ---------------------------------------------------------------------------

interface Chain { id: string; name: string }
interface Workspace { id: string; name: string; path: string }

function ScheduleEditForm({
  schedule,
  onSave,
  onCancel,
}: {
  schedule: Schedule;
  onSave: (updates: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const { chains: sharedChains } = useSharedChains();
  const chains: Chain[] = sharedChains.map((c) => ({ id: c.id, name: c.name }));

  const [name, setName] = useState(schedule.name || "");
  const [description, setDescription] = useState(schedule.description || "");
  const [chainId, setChainId] = useState(schedule.chainId);
  const [workspaceId, setWorkspaceId] = useState(schedule.workspaceId || "__none__");
  const [cron, setCron] = useState(schedule.schedule);
  const userTz = typeof window !== "undefined"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : "UTC";
  const knownTimezones = getTimezones();
  const timezoneList = knownTimezones.includes(userTz) || !isValidTimezone(userTz)
    ? knownTimezones
    : [userTz, ...knownTimezones];
  const [timezone, setTimezone] = useState(schedule.timezone);
  const [enabled, setEnabled] = useState(schedule.enabled);
  const [retryCount, setRetryCount] = useState(schedule.retryCount);
  const [goal, setGoal] = useState(schedule.goal || "");
  const [showCustomCron, setShowCustomCron] = useState(
    !CRON_PRESETS.some((p) => p.expression === schedule.schedule)
  );

  const { workspaces } = useWorkspace();

  const handleSubmit = () => {
    const updates: Record<string, unknown> = {};
    if (name !== schedule.name) updates.name = name;
    if (description !== (schedule.description || "")) updates.description = description || undefined;
    if (chainId !== schedule.chainId) {
      updates.chainId = chainId;
      updates.chainName = chains.find((c) => c.id === chainId)?.name || chainId;
    }
    const resolvedWs = workspaceId === "__none__" ? "" : workspaceId;
    if (resolvedWs !== (schedule.workspaceId || "")) updates.workspacePath = resolvedWs || undefined;
    if (cron !== schedule.schedule) updates.schedule = cron;
    if (timezone !== schedule.timezone) updates.timezone = timezone;
    if (enabled !== schedule.enabled) updates.enabled = enabled;
    if (retryCount !== schedule.retryCount) updates.retryCount = retryCount;
    if (goal !== (schedule.goal || "")) updates.goal = goal || undefined;

    onSave(updates);
  };

  const canSave = name.trim().length > 0 && chainId.length > 0 && isValidCron(cron);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="shrink-0 px-6 py-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Edit Schedule</h2>
        <button
          onClick={onCancel}
          className="text-xs text-foreground/40 hover:text-foreground/70 underline underline-offset-2"
        >
          cancel
        </button>
      </div>
      <div className="mx-6 h-px bg-foreground/5" />

      <div className="flex-1 px-6 py-4 space-y-5">
        {/* name */}
        <div>
          <Label className="text-xs text-foreground/50">Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1.5 h-9 text-xs"
          />
        </div>

        {/* description */}
        <div>
          <Label className="text-xs text-foreground/50">Description</Label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
            className="mt-1.5 h-9 text-xs"
          />
        </div>

        {/* chain */}
        <div>
          <Label className="text-xs text-foreground/50">Chain</Label>
          <Select value={chainId} onValueChange={setChainId}>
            <SelectTrigger className="mt-1.5 h-9 text-xs">
              <SelectValue placeholder="Select a chain..." />
            </SelectTrigger>
            <SelectContent>
              {chains.map((c) => (
                <SelectItem key={c.id} value={c.id} className="text-xs">
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* workspace */}
        <div>
          <Label className="text-xs text-foreground/50">Workspace</Label>
          <Select value={workspaceId} onValueChange={setWorkspaceId}>
            <SelectTrigger className="mt-1.5 h-9 text-xs">
              <SelectValue placeholder="No workspace" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__" className="text-xs">None</SelectItem>
              {workspaces.map((w) => (
                <SelectItem key={w.id} value={w.id} className="text-xs">
                  <span>{w.name}</span>
                  <span className="ml-2 text-foreground/30">{w.path}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* cron */}
        <div>
          <Label className="text-xs text-foreground/50">Schedule</Label>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {CRON_PRESETS.slice(0, 8).map((preset) => (
              <button
                key={`${preset.label}-${preset.expression}`}
                onClick={() => {
                  setCron(preset.expression);
                  setShowCustomCron(false);
                }}
                className={`text-left px-3 py-2 rounded-md text-xs transition-colors ${
                  cron === preset.expression && !showCustomCron
                    ? "bg-blue-500/20 text-blue-400"
                    : "bg-muted hover:bg-accent"
                }`}
              >
                <div className="font-medium">{preset.label}</div>
                <div className="text-[10px] text-foreground/40">{preset.description}</div>
              </button>
            ))}
          </div>

          <div className="mt-3 relative">
            <Input
              value={showCustomCron ? cron : ""}
              onChange={(e) => {
                setShowCustomCron(true);
                setCron(e.target.value);
              }}
              onFocus={() => setShowCustomCron(true)}
              placeholder="Custom: * * * * * (min hour day month weekday)"
              className="h-9 text-xs font-mono pr-8"
            />
            {showCustomCron && (
              <div className="absolute right-2 top-1/2 -translate-y-1/2">
                {isValidCron(cron) ? (
                  <CheckIcon className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <XIcon className="h-3.5 w-3.5 text-red-400" />
                )}
              </div>
            )}
          </div>
          {isValidCron(cron) && (
            <div className="mt-1.5 flex items-center gap-2 text-xs text-foreground/50">
              <ClockFilled className="h-3 w-3" />
              <span>{getCronDescription(cron)}</span>
              <code className="text-[10px] text-foreground/30 font-mono">{cron}</code>
            </div>
          )}
        </div>

        {/* timezone */}
        <div>
          <Label className="text-xs text-foreground/50">Timezone</Label>
          <Select value={timezone} onValueChange={setTimezone}>
            <SelectTrigger className="mt-1.5 h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {timezoneList.map((tz) => (
                <SelectItem key={tz} value={tz} className="text-xs">
                  {tz}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* enabled */}
        <div className="flex items-center justify-between">
          <Label className="text-xs text-foreground/50">Enabled</Label>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        {/* retry */}
        <div>
          <Label className="text-xs text-foreground/50">Retries on failure</Label>
          <Select
            value={String(retryCount)}
            onValueChange={(v) => setRetryCount(parseInt(v))}
          >
            <SelectTrigger className="mt-1.5 h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0" className="text-xs">0 - no retries</SelectItem>
              <SelectItem value="1" className="text-xs">1 retry</SelectItem>
              <SelectItem value="2" className="text-xs">2 retries</SelectItem>
              <SelectItem value="3" className="text-xs">3 retries</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* goal */}
        <div>
          <Label className="text-xs text-foreground/50">Goal / Objective</Label>
          <Input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Passed to the chain as the user prompt"
            className="mt-1.5 h-9 text-xs"
          />
        </div>
      </div>

      {/* save / cancel bar */}
      <div className="shrink-0 px-6 py-3 flex items-center justify-end gap-2">
        <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          className="h-8 text-xs"
          disabled={!canSave}
          onClick={handleSubmit}
        >
          Save Changes
        </Button>
      </div>
    </div>
  );
}

function InfoCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md bg-foreground/[0.03] px-3 py-2.5">
      <div className="text-[10px] text-foreground/30 uppercase tracking-wider mb-1">{label}</div>
      <div className="flex min-w-0 items-center">{children}</div>
    </div>
  );
}
