"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useWorkspace } from "@/lib/ui-context/workspace-context";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { unwrapApiData, getApiErrorMessage } from "@/lib/api/api-client";
import { mapPriority } from "@/lib/tasks/task-transforms";
import {
  compareOperationalStates,
  operationalRank,
  sortTaskTreeNodes,
} from "@/lib/tasks/task-ordering";
import { isTerminalTaskStatus } from "@/lib/tasks/task-status";
import { WaveSpinner } from "@/components/ui/wave-spinner";
import { TypeBadge } from "./type-badge";
import { PriorityBadge } from "./priority-badge";
import { TaskOpIndicator, type TaskOpIndicatorState } from "./task-op-indicator";
import type { TaskPriority } from "@/lib/tasks/task-types";
import {
  ArrowDown1Filled,
  ArrowRight1Filled,
  ArrowDownFilled,
  ArrowUpFilled,
  JudgeFilled,
} from "@aliimam/icons";

interface ApiNode {
  id: string;
  label: string;
  type: string;
  status: string;
  priority: number;
  layer: number;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

interface ApiDep {
  from: string; // blocker
  to: string; // blocked
}

interface ApiLink {
  source: string; // parent
  target: string; // child
}

interface HierarchyNode {
  node: ApiNode;
  children: HierarchyNode[];
  blocksIds: string[]; // tasks this node blocks (dep)
  blockedByIds: string[]; // tasks blocking this node (dep)
}

interface TaskTreeViewProps {
  onSelectTask?: (taskId: string) => void;
  selectedId?: string | null;
  refreshSignal?: number;
  /** Per-task operational state from /api/operations/timeline (page-level fetch). */
  opStates?: Map<string, TaskOpIndicatorState>;
}

function statusDot(status: string) {
  if (isTerminalTaskStatus(status)) return "bg-green-400";
  if (status === "in_progress") return "bg-blue-400";
  return "bg-foreground/30";
}

// shorten a task id for display: "mentiko-2eb.18.1" -> ".18.1"
function shortId(id: string): string {
  const dot = id.indexOf(".");
  if (dot === -1) return id;
  return id.slice(dot);
}

// does this terminal node have any active, non-epic descendant?
function hasOpenDescendant(node: HierarchyNode): boolean {
  if (!isTerminalTaskStatus(node.node.status) && node.node.type !== "epic") return true;
  return node.children.some((child) => hasOpenDescendant(child));
}

// should this child row be visible given the current showClosed filter?
function isChildVisible(child: HierarchyNode, showClosed: boolean): boolean {
  if (showClosed) return true;
  if (!isTerminalTaskStatus(child.node.status)) return true;
  if (child.node.type === "epic") return hasOpenDescendant(child);
  return false;
}

// should this node itself render at all (epics stay if they have visible children)?
function isNodeRendered(node: HierarchyNode, showClosed: boolean): boolean {
  const isClosed = isTerminalTaskStatus(node.node.status);
  if (!isClosed || showClosed) return true;
  if (node.node.type !== "epic") return false;
  return node.children.some((child) => isChildVisible(child, showClosed));
}

interface FlatRow {
  id: string;
  parentId: string | null;
  hasChildren: boolean;
}

// flatten the visible tree (respecting collapse + showClosed) into keyboard-nav order
function flattenVisibleRows(
  tree: HierarchyNode[],
  collapsed: Set<string>,
  showClosed: boolean
): FlatRow[] {
  const rows: FlatRow[] = [];

  function walk(node: HierarchyNode, parentId: string | null) {
    if (!isNodeRendered(node, showClosed)) return;
    const visibleChildCount = node.children.filter((c) =>
      isChildVisible(c, showClosed)
    ).length;
    rows.push({ id: node.node.id, parentId, hasChildren: visibleChildCount > 0 });
    if (visibleChildCount > 0 && !collapsed.has(node.node.id)) {
      for (const child of node.children) walk(child, node.node.id);
    }
  }

  for (const root of tree) walk(root, null);
  return rows;
}

export function TaskTreeView({ onSelectTask, selectedId, refreshSignal = 0, opStates }: TaskTreeViewProps) {
  const { workspacePath } = useWorkspace();
  const { fetchWithNamespace } = useNamespaceFetch();
  const [nodes, setNodes] = useState<ApiNode[]>([]);
  const [deps, setDeps] = useState<ApiDep[]>([]);
  const [links, setLinks] = useState<ApiLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showClosed, setShowClosed] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const setDrag = useCallback((id: string | null) => {
    dragIdRef.current = id;
    setDragId(id);
  }, []);

  const fetchGraph = useCallback(() => {
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
        setError("");
      })
      .catch(() => setError("Failed to load graph"))
      .finally(() => setLoading(false));
  }, [workspacePath, fetchWithNamespace]);

  useEffect(() => { fetchGraph(); }, [fetchGraph, refreshSignal]);

  // background refresh so the tree tracks server-side status changes; a failed
  // poll keeps the last good tree (error screen only when nothing loaded yet)
  useEffect(() => {
    const interval = setInterval(fetchGraph, 15000);
    return () => clearInterval(interval);
  }, [fetchGraph]);

  // handle drag-drop dependency creation
  async function handleDrop(fromId: string, toId: string) {
    if (fromId === toId) return;
    try {
      const wsParam = workspacePath ? `?workspace=${encodeURIComponent(workspacePath)}` : "";
      const res = await fetchWithNamespace(`/api/tasks/deps${wsParam}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: fromId, to: toId }),
      });
      if (!res.ok) {
        const data = await res.json();
        console.error("dep add failed:", getApiErrorMessage(data, "Unknown error"));
        return;
      }
      fetchGraph();
    } catch {
      console.error("dep add failed");
    }
  }

  // node lookup
  const nodeMap = useMemo(() => {
    const m = new Map<string, ApiNode>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  // dep lookups
  const depInfo = useMemo(() => {
    const blockedBy = new Map<string, string[]>(); // id -> ids blocking it
    const blocks = new Map<string, string[]>(); // id -> ids it blocks

    for (const dep of deps) {
      // dep.from blocks dep.to
      const bb = blockedBy.get(dep.to) || [];
      bb.push(dep.from);
      blockedBy.set(dep.to, bb);

      const bl = blocks.get(dep.from) || [];
      bl.push(dep.to);
      blocks.set(dep.from, bl);
    }

    return { blockedBy, blocks };
  }, [deps]);

  // build hierarchy tree from parent-child links
  const tree = useMemo(() => {
    // parent -> children
    const childrenMap = new Map<string, string[]>();
    const hasParent = new Set<string>();

    for (const link of links) {
      const children = childrenMap.get(link.source) || [];
      children.push(link.target);
      childrenMap.set(link.source, children);
      hasParent.add(link.target);
    }

    function buildNode(id: string, visited: Set<string>): HierarchyNode | null {
      if (visited.has(id)) return null;
      const node = nodeMap.get(id);
      if (!node) return null;

      visited.add(id);

      const childNodes = (childrenMap.get(id) || [])
        .map((childId) => nodeMap.get(childId))
        .filter((child): child is ApiNode => Boolean(child));
      const epicChildren = childNodes.filter((child) => child.type === "epic");
      const taskChildren = childNodes.filter((child) => child.type !== "epic");
      const sortedChildIds = [
        ...sortTaskTreeNodes(epicChildren, deps),
        ...sortTaskTreeNodes(taskChildren, deps),
      ].map((child) => child.id);

      const children: HierarchyNode[] = [];
      for (const childId of sortedChildIds) {
        const child = buildNode(childId, visited);
        if (child) children.push(child);
      }

      return {
        node,
        children,
        blocksIds: depInfo.blocks.get(id) || [],
        blockedByIds: depInfo.blockedBy.get(id) || [],
      };
    }

    // find root nodes (no parent)
    const roots = nodes.filter((n) => !hasParent.has(n.id));
    const sortedRoots = sortTaskTreeNodes(roots, deps);

    const visited = new Set<string>();
    const treeNodes: HierarchyNode[] = [];
    for (const root of sortedRoots) {
      const node = buildNode(root.id, visited);
      if (node) treeNodes.push(node);
    }

    // orphans
    for (const n of nodes) {
      if (!visited.has(n.id)) {
        treeNodes.push({
          node: n,
          children: [],
          blocksIds: depInfo.blocks.get(n.id) || [],
          blockedByIds: depInfo.blockedBy.get(n.id) || [],
        });
      }
    }

    // operational re-rank (stable): running work on top, then Expected Next in
    // queue order, then blockers by downstream impact. A container ranks as its
    // best descendant so the epic with active work floats up; ties keep the
    // dependency/priority order built above.
    if (opStates && opStates.size > 0) {
      const rankCache = new Map<string, number>();
      const nodeRank = (item: HierarchyNode): number => {
        const cached = rankCache.get(item.node.id);
        if (cached !== undefined) return cached;
        let rank = operationalRank(opStates.get(item.node.id));
        for (const child of item.children) rank = Math.min(rank, nodeRank(child));
        rankCache.set(item.node.id, rank);
        return rank;
      };
      const sortByOps = (list: HierarchyNode[]) => {
        list.sort(
          (a, b) =>
            nodeRank(a) - nodeRank(b) ||
            compareOperationalStates(opStates.get(a.node.id), opStates.get(b.node.id))
        );
        for (const item of list) sortByOps(item.children);
      };
      sortByOps(treeNodes);
    }

    return treeNodes;
  }, [nodes, links, deps, nodeMap, depInfo, opStates]);

  // stats
  const stats = useMemo(() => {
    const open = nodes.filter((n) => !isTerminalTaskStatus(n.status)).length;
    const closed = nodes.filter((n) => isTerminalTaskStatus(n.status)).length;
    return { open, closed, total: nodes.length };
  }, [nodes]);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleClick = useCallback(
    (id: string) => onSelectTask?.(id),
    [onSelectTask]
  );

  // flattened, keyboard-navigable order of everything currently visible
  const flatRows = useMemo(
    () => flattenVisibleRows(tree, collapsed, showClosed),
    [tree, collapsed, showClosed]
  );

  // keyboard nav: up/down move selection, left/right collapse/expand or step to parent/child
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;
      if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
      if (flatRows.length === 0) return;

      const currentIndex = flatRows.findIndex((r) => r.id === selectedId);

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const nextIndex = currentIndex === -1 ? 0 : Math.min(currentIndex + 1, flatRows.length - 1);
        onSelectTask?.(flatRows[nextIndex].id);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prevIndex = currentIndex <= 0 ? 0 : currentIndex - 1;
        onSelectTask?.(flatRows[prevIndex].id);
      } else if (e.key === "ArrowRight") {
        if (currentIndex === -1) return;
        const row = flatRows[currentIndex];
        if (!row.hasChildren) return;
        e.preventDefault();
        if (collapsed.has(row.id)) {
          toggleCollapse(row.id);
        } else {
          const child = flatRows[currentIndex + 1];
          if (child?.parentId === row.id) onSelectTask?.(child.id);
        }
      } else if (e.key === "ArrowLeft") {
        if (currentIndex === -1) return;
        const row = flatRows[currentIndex];
        if (row.hasChildren && !collapsed.has(row.id)) {
          e.preventDefault();
          toggleCollapse(row.id);
        } else if (row.parentId) {
          e.preventDefault();
          onSelectTask?.(row.parentId);
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [flatRows, selectedId, collapsed, onSelectTask, toggleCollapse]);

  // keep the selected row scrolled into view (keyboard nav can move selection off-screen)
  useEffect(() => {
    if (!selectedId) return;
    const el = document.querySelector(
      `[data-task-row-id="${CSS.escape(selectedId)}"]`
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <WaveSpinner size="sm" color="primary" animation="ripple" />
      </div>
    );
  }

  if (error && nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-foreground/30">
        {error}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* header bar */}
      <div className="flex items-center justify-between px-4 py-2 shrink-0 bg-accent">
        <span className="text-[10px] font-mono text-foreground/50">
          {stats.open} open · {stats.closed} completed · {deps.length} dependencies
        </span>
        <button
          onClick={() => setShowClosed(!showClosed)}
          className="text-[10px] font-mono text-foreground/40 hover:text-foreground/60 transition-colors"
        >
          {showClosed ? "hide completed" : "show completed"}
        </button>
      </div>

      {/* tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {tree.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-4">
            <p className="text-xs text-foreground/30">No tasks yet</p>
          </div>
        )}
        {tree.map((treeNode) => (
          <TreeRow
            key={treeNode.node.id}
            treeNode={treeNode}
            depth={0}
            collapsed={collapsed}
            showClosed={showClosed}
            nodeMap={nodeMap}
            opStates={opStates}
            selectedId={selectedId}
            onToggle={toggleCollapse}
            onClick={handleClick}
            dragId={dragId}
            dragIdRef={dragIdRef}
            dropTarget={dropTarget}
            onDragStart={setDrag}
            onDragOver={setDropTarget}
            onDragEnd={() => { setDrag(null); setDropTarget(null); }}
            onDrop={handleDrop}
          />
        ))}
      </div>
    </div>
  );
}

interface TreeRowProps {
  treeNode: HierarchyNode;
  depth: number;
  collapsed: Set<string>;
  showClosed: boolean;
  nodeMap: Map<string, ApiNode>;
  opStates?: Map<string, TaskOpIndicatorState>;
  selectedId?: string | null;
  onToggle: (id: string) => void;
  onClick: (id: string) => void;
  dragId: string | null;
  dragIdRef: React.RefObject<string | null>;
  dropTarget: string | null;
  onDragStart: (id: string | null) => void;
  onDragOver: (id: string | null) => void;
  onDragEnd: () => void;
  onDrop: (fromId: string, toId: string) => void;
}

function TreeRow({
  treeNode,
  depth,
  collapsed,
  showClosed,
  nodeMap,
  opStates,
  selectedId,
  onToggle,
  onClick,
  dragId,
  dragIdRef,
  dropTarget,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
}: TreeRowProps) {
  const { node, children, blocksIds, blockedByIds } = treeNode;
  const op = opStates?.get(node.id);
  const isClosed = isTerminalTaskStatus(node.status);
  const isEpic = node.type === "epic";
  const isDecision = node.type === "decision";
  const hasChildren = children.length > 0;
  const isCollapsed = collapsed.has(node.id);
  const priority: TaskPriority = mapPriority(node.priority);

  // count visible children (open items, or closed epics with their own open children)
  const visibleChildren = children.filter((c) => isChildVisible(c, showClosed)).length;

  // hide closed items unless showClosed, but keep epics that have visible children
  if (!isNodeRendered(treeNode, showClosed)) return null;

  // for epics: count open/total tasks (recursive)
  const epicStats = isEpic ? countTasks(treeNode, showClosed) : null;

  // blocked = can't work on this yet
  const isBlocked = blockedByIds.length > 0 && !isClosed;

  const hasVisibleChildren = visibleChildren > 0;

  const isSelected = selectedId === node.id;

  if (isEpic) {
    return (
      <div>
        {/* epic row */}
        <div
          data-task-row-id={node.id}
          className="flex items-center group"
          style={{ paddingLeft: 4 }}
        >
          {/* chevron toggle */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (hasChildren) onToggle(node.id);
            }}
            className="w-5 h-5 flex items-center justify-center shrink-0"
          >
            {hasChildren ? (
              isCollapsed ? (
                <ArrowRight1Filled className="h-3.5 w-3.5 text-foreground/40" />
              ) : (
                <ArrowDown1Filled className="h-3.5 w-3.5 text-foreground/40" />
              )
            ) : (
              <span className="w-3.5" />
            )}
          </button>

          {/* selectable epic row */}
          <button
            onClick={() => onClick(node.id)}
            className={`flex-1 flex items-center gap-2 px-2 py-2 rounded-sm transition-colors cursor-pointer min-w-0
              ${isSelected ? "bg-accent" : "hover:bg-accent/50"}`}
          >
            <PriorityBadge priority={priority} rawPriority={node.priority} />

            <span className="text-xs font-medium text-foreground truncate flex-1 text-left">
              {node.label}
            </span>

            {epicStats && (
              <span className="text-[10px] font-mono text-foreground/30 shrink-0">
                {epicStats.closed}/{epicStats.total}
              </span>
            )}

            {/* progress bar */}
            {epicStats && epicStats.total > 0 && (
              <div className="w-16 h-1 rounded-full bg-foreground/5 overflow-hidden shrink-0">
                <div
                  className="h-full rounded-full bg-green-400/60 transition-all"
                  style={{
                    width: `${Math.round((epicStats.closed / epicStats.total) * 100)}%`,
                  }}
                />
              </div>
            )}

            {isCollapsed && hasChildren && (
              <span className="text-[10px] font-mono text-foreground/25 shrink-0">
                {children.length}
              </span>
            )}
          </button>
        </div>

        {/* epic children */}
        {hasChildren && !isCollapsed && (
          <>
            {children.map((child) => (
              <TreeRow
                key={child.node.id}
                treeNode={child}
                depth={depth + 1}
                collapsed={collapsed}
                showClosed={showClosed}
                nodeMap={nodeMap}
                opStates={opStates}
                selectedId={selectedId}
                onToggle={onToggle}
                onClick={onClick}
                dragId={dragId}
                dragIdRef={dragIdRef}
                dropTarget={dropTarget}
                onDragStart={onDragStart}
                onDragOver={onDragOver}
                onDragEnd={onDragEnd}
                onDrop={onDrop}
              />
            ))}
            {/* hint for hidden closed items */}
            {!showClosed && visibleChildren < children.length && (
              <div
                className="text-[10px] font-mono text-foreground/20 py-1"
                style={{ paddingLeft: 4 + 20 }}
              >
                {children.length - visibleChildren} completed
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  const isDragging = dragId === node.id;
  const isDropTarget = dropTarget === node.id && dragId !== null && dragId !== node.id;

  // regular task row
  return (
    <div>
      <div
        data-task-row-id={node.id}
        onDragOver={(e) => {
          const srcId = dragIdRef.current;
          if (srcId && srcId !== node.id) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "link";
            onDragOver(node.id);
          }
        }}
        onDragLeave={() => {
          if (dropTarget === node.id) onDragOver(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          const fromId = e.dataTransfer.getData("text/plain");
          if (fromId && fromId !== node.id) {
            onDrop(fromId, node.id);
          }
          onDragOver(null);
        }}
        className={`flex items-center group transition-colors
          ${isDragging ? "opacity-40" : ""}
          ${isDropTarget ? "bg-blue-500/15" : ""}
          ${isDecision ? "bg-blue-500/5" : ""}`}
        style={{ paddingLeft: 4 }}
      >
        {/* expand/collapse for tasks with dep-children */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (hasVisibleChildren) onToggle(node.id);
          }}
          className="w-4 h-4 flex items-center justify-center shrink-0"
        >
          {hasVisibleChildren ? (
            isCollapsed ? (
              <ArrowRight1Filled className="h-3 w-3 text-foreground/25" />
            ) : (
              <ArrowDown1Filled className="h-3 w-3 text-foreground/25" />
            )
          ) : (
            <span className="w-3" />
          )}
        </button>

        {/* task row - draggable */}
        <button
          type="button"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData("text/plain", node.id);
            e.dataTransfer.effectAllowed = "link";
            onDragStart(node.id);
          }}
          onDragEnd={onDragEnd}
          onClick={() => onClick(node.id)}
          className={`flex-1 flex items-center gap-2 px-2 py-1.5 rounded-sm transition-colors cursor-grab min-w-0
            ${isClosed ? "opacity-35" : ""}
            ${isBlocked && !isSelected ? "opacity-60" : ""}
            ${isSelected ? "bg-accent" : isDecision ? "hover:bg-blue-500/10" : "hover:bg-accent"}`}
        >
          {/* status dot */}
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot(node.status)}`}
          />

          {/* priority + type */}
          <PriorityBadge priority={priority} rawPriority={node.priority} />
          <TypeBadge type={node.type} label={shortId(node.id)} />
          {isDecision && (
            <span
              className="inline-flex items-center gap-1 rounded-sm bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-300/75"
              title="Human decision gate"
            >
              <JudgeFilled className="h-2.5 w-2.5" />
              gate
            </span>
          )}

          {/* title */}
          <span
            className={`text-xs truncate flex-1 text-left ${
              isClosed
                ? "line-through text-foreground/40"
                : "text-foreground"
            }`}
          >
            {node.label}
          </span>

          {/* operational indicator (server read model) supersedes the raw dep
              counts; the counts remain the fallback when ops data is absent */}
          {op && !isClosed ? (
            <span className="shrink-0">
              <TaskOpIndicator state={op} />
            </span>
          ) : (
            <>
              {blockedByIds.length > 0 && (
                <span
                  className={`inline-flex items-center gap-0.5 text-[10px] font-mono shrink-0 ${
                    isClosed ? "text-red-400/30" : "text-red-400/60"
                  }`}
                  title={`Blocked by: ${blockedByIds.map((id) => nodeMap.get(id)?.label || id).join(", ")}`}
                >
                  <ArrowUpFilled className="h-2.5 w-2.5" />
                  {blockedByIds.length}
                </span>
              )}

              {blocksIds.length > 0 && (
                <span
                  className={`inline-flex items-center gap-0.5 text-[10px] font-mono shrink-0 ${
                    isClosed ? "text-amber-400/30" : "text-amber-400/60"
                  }`}
                  title={`Unlocks: ${blocksIds.map((id) => nodeMap.get(id)?.label || id).join(", ")}`}
                >
                  <ArrowDownFilled className="h-2.5 w-2.5" />
                  {blocksIds.length}
                </span>
              )}
            </>
          )}

          {/* child count badge when collapsed */}
          {hasChildren && isCollapsed && visibleChildren > 0 && (
            <span className="text-[10px] font-mono text-foreground/30 bg-foreground/5 px-1.5 rounded shrink-0">
              {visibleChildren}
            </span>
          )}

        </button>
      </div>

      {/* task children (sub-tasks from hierarchy) */}
      {hasVisibleChildren && !isCollapsed &&
        children.map((child) => (
          <TreeRow
            key={child.node.id}
            treeNode={child}
            depth={depth + 1}
            collapsed={collapsed}
            showClosed={showClosed}
            nodeMap={nodeMap}
            opStates={opStates}
            selectedId={selectedId}
            onToggle={onToggle}
            onClick={onClick}
            dragId={dragId}
            dragIdRef={dragIdRef}
            dropTarget={dropTarget}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            onDrop={onDrop}
          />
        ))}
    </div>
  );
}

function countTasks(
  node: HierarchyNode,
  showClosed: boolean
): { total: number; closed: number } {
  let total = 0;
  let closed = 0;

  for (const child of node.children) {
    if (child.node.type === "epic") {
      const sub = countTasks(child, showClosed);
      total += sub.total;
      closed += sub.closed;
    } else {
      total++;
      if (isTerminalTaskStatus(child.node.status)) closed++;
      // count sub-children too
      const sub = countTasks(child, showClosed);
      total += sub.total;
      closed += sub.closed;
    }
  }

  return { total, closed };
}
