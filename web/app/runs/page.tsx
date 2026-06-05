"use client";

import { useState, useEffect, useCallback, useRef, Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { WorkflowAgent } from "@/components/ui/workflow-card";
import { RunDetailPanel } from "@/components/run/run-detail-panel";
import {
  RefreshCw,
  Trash2,
  TickSquareFilled,
  SquareRounded,
  Pin,
  FlashFilled as Zap,
  ClockFilled as Clock,
  LinkFilled,
  TaskSquareFilled,
  RouteSquareFilled,
} from "@aliimam/icons";
import { PageBanner } from "@/components/ui/page-banner";
import { statusBar, statusPill, statusLabel } from "@/lib/ui/status-colors";
import { useWorkspace } from "@/lib/ui-context/workspace-context";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { unwrapApiData } from "@/lib/api/api-client";
import { WaveSpinner } from "@/components/ui/wave-spinner";
import { EmptyState } from "@/components/empty-state";
import { buildRunsListQuery } from "./runs-query";
import { useSharedChains } from "@/lib/chains/chains-store";
import { isSystemChainRecord, isSystemChainRun } from "@/lib/chains/system-chain";
import {
  WorkflowSidebarFilters,
  WorkflowSidebarItem,
  WorkflowSidebarPane,
  WorkflowSidebarResizeHandle,
  WorkflowSidebarSearchInput,
  WorkflowSidebarSegmentedControl,
  WorkflowSidebarVisibilityToggleGroup,
} from "@/components/ui/workflow-sidebar";
import { TimeAgo } from "@/components/shared/time-ago";

type RunAgent = WorkflowAgent;

interface Run {
  id: string;
  chain: string;
  chainId?: string;
  goal: string;
  started: string;
  completed?: string;
  status: string;
  agents: RunAgent[];
  sessions: string[];
  taskId?: string;
  totalCostDisplay?: string;
  metadata?: Record<string, unknown>;
}

type FilterStatus = "all" | "running" | "complete" | "error";
type SortBy = "started" | "duration" | "chain";

const STATUS_FILTER_OPTIONS: Array<{ value: FilterStatus; label: string }> = [
  { value: "all", label: "All" },
  { value: "running", label: "Running" },
  { value: "complete", label: "Complete" },
  { value: "error", label: "Error" },
];

const USER_RUNS_VISIBILITY_KEY = "runs-show-user-runs";
const SYSTEM_RUNS_VISIBILITY_KEY = "runs-show-system-runs";

function formatDuration(start?: string, end?: string) {
  if (!start) return "";
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const diff = e - s;
  if (diff < 1000) return `${diff}ms`;
  if (diff < 60000) return `${(diff / 1000).toFixed(0)}s`;
  const mins = Math.floor(diff / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

function extractRunSummary(goal: string, taskId?: string): string {
  if (goal?.startsWith("TASK ID:")) {
    const titleMatch = goal.match(/TITLE:\s*([^]+?)(?:\s+(?:TYPE|PRIORITY|DESCRIPTION|CHAIN|STATUS)\s*:|$)/);
    if (titleMatch) return titleMatch[1].trim();
  }
  const titleMatch = goal?.match(/TITLE:\s*(.+)/);
  if (titleMatch) return titleMatch[1].trim();
  if (taskId) return taskId;
  const firstLine = goal?.split("\n")[0] || "";
  return firstLine.length > 80 ? firstLine.slice(0, 77) + "..." : firstLine;
}

export default function RunsPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-full">
        <WaveSpinner size="sm" color="primary" animation="ripple" />
      </div>
    }>
      <RunsPageContent />
    </Suspense>
  );
}

function RunsPageContent() {
  const { workspacePath, workspaceReady } = useWorkspace();
  const { fetchWithNamespace } = useNamespaceFetch();
  const { chains: chainSummaries } = useSharedChains();
  const searchParams = useSearchParams();

  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<Run | null>(null);
  const selectedRef = useRef<Run | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState(searchParams.get("q") || "");
  const [showUserRuns, setShowUserRuns] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem(USER_RUNS_VISIBILITY_KEY) !== "0";
  });
  const [showSystemRuns, setShowSystemRuns] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(SYSTEM_RUNS_VISIBILITY_KEY) === "1";
  });
  const [filterStatus, setFilterStatus] = useState<FilterStatus>(
    (searchParams.get("status") as FilterStatus) || "all"
  );
  const [chainFilter, setChainFilter] = useState("all");
  const [sortBy, setSortBy] = useState<SortBy>(
    (searchParams.get("sort") as SortBy) || "started"
  );

  // bulk delete selection
  const [selectMode, setSelectMode] = useState(false);
  const [selectedRunIds, setSelectedRunIds] = useState<Set<string>>(new Set());

  // pinned runs
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());

  // sync filter state to URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sync = (key: string, value: string, def: string) => {
      if (value === def) params.delete(key);
      else params.set(key, value);
    };
    sync("status", filterStatus, "all");
    sync("sort", sortBy, "started");
    sync("q", searchQuery, "");
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [filterStatus, sortBy, searchQuery]);

  // resizable sidebar
  const SIDEBAR_KEY = "runs-sidebar-width";
  const MIN_W = 280;
  const MAX_W = 600;
  const DEFAULT_W = 340;
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_W);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(DEFAULT_W);

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

  // keep ref in sync so fetchRuns can read it without depending on it
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  // unique chains for filter dropdown
  const systemChainIds = useMemo(() => {
    return new Set(chainSummaries.filter(isSystemChainRecord).map((chain) => chain.id));
  }, [chainSummaries]);

  const isSystemRun = useCallback((run: Run) => {
    return isSystemChainRun(run, systemChainIds);
  }, [systemChainIds]);

  const uniqueChains = useMemo(() => {
    return Array.from(new Set(runs
      .filter((run) => {
        const systemRun = isSystemRun(run);
        return systemRun ? showSystemRuns : showUserRuns;
      })
      .map((r) => r.chain)))
      .filter(Boolean)
      .sort();
  }, [runs, showSystemRuns, showUserRuns, isSystemRun]);

  useEffect(() => {
    if (chainFilter === "all") return;
    const selectedChainRun = runs.find((run) => run.chain === chainFilter);
    if (!selectedChainRun) return;
    const systemRun = isSystemRun(selectedChainRun);
    if ((systemRun && !showSystemRuns) || (!systemRun && !showUserRuns)) {
      setChainFilter("all");
    }
  }, [chainFilter, isSystemRun, runs, showSystemRuns, showUserRuns]);

  const taskFilter = searchParams.get("task");

  const fetchRuns = useCallback(async (isPolling = false) => {
    if (!isPolling) setLoading(true);
    try {
      const params = buildRunsListQuery({ workspacePath, taskFilter });
      const res = await fetchWithNamespace(`/api/runs?${params}`);
      const raw = await res.json();
      const data = unwrapApiData<{ runs?: Run[] }>(raw);
      const newRuns: Run[] = data.runs || [];
      setRuns(newRuns);
      // auto-select first run only if nothing is selected
      if (newRuns.length && !selectedRef.current) {
        setSelected(newRuns[0]);
      }
      // update selected run data if it's still in the list
      if (selectedRef.current) {
        const updated = newRuns.find((r) => r.id === selectedRef.current!.id);
        if (updated) setSelected(updated);
      }
    } catch {
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, [workspacePath, taskFilter, fetchWithNamespace]);

  const fetchPinned = useCallback(async () => {
    try {
      const res = await fetchWithNamespace("/api/runs/pinned");
      if (res.ok) {
        const raw = await res.json();
        const data = unwrapApiData<{ pinned?: string[] }>(raw);
        setPinnedIds(new Set(data.pinned || []));
      }
    } catch { /* ignore */ }
  }, [fetchWithNamespace]);

  const togglePin = useCallback(async (runId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const isPinned = pinnedIds.has(runId);
    const next = new Set(pinnedIds);
    if (isPinned) {
      next.delete(runId);
      setPinnedIds(next);
      await fetchWithNamespace("/api/runs/pinned", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: runId }),
      });
    } else {
      next.add(runId);
      setPinnedIds(next);
      await fetchWithNamespace("/api/runs/pinned", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: runId }),
      });
    }
  }, [pinnedIds, fetchWithNamespace]);

  // reset selection when workspace changes, then fetch
  useEffect(() => {
    if (!workspaceReady) return;
    setSelected(null);
    selectedRef.current = null;
    fetchRuns();
    fetchPinned();
    const interval = setInterval(() => fetchRuns(true), 5000);
    return () => clearInterval(interval);
  }, [fetchRuns, fetchPinned, workspaceReady]);

  // auto-select run from URL query param without filtering the sidebar list
  const handledRunIdRef = useRef<string | null>(null);
  useEffect(() => {
    const runIdParam = searchParams.get("runId");
    if (!runIdParam || handledRunIdRef.current === runIdParam) return;

    const target = runs.find((r) => r.id === runIdParam);
    if (target) {
      if (isSystemRun(target)) {
        setShowSystemRuns(true);
        localStorage.setItem(SYSTEM_RUNS_VISIBILITY_KEY, "1");
      } else {
        setShowUserRuns(true);
        localStorage.setItem(USER_RUNS_VISIBILITY_KEY, "1");
      }
      setSelected(target);
      selectedRef.current = target;
      setMobileView("detail");
      handledRunIdRef.current = runIdParam;
      return;
    }

    if (loading) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithNamespace(`/api/runs/${encodeURIComponent(runIdParam)}`);
        if (!res.ok) return;
        const raw = await res.json();
        const data = unwrapApiData<{ run?: Run }>(raw);
        if (!cancelled && data.run) {
          if (isSystemRun(data.run)) {
            setShowSystemRuns(true);
            localStorage.setItem(SYSTEM_RUNS_VISIBILITY_KEY, "1");
          } else {
            setShowUserRuns(true);
            localStorage.setItem(USER_RUNS_VISIBILITY_KEY, "1");
          }
          setSelected(data.run);
          selectedRef.current = data.run;
          setMobileView("detail");
        }
      } finally {
        if (!cancelled) handledRunIdRef.current = runIdParam;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [searchParams, runs, loading, fetchWithNamespace, isSystemRun]);

  const runMatchesFilters = useCallback((run: Run) => {
    const matchesSearch =
      searchQuery === "" ||
      run.chain.toLowerCase().includes(searchQuery.toLowerCase()) ||
      run.goal.toLowerCase().includes(searchQuery.toLowerCase()) ||
      run.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filterStatus === "all" || run.status === filterStatus;
    const matchesChain = chainFilter === "all" || run.chain === chainFilter;
    return matchesSearch && matchesFilter && matchesChain;
  }, [chainFilter, filterStatus, searchQuery]);

  const systemRunCount = runs.filter(isSystemRun).length;
  const userRunCount = runs.length - systemRunCount;
  const hiddenSystemMatchCount = showSystemRuns
    ? 0
    : runs.filter((run) => isSystemRun(run) && runMatchesFilters(run)).length;
  const hiddenUserMatchCount = showUserRuns
    ? 0
    : runs.filter((run) => !isSystemRun(run) && runMatchesFilters(run)).length;
  const hiddenRunMatchCount = hiddenSystemMatchCount + hiddenUserMatchCount;
  const filteredAndSortedRuns = useMemo(() => {
    return runs
      .filter((run) => {
        const systemRun = isSystemRun(run);
        if (systemRun && !showSystemRuns) return false;
        if (!systemRun && !showUserRuns) return false;
        return runMatchesFilters(run);
      })
      .sort((a, b) => {
        // pinned always first
        const aPinned = pinnedIds.has(a.id) ? 0 : 1;
        const bPinned = pinnedIds.has(b.id) ? 0 : 1;
        if (aPinned !== bPinned) return aPinned - bPinned;

        switch (sortBy) {
          case "started":
            return new Date(b.started).getTime() - new Date(a.started).getTime();
          case "chain":
            return a.chain.localeCompare(b.chain);
          case "duration": {
            const aDur = new Date(a.completed || Date.now()).getTime() - new Date(a.started).getTime();
            const bDur = new Date(b.completed || Date.now()).getTime() - new Date(b.started).getTime();
            return bDur - aDur;
          }
          default:
            return 0;
        }
      });
  }, [isSystemRun, pinnedIds, runMatchesFilters, runs, showSystemRuns, showUserRuns, sortBy]);

  const firstUnpinnedIndex = filteredAndSortedRuns.findIndex((r) => !pinnedIds.has(r.id));

  useEffect(() => {
    const runIdParam = searchParams.get("runId");
    if (runIdParam) return;
    if (!selected) {
      const first = filteredAndSortedRuns[0];
      if (first) {
        setSelected(first);
        selectedRef.current = first;
      }
      return;
    }
    const selectedSystemRun = isSystemRun(selected);
    if ((selectedSystemRun && !showSystemRuns) || (!selectedSystemRun && !showUserRuns)) {
      const first = filteredAndSortedRuns[0] || null;
      setSelected(first);
      selectedRef.current = first;
    }
  }, [filteredAndSortedRuns, isSystemRun, searchParams, selected, showSystemRuns, showUserRuns]);

  const toggleRunVisibility = (kind: "user" | "system") => {
    if (kind === "user") {
      setShowUserRuns((current) => {
        const next = !current;
        localStorage.setItem(USER_RUNS_VISIBILITY_KEY, next ? "1" : "0");
        if (!next && selected && !isSystemRun(selected)) {
          const firstVisibleRun = runs.find((run) => {
            const systemRun = isSystemRun(run);
            const visible = systemRun ? showSystemRuns : next;
            return visible && runMatchesFilters(run);
          }) || null;
          setSelected(firstVisibleRun);
          selectedRef.current = firstVisibleRun;
          if (firstVisibleRun) setMobileView("detail");
        }
        return next;
      });
      return;
    }

    setShowSystemRuns((current) => {
      const next = !current;
      localStorage.setItem(SYSTEM_RUNS_VISIBILITY_KEY, next ? "1" : "0");
      if (!next && selected && isSystemRun(selected)) {
        const firstVisibleRun = runs.find((run) => {
          const systemRun = isSystemRun(run);
          const visible = systemRun ? next : showUserRuns;
          return visible && runMatchesFilters(run);
        }) || null;
        setSelected(firstVisibleRun);
        selectedRef.current = firstVisibleRun;
        if (firstVisibleRun) setMobileView("detail");
      }
      return next;
    });
  };

  const handleSelectRun = (run: Run) => {
    if (selectMode) {
      // toggle selection
      setSelectedRunIds((prev) => {
        const next = new Set(prev);
        if (next.has(run.id)) next.delete(run.id);
        else next.add(run.id);
        return next;
      });
    } else {
      setSelected(run);
      setMobileView("detail");
    }
  };

  const handleBulkDelete = async () => {
    if (selectedRunIds.size === 0) return;
    const ids = Array.from(selectedRunIds);
    try {
      const res = await fetchWithNamespace("/api/runs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (res.ok) {
        setSelectedRunIds(new Set());
        setSelectMode(false);
        fetchRuns();
      }
    } catch {
      // ignore errors
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Banner */}
      <PageBanner
        title="Runs"
        subtitle={taskFilter
          ? `Showing runs for task ${taskFilter}. ${runs.length} run${runs.length !== 1 ? "s" : ""} found.`
          : "Chain execution history and live monitoring. Track active pipeline runs, view agent output in real-time, and debug failed executions."
        }
        icon={RouteSquareFilled}
        sectionColor="#5b9ef5"
        actions={[
          { label: "Chains", href: "/chains", icon: LinkFilled, iconColor: "#b07ee8" },
          { label: "Tasks", href: "/tasks", icon: TaskSquareFilled, iconColor: "#5b9ef5" },
        ]}
        docs={[
          { label: "Runs Guide", href: "/docs/runs", icon: RouteSquareFilled },
          { label: "Chain Execution", href: "/docs/chains", icon: LinkFilled },
        ]}
      />

      {/* List-Detail split */}
      <div className="flex-1 flex overflow-hidden pl-2 sm:pl-4">
        {/* Left: run list (resizable) */}
        <WorkflowSidebarPane
          className={`${mobileView === "detail" ? "hidden md:flex" : "flex"}`}
          style={{ width: sidebarWidth }}
        >
          {/* Search & filters */}
          <WorkflowSidebarFilters>
            <div className="flex items-center gap-1.5">
              <WorkflowSidebarSearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search runs..."
              />
              <Button size="sm" variant="default" className="shrink-0" onClick={() => fetchRuns()} title="Refresh">
                <RefreshCw className="h-3 w-3" />
              </Button>
            </div>
            <WorkflowSidebarSegmentedControl
              options={STATUS_FILTER_OPTIONS}
              value={filterStatus}
              onChange={setFilterStatus}
            />
            {uniqueChains.length > 0 && (
              <select
                value={chainFilter}
                onChange={(e) => setChainFilter(e.target.value)}
                className="w-full text-[10px] bg-card rounded-md px-2 py-1.5 text-muted-foreground"
              >
                <option value="all">All chains</option>
                {uniqueChains.map((chain) => (
                  <option key={chain} value={chain}>{chain}</option>
                ))}
              </select>
            )}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
              className="w-full text-[10px] bg-card rounded-md px-2 py-1.5 text-muted-foreground"
            >
              <option value="started">Sort: Started</option>
              <option value="duration">Sort: Duration</option>
              <option value="chain">Sort: Chain</option>
            </select>
            <WorkflowSidebarVisibilityToggleGroup
              options={[
                { value: "user", label: "User", active: showUserRuns, count: userRunCount },
                { value: "system", label: "System", active: showSystemRuns, count: systemRunCount },
              ]}
              onToggle={toggleRunVisibility}
            />
            <div className="flex items-center gap-1.5">
              <Button
                size="xs"
                variant={selectMode ? "default" : "ghost"}
                className="text-[10px]"
                onClick={() => {
                  setSelectMode(!selectMode);
                  setSelectedRunIds(new Set());
                }}
              >
                {selectMode ? <TickSquareFilled className="h-3 w-3" /> : <SquareRounded className="h-3 w-3" />}
                {selectMode ? "Done" : "Select"}
              </Button>
              {selectedRunIds.size > 0 && (
                <Button size="xs" variant="destructive" className="text-[10px]" onClick={handleBulkDelete}>
                  <Trash2 className="h-3 w-3" />
                  Delete ({selectedRunIds.size})
                </Button>
              )}
            </div>
          </WorkflowSidebarFilters>

          {/* Run list */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <WaveSpinner size="sm" color="primary" animation="ripple" />
              </div>
            ) : filteredAndSortedRuns.length === 0 ? (
              hiddenRunMatchCount > 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
                  <div className="text-xs text-foreground/40">
                    Matching runs are hidden
                  </div>
                </div>
              ) : searchQuery || filterStatus !== "all" || chainFilter !== "all" ? (
                <div className="text-center py-12 text-xs text-foreground/40">
                  No runs match filters
                </div>
              ) : (
                <EmptyState
                  icon={<RouteSquareFilled className="h-8 w-8" />}
                  title="No runs yet"
                  description="Run a chain to see results here. Each execution creates a tracked run."
                  action={{ label: "Go to chains", href: "/chains" }}
                />
              )
            ) : (
              <div className="p-2 space-y-1">
                {filteredAndSortedRuns.map((run, idx) => {
                  const isPinned = pinnedIds.has(run.id);
                  const showDivider = idx === firstUnpinnedIndex && firstUnpinnedIndex > 0;
                  return (
                    <div key={run.id}>
                      {showDivider && (
                        <div className="flex items-center gap-2 py-1 px-1">
                          <div className="flex-1 h-px bg-foreground/10" />
                        </div>
                      )}
                      <div className="relative group">
                        {selectMode ? (
                          <div className="absolute left-2 top-1/2 -translate-y-1/2 z-10">
                            {selectedRunIds.has(run.id) ? (
                              <TickSquareFilled className="h-4 w-4 text-foreground" />
                            ) : (
                              <SquareRounded className="h-4 w-4 text-muted-foreground" />
                            )}
                          </div>
                        ) : null}
                        <WorkflowSidebarItem
                          selected={selected?.id === run.id}
                          onClick={() => handleSelectRun(run)}
                          accentClassName={statusBar(run.status)}
                        >
                          <div className={selectMode ? "pl-6" : "pl-4"}>
                            {/* pin button: top-right, hover or pinned */}
                            <button
                              onClick={(e) => { e.stopPropagation(); togglePin(run.id, e); }}
                              className={`absolute right-3 top-3 z-10 p-0.5 rounded transition-opacity ${
                                isPinned
                                  ? "opacity-100 text-amber-400"
                                  : "opacity-0 group-hover:opacity-100 text-foreground/30 hover:text-foreground/60"
                              }`}
                              title={isPinned ? "Unpin run" : "Pin run"}
                            >
                              <Pin className="h-2.5 w-2.5" fill={isPinned ? "currentColor" : "none"} />
                            </button>

                            <div className="flex items-start justify-between gap-2 pr-5">
                              <span className="line-clamp-2 text-sm font-semibold leading-5">
                                {run.chain}
                              </span>
                              <TimeAgo date={run.started} format="short" suffix={false} className="shrink-0 !text-[10px] text-foreground/30" />
                            </div>

                            <p className="line-clamp-1 text-[11px] text-foreground/40 mt-0.5">
                              {extractRunSummary(run.goal, run.taskId)}
                            </p>

                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-foreground/40">
                              {isSystemRun(run) && (
                                <span className="rounded-full bg-blue-400/10 px-2 py-0.5 text-blue-300/80">
                                  system
                                </span>
                              )}
                              <span className={`rounded-full px-2 py-0.5 uppercase tracking-[0.14em] ${statusPill(run.status)}`}>
                                {statusLabel(run.status)}
                              </span>
                              <span className="inline-flex items-center gap-1 rounded-full bg-foreground/5 px-2 py-0.5">
                                <Zap className="h-2.5 w-2.5" />
                                {run.agents.filter(a => a.status === "complete").length}/{run.agents.length}
                              </span>
                              <span className="inline-flex items-center gap-1 rounded-full bg-foreground/5 px-2 py-0.5 font-mono">
                                <Clock className="h-2.5 w-2.5" />
                                {formatDuration(run.started, run.completed)}
                              </span>
                              {run.totalCostDisplay ? (
                                <span className="rounded-full bg-foreground/5 px-2 py-0.5 font-mono">
                                  {run.totalCostDisplay}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </WorkflowSidebarItem>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* resize handle */}
          <WorkflowSidebarResizeHandle onMouseDown={onDragStart} />
        </WorkflowSidebarPane>

        {/* Right: detail panel */}
        <div className={`${mobileView === "list" ? "hidden md:flex" : "flex"} flex-1 flex-col overflow-hidden`}>
          {!selected ? (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground/60">
              Select a run to view details
            </div>
          ) : (
            <RunDetailPanel
              key={selected.id}
              runId={selected.id}
              onDelete={() => {
                setSelected(null);
                selectedRef.current = null;
                fetchRuns();
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
