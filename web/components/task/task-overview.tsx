"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useWorkspace } from "@/lib/workspace-context";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { mapPriority } from "@/lib/task-transforms";
import { WaveSpinner } from "@/components/ui/wave-spinner";
import { TypeBadge } from "./type-badge";
import { PriorityBadge } from "./priority-badge";
import { EyeSlashFilled as EyeOff, EyeFilled as Eye, RowHorizontalFilled as Rows3, Link2Filled as Link2 } from "@aliimam/icons";
import { unwrapApiData, getApiErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { TaskPriority } from "@/lib/task-types";

interface ApiNode {
  id: string;
  label: string;
  type: string;
  status: string;
  priority: number;
  layer: number;
  chainBinding?: {
    chain_id?: string;
    chain_name?: string;
    auto_run?: boolean;
  };
}

interface ApiDep {
  from: string; // blocker
  to: string; // blocked
}

interface ApiLink {
  source: string; // parent
  target: string; // child
}

interface TaskOverviewProps {
  onSelectTask?: (taskId: string) => void;
  onSelectEpic?: (epicId: string) => void;
  selectedTaskId?: string;
}

interface EpicColumn {
  epic: ApiNode | null;
  tasks: ApiNode[];
  closedCount: number;
}

function statusDot(status: string) {
  if (status === "closed") return "bg-green-400";
  if (status === "in_progress") return "bg-blue-400";
  return "bg-foreground/30";
}

// shorten an id for display: "mentiko-2eb.18.1" -> ".18.1"
function shortId(id: string): string {
  const dot = id.indexOf(".");
  if (dot === -1) return id;
  return id.slice(dot);
}

type PriorityFilter = "all" | "p0" | "p0-p1" | "p2-plus";

export function taskOverviewPriorityMatches(priority: number, filter: PriorityFilter): boolean {
  if (filter === "p0") return priority === 0;
  if (filter === "p0-p1") return priority <= 1;
  if (filter === "p2-plus") return priority >= 2;
  return true;
}

export function TaskOverview({ onSelectTask, onSelectEpic, selectedTaskId }: TaskOverviewProps) {
  const { workspacePath, workspaceReady } = useWorkspace();
  const { fetchWithNamespace } = useNamespaceFetch();
  const [nodes, setNodes] = useState<ApiNode[]>([]);
  const [deps, setDeps] = useState<ApiDep[]>([]);
  const [links, setLinks] = useState<ApiLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hideCompleted, setHideCompleted] = useState(true);
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    if (!workspaceReady) return;
    const params = new URLSearchParams();
    if (workspacePath) params.set("workspace", workspacePath);
    fetchWithNamespace(`/api/tasks/graph?${params}`)
      .then((res) => res.json())
      .then((raw) => {
        const data = unwrapApiData<{
          nodes?: ApiNode[];
          deps?: ApiDep[];
          links?: ApiLink[];
          error?: string;
        }>(raw);
        if (data.error || !data.nodes?.length) {
          setError(getApiErrorMessage(data, "No graph data"));
          return;
        }
        setNodes(data.nodes);
        setDeps(data.deps || []);
        setLinks(data.links || []);
      })
      .catch(() => setError("Failed to load graph"))
      .finally(() => setLoading(false));
  }, [workspacePath, workspaceReady, fetchWithNamespace]);

  // build lookup: nodeId -> label (for dep display)
  const labelMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of nodes) m.set(n.id, n.label);
    return m;
  }, [nodes]);

  // per-node dep info
  const depInfo = useMemo(() => {
    // blockedBy[id] = list of ids that block this node
    const blockedBy = new Map<string, string[]>();
    // blocks[id] = list of ids this node blocks
    const blocks = new Map<string, string[]>();

    for (const dep of deps) {
      const bb = blockedBy.get(dep.to) || [];
      bb.push(dep.from);
      blockedBy.set(dep.to, bb);

      const bl = blocks.get(dep.from) || [];
      bl.push(dep.to);
      blocks.set(dep.from, bl);
    }

    return { blockedBy, blocks };
  }, [deps]);

  // group nodes into epic columns
  const columns = useMemo(() => {
    const nodeMap = new Map<string, ApiNode>();
    for (const n of nodes) nodeMap.set(n.id, n);

    const epics = nodes.filter((n) => n.type === "epic");
    const epicIds = new Set(epics.map((e) => e.id));
    const visibleNodes = nodes.filter((n) => {
      if (hideCompleted && n.status === "closed") return false;
      if (n.type !== "epic") {
        if (!taskOverviewPriorityMatches(n.priority, priorityFilter)) return false;
      }
      return true;
    });

    // build parent lookup from links (parent_id relationships)
    const parentMap = new Map<string, string>();
    for (const link of links) {
      parentMap.set(link.target, link.source);
    }

    // find root epic via parent_id links or legacy id hierarchy
    function findRootEpic(id: string): string | null {
      // walk up parent_id chain
      let current = id;
      const visited = new Set<string>();
      while (parentMap.has(current) && !visited.has(current)) {
        visited.add(current);
        const parent = parentMap.get(current)!;
        if (epicIds.has(parent)) return parent;
        current = parent;
      }
      // fallback: legacy dot-notation hierarchy
      const parts = id.split(".");
      if (parts.length >= 2) {
        for (let i = parts.length - 1; i >= 1; i--) {
          const candidate = parts.slice(0, i).join(".");
          if (epicIds.has(candidate)) return candidate;
        }
      }
      return null;
    }

    // group ALL nodes for closedCount (unfiltered), but display visibleNodes
    const grouped = new Map<string, ApiNode[]>();
    const groupedAll = new Map<string, ApiNode[]>();
    const ungrouped: ApiNode[] = [];
    const ungroupedAll: ApiNode[] = [];

    for (const node of nodes) {
      if (epicIds.has(node.id)) continue;
      const epicId = findRootEpic(node.id);
      if (epicId) {
        const g = groupedAll.get(epicId) || [];
        g.push(node);
        groupedAll.set(epicId, g);
      } else {
        ungroupedAll.push(node);
      }
    }

    for (const node of visibleNodes) {
      if (epicIds.has(node.id)) continue;
      const epicId = findRootEpic(node.id);
      if (epicId) {
        const g = grouped.get(epicId) || [];
        g.push(node);
        grouped.set(epicId, g);
      } else {
        ungrouped.push(node);
      }
    }

    const cols: EpicColumn[] = [];
    const sortedEpics = [...epics]
      .filter((e) => !(hideCompleted && e.status === "closed"))
      .sort((a, b) => a.priority - b.priority);

    for (const epic of sortedEpics) {
      const tasks = grouped.get(epic.id) || [];
      const allTasks = groupedAll.get(epic.id) || [];
      if (allTasks.length === 0) continue;
      // when hiding completed, skip columns where every task is done
      if (hideCompleted && tasks.length === 0) continue;
      tasks.sort((a, b) => a.layer - b.layer);
      const closedCount = allTasks.filter((t) => t.status === "closed").length;
      cols.push({ epic, tasks, closedCount });
    }

    if (ungroupedAll.length > 0 && !(hideCompleted && ungrouped.length === 0)) {
      ungrouped.sort((a, b) => a.layer - b.layer);
      const closedCount = ungroupedAll.filter((t) => t.status === "closed").length;
      cols.push({ epic: null, tasks: ungrouped, closedCount });
    }

    return cols;
  }, [nodes, links, hideCompleted, priorityFilter]);

  const handleClick = useCallback(
    (id: string) => {
      onSelectTask?.(id);
    },
    [onSelectTask]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <WaveSpinner size="sm" color="primary" animation="ripple" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-foreground/30">
        {error}
      </div>
    );
  }

  const completedCount = nodes.filter((n) => n.status === "closed" && n.type !== "epic").length;
  const PRIORITY_OPTIONS: { label: string; value: PriorityFilter }[] = [
    { label: "All", value: "all" },
    { label: "P0", value: "p0" },
    { label: "P0-P1", value: "p0-p1" },
    { label: "P2+", value: "p2-plus" },
  ];

  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      {/* toolbar */}
      <div className="flex items-center gap-3 px-4 py-1.5 shrink-0 border-b border-foreground/5 flex-wrap">
        {/* priority chips */}
        <div className="flex items-center gap-1">
          {PRIORITY_OPTIONS.map((opt) => (
            <button
              key={String(opt.value)}
              onClick={() => {
                setPriorityFilter(priorityFilter === opt.value ? "all" : opt.value);
              }}
              className={cn(
                "px-2 py-0.5 rounded text-[10px] font-mono transition-colors",
                priorityFilter === opt.value || (opt.value === "all" && priorityFilter === "all")
                  ? "bg-foreground/15 text-foreground/80"
                  : "text-foreground/35 hover:text-foreground/60 hover:bg-foreground/5"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="h-3 w-px bg-foreground/10" />

        {/* compact toggle */}
        <button
          onClick={() => setCompact((v) => !v)}
          className={cn(
            "flex items-center gap-1 text-[11px] transition-colors",
            compact ? "text-foreground/70" : "text-foreground/35 hover:text-foreground/60"
          )}
          title="Compact mode"
        >
          <Rows3 className="h-3 w-3" />
          <span>compact</span>
        </button>

        <div className="h-3 w-px bg-foreground/10" />

        {/* hide completed */}
        <button
          onClick={() => setHideCompleted((v) => !v)}
          className="flex items-center gap-1.5 text-[11px] text-foreground/35 hover:text-foreground/60 transition-colors"
        >
          {hideCompleted ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
          {hideCompleted ? `show completed (${completedCount})` : `hide completed (${completedCount})`}
        </button>
      </div>

      {/* columns */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex gap-4 p-4 h-full">
          {columns.map((col) => (
            <EpicColumnCard
              key={col.epic?.id || "__ungrouped"}
              column={col}
              depInfo={depInfo}
              labelMap={labelMap}
              onClick={handleClick}
              onSelectEpic={onSelectEpic}
              selectedTaskId={selectedTaskId}
              compact={compact}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function EpicColumnCard({
  column,
  depInfo,
  labelMap,
  onClick,
  onSelectEpic,
  selectedTaskId,
  compact,
}: {
  column: EpicColumn;
  depInfo: {
    blockedBy: Map<string, string[]>;
    blocks: Map<string, string[]>;
  };
  labelMap: Map<string, string>;
  onClick: (id: string) => void;
  onSelectEpic?: (epicId: string) => void;
  selectedTaskId?: string;
  compact?: boolean;
}) {
  const { epic, tasks, closedCount } = column;
  const total = closedCount + tasks.filter((t) => t.status !== "closed").length;
  const pct = total > 0 ? Math.round((closedCount / total) * 100) : 0;
  const isEpicSelected = !!epic && epic.id === selectedTaskId;

  // build set of task ids in this column for connector lines
  const columnIds = useMemo(
    () => new Set(tasks.map((t) => t.id)),
    [tasks]
  );

  const headerContent = (
    <div className="px-3 py-2.5 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground truncate">
          {epic ? epic.label : "Ungrouped"}
        </span>
        <span className="text-[10px] font-mono text-foreground/40 ml-2 flex-shrink-0">
          {closedCount}/{total}
        </span>
      </div>
      {epic && (
        <span className="text-[10px] font-mono text-foreground/30 block">
          {epic.id}
        </span>
      )}
      <div className="h-1 rounded-full bg-foreground/5 overflow-hidden">
        <div
          className="h-full rounded-full bg-green-400/60 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );

  return (
    <div className="flex-shrink-0 w-72 h-full flex flex-col bg-card rounded-md overflow-hidden">
      {/* column header */}
      {epic && onSelectEpic ? (
        <button
          type="button"
          onClick={() => onSelectEpic(epic.id)}
          className={cn(
            "text-left rounded-t-md transition-colors",
            isEpicSelected ? "bg-accent" : "hover:bg-foreground/5"
          )}
        >
          {headerContent}
        </button>
      ) : (
        headerContent
      )}

      {/* task list with dep connectors */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {tasks.map((task, idx) => {
          const blockedBy = depInfo.blockedBy.get(task.id) || [];
          const blocks = depInfo.blocks.get(task.id) || [];

          // does the next task in this column depend on this task?
          const nextTask = idx < tasks.length - 1 ? tasks[idx + 1] : null;
          const nextBlockedBy = nextTask
            ? depInfo.blockedBy.get(nextTask.id) || []
            : [];
          const connectsToNext =
            nextTask && nextBlockedBy.includes(task.id);

          // cross-column deps (blocked by tasks NOT in this column)
          const crossDeps = blockedBy.filter((id) => !columnIds.has(id));

          return (
            <div key={task.id}>
              <TaskCard
                task={task}
                blockedBy={blockedBy}
                blocks={blocks}
                crossDeps={crossDeps}
                labelMap={labelMap}
                onClick={onClick}
                isSelected={task.id === selectedTaskId}
                compact={compact}
              />
              {connectsToNext && (
                <div className="flex justify-center py-0.5">
                  <div className="w-px h-3 bg-foreground/15" />
                </div>
              )}
              {!connectsToNext && idx < tasks.length - 1 && (
                <div className="h-1" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TaskCard({
  task,
  blockedBy,
  blocks,
  crossDeps,
  labelMap,
  onClick,
  isSelected,
  compact,
}: {
  task: ApiNode;
  blockedBy: string[];
  blocks: string[];
  crossDeps: string[];
  labelMap: Map<string, string>;
  onClick: (id: string) => void;
  isSelected?: boolean;
  compact?: boolean;
}) {
  const priority: TaskPriority = mapPriority(task.priority);
  const totalDeps = blockedBy.length + blocks.length;
  const isReady = blockedBy.length === 0 && task.status !== "closed";

  return (
    <button
      onClick={() => onClick(task.id)}
      className={cn(
        "w-full text-left px-2.5 py-2 rounded-sm transition-colors cursor-pointer",
        isSelected
          ? "bg-accent ring-1 ring-foreground/20"
          : "bg-muted hover:bg-accent",
        isReady && !isSelected && "ring-1 ring-green-400/20"
      )}
    >
      <div className="flex items-start gap-2">
        <span
          className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDot(task.status)}`}
        />
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-xs text-foreground leading-snug">{task.label}</p>

          {!compact && (
            <>
              <div className="flex items-center gap-1.5 flex-wrap">
                <TypeBadge type={task.type} />
                <PriorityBadge priority={priority} rawPriority={task.priority} />
                {task.chainBinding && (
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono bg-accent text-foreground/70">
                    <Link2 className="h-2.5 w-2.5" />
                    {task.chainBinding.chain_name || task.chainBinding.chain_id}
                  </span>
                )}
                {totalDeps > 0 && (
                  <span className="text-[10px] font-mono text-foreground/30">
                    {blockedBy.length > 0 && (
                      <span className="text-red-400/60">
                        {blockedBy.length} blocker{blockedBy.length > 1 ? "s" : ""}
                      </span>
                    )}
                    {blockedBy.length > 0 && blocks.length > 0 && (
                      <span className="text-foreground/20"> / </span>
                    )}
                    {blocks.length > 0 && (
                      <span className="text-amber-400/60">blocks {blocks.length}</span>
                    )}
                  </span>
                )}
              </div>

              {crossDeps.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {crossDeps.map((depId) => (
                    <span
                      key={depId}
                      className="text-[9px] font-mono text-red-400/40 bg-red-500/5 px-1 rounded"
                      title={labelMap.get(depId) || depId}
                    >
                      needs {shortId(depId)}
                    </span>
                  ))}
                </div>
              )}

              <span className="text-[10px] font-mono text-foreground/25 block">
                {task.id}
              </span>
            </>
          )}

          {compact && (
            <div className="flex items-center gap-1">
              <PriorityBadge priority={priority} rawPriority={task.priority} />
              {task.chainBinding && (
                <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-mono bg-accent text-foreground/70">
                  <Link2 className="h-2 w-2" />
                  {task.chainBinding.chain_name || task.chainBinding.chain_id}
                </span>
              )}
              {blockedBy.length > 0 && (
                <span className="text-[9px] text-red-400/60">{blockedBy.length}b</span>
              )}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
