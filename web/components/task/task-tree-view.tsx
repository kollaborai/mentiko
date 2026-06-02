"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useWorkspace } from "@/lib/workspace-context";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { unwrapApiData, getApiErrorMessage } from "@/lib/api-client";
import { mapPriority } from "@/lib/task-transforms";
import { sortTaskTreeNodes } from "@/lib/task-ordering";
import { WaveSpinner } from "@/components/ui/wave-spinner";
import { TypeBadge } from "./type-badge";
import { PriorityBadge } from "./priority-badge";
import type { TaskPriority } from "@/lib/task-types";
import {
  ArrowDown1Filled,
  ArrowRight1Filled,
  ArrowDownFilled,
  ArrowUpFilled,
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
}

function statusDot(status: string) {
  if (status === "closed") return "bg-green-400";
  if (status === "in_progress") return "bg-blue-400";
  return "bg-foreground/30";
}

// shorten a task id for display: "mentiko-2eb.18.1" -> ".18.1"
function shortId(id: string): string {
  const dot = id.indexOf(".");
  if (dot === -1) return id;
  return id.slice(dot);
}

export function TaskTreeView({ onSelectTask, selectedId }: TaskTreeViewProps) {
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
      })
      .catch(() => setError("Failed to load graph"))
      .finally(() => setLoading(false));
  }, [workspacePath, fetchWithNamespace]);

  useEffect(() => { fetchGraph(); }, [fetchGraph]);

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

    return treeNodes;
  }, [nodes, links, deps, nodeMap, depInfo]);

  // stats
  const stats = useMemo(() => {
    const open = nodes.filter((n) => n.status !== "closed").length;
    const closed = nodes.filter((n) => n.status === "closed").length;
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

  return (
    <div className="h-full flex flex-col">
      {/* header bar */}
      <div className="flex items-center justify-between px-4 py-2 shrink-0 bg-accent">
        <span className="text-[10px] font-mono text-foreground/50">
          {stats.open} open · {stats.closed} closed · {deps.length} dependencies
        </span>
        <button
          onClick={() => setShowClosed(!showClosed)}
          className="text-[10px] font-mono text-foreground/40 hover:text-foreground/60 transition-colors"
        >
          {showClosed ? "hide closed" : "show closed"}
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
  const isClosed = node.status === "closed";
  const isEpic = node.type === "epic";
  const hasChildren = children.length > 0;
  const isCollapsed = collapsed.has(node.id);
  const priority: TaskPriority = mapPriority(node.priority);

  // count visible children (open items, or closed epics with their own open children)
  const visibleChildren = showClosed
    ? children.length
    : children.filter((c) => {
        // open items always visible
        if (c.node.status !== "closed") return true;
        // closed items only visible if they're epics with open descendants
        if (c.node.type === "epic") {
          // recursively check if this epic has any open descendants
          function hasOpenDescendant(node: HierarchyNode): boolean {
            if (node.node.status !== "closed" && node.node.type !== "epic") return true;
            return node.children.some(child => hasOpenDescendant(child));
          }
          return hasOpenDescendant(c);
        }
        return false;
      }).length;

  // hide closed items unless showClosed, but keep epics that have visible children
  const shouldHide = isClosed && !showClosed;
  if (shouldHide && !(isEpic && visibleChildren > 0)) return null;

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
          className="flex items-center group"
          style={{ paddingLeft: 12 + depth * 16 }}
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
                style={{ paddingLeft: 12 + (depth + 1) * 16 + 20 }}
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
          ${isDropTarget ? "bg-blue-500/15" : ""}`}
        style={{ paddingLeft: 12 + depth * 16 }}
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
        <div
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData("text/plain", node.id);
            e.dataTransfer.effectAllowed = "link";
            onDragStart(node.id);
          }}
          onDragEnd={onDragEnd}
          onClick={() => onClick(node.id)}
          role="button"
          tabIndex={0}
          className={`flex-1 flex items-center gap-2 px-2 py-1.5 rounded-sm transition-colors cursor-grab min-w-0
            ${isClosed ? "opacity-35" : ""}
            ${isBlocked && !isSelected ? "opacity-60" : ""}
            ${isSelected ? "bg-accent" : "hover:bg-accent"}`}
        >
          {/* status dot */}
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot(node.status)}`}
          />

          {/* priority + type */}
          <PriorityBadge priority={priority} rawPriority={node.priority} />
          <TypeBadge type={node.type} />

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

          {/* dep indicators */}
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

          {/* child count badge when collapsed */}
          {hasChildren && isCollapsed && visibleChildren > 0 && (
            <span className="text-[10px] font-mono text-foreground/30 bg-foreground/5 px-1.5 rounded shrink-0">
              {visibleChildren}
            </span>
          )}

          {/* id */}
          <span className="text-[10px] font-mono text-foreground/15 shrink-0 hidden group-hover:inline">
            {shortId(node.id)}
          </span>
        </div>
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
      if (child.node.status === "closed") closed++;
      // count sub-children too
      const sub = countTasks(child, showClosed);
      total += sub.total;
      closed += sub.closed;
    }
  }

  return { total, closed };
}
