"use client";

import { useState, useEffect } from "react";
import { ArrowDown2Filled as ChevronDown, ArrowRight2Filled as ChevronRight, ArrowUpFilled as ArrowUp, ArrowDownFilled as ArrowDown, AddFilled as Plus } from "@aliimam/icons";
import { graphToNodes, mapPriority } from "@/lib/tasks/task-transforms";
import { TypeBadge } from "./type-badge";
import { PriorityBadge } from "./priority-badge";
import { unwrapApiData } from "@/lib/api/api-client";
import type { GraphOutput, Task } from "@/lib/tasks/task-types";
import { WaveSpinner } from "@/components/ui/wave-spinner";
import { TaskDepPickerDialog } from "./task-dep-picker-dialog";

interface DepNode {
  id: string;
  label: string;
  type: string;
  status: string;
  priority?: number;
}

// helper components defined first for hoisting
function ChainView({
  blockedBy,
  blocks,
  currentTask,
  taskId,
  onSelectTask,
}: {
  blockedBy: DepNode[];
  blocks: DepNode[];
  currentTask: DepNode | null;
  taskId: string;
  onSelectTask?: (taskId: string) => void;
}) {
  // show up to 2 above and 2 below
  const above = blockedBy.slice(-2).reverse();
  const below = blocks.slice(0, 2);

  const statusColor = (status: string) =>
    status === "closed"
      ? "bg-green-400"
      : status === "in_progress"
        ? "bg-blue-400"
        : "bg-foreground/20";

  const shortId = (id: string) => id.split("-").pop() || id;

  return (
    <div className="mt-3 flex flex-col items-center gap-1">
      {below.map((dep) => (
        <ChainNode
          key={dep.id}
          node={dep}
          relation="blocked"
          onClick={() => onSelectTask?.(dep.id)}
        />
      ))}

      <div className="w-full flex items-center gap-2 px-3 py-2 bg-accent rounded-md border-l-2 border-foreground/40">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {currentTask && (
              <PriorityBadge priority={mapPriority(currentTask.priority ?? 2)} rawPriority={currentTask.priority ?? 2} />
            )}
            <TypeBadge type={currentTask?.type || "task"} />
            <span className="text-[9px] font-mono text-foreground/30">{shortId(taskId)}</span>
          </div>
          <div className="text-xs text-foreground font-medium truncate mt-0.5">
            {currentTask?.label || "Current Task"}
          </div>
        </div>
        <span
          className={`h-2 w-2 rounded-full shrink-0 ${
            currentTask ? statusColor(currentTask.status) : "bg-foreground/20"
          }`}
        />
      </div>

      {above.map((dep) => (
        <ChainNode
          key={dep.id}
          node={dep}
          relation="blocking"
          onClick={() => onSelectTask?.(dep.id)}
        />
      ))}

      {(blockedBy.length > 2 || blocks.length > 2) && (
        <span className="text-[10px] text-foreground/25 font-mono">
          {blockedBy.length > 2 ? `+${blockedBy.length - 2} blocking ` : ""}
          {blocks.length > 2 ? `+${blocks.length - 2} blocked` : ""}
        </span>
      )}
    </div>
  );
}

function ChainNode({
  node,
  relation,
  onClick,
}: {
  node: DepNode;
  relation: "blocking" | "blocked";
  onClick: () => void;
}) {
  const statusColor =
    node.status === "closed"
      ? "bg-green-400"
      : node.status === "in_progress"
        ? "bg-blue-400"
        : "bg-foreground/20";

  const shortId = node.id.split("-").pop() || node.id;

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent/50 text-left group transition-colors"
    >
      {relation === "blocking" ? (
        <ArrowDown className="h-3 w-3 text-red-400/40 shrink-0" />
      ) : (
        <ArrowUp className="h-3 w-3 text-amber-400/40 shrink-0" />
      )}

      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${statusColor}`} />

      <div className="flex-1 min-w-0">
        <div className="text-[10px] text-foreground/50 truncate">{node.label}</div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <PriorityBadge priority={mapPriority(node.priority ?? 2)} rawPriority={node.priority ?? 2} />
          <TypeBadge type={node.type} />
          <span className="text-[8px] font-mono text-foreground/20">{shortId}</span>
        </div>
      </div>
    </button>
  );
}

interface TaskDepsGraphProps {
  taskId: string;
  onSelectTask?: (taskId: string) => void;
  allTasks?: Task[];
  onAddDep?: (depTaskId: string) => Promise<void>;
  workspacePath?: string;
}

export function TaskDepsGraph({ taskId, onSelectTask, allTasks = [], onAddDep, workspacePath }: TaskDepsGraphProps) {
  const [blockedBy, setBlockedBy] = useState<DepNode[]>([]);
  const [blocks, setBlocks] = useState<DepNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(true);
  const [viewMode, setViewMode] = useState<"list" | "chain">("chain");
  const [currentTask, setCurrentTask] = useState<DepNode | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const id = encodeURIComponent(taskId);
    fetch(`/api/tasks/${id}/deps?format=graph`, { signal: controller.signal })
      .then((res) => res.json())
      .then((raw) => {
        const data = unwrapApiData<{ graph?: GraphOutput }>(raw);
        if (!data.graph?.layout?.Nodes) {
          setBlockedBy([]);
          setBlocks([]);
          return;
        }
        const result = graphToNodes(data.graph);

        const current = result.nodes.find((n) => n.id === taskId);
        if (current) setCurrentTask(current);

        const blockedByList: DepNode[] = [];
        const blocksList: DepNode[] = [];

        for (const link of result.links) {
          if (link.target === taskId) {
            const node = result.nodes.find((n) => n.id === link.source);
            if (node && node.id !== taskId) blockedByList.push(node);
          }
          if (link.source === taskId) {
            const node = result.nodes.find((n) => n.id === link.target);
            if (node && node.id !== taskId) blocksList.push(node);
          }
        }

        setBlockedBy(blockedByList);
        setBlocks(blocksList);
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          setBlockedBy([]);
          setBlocks([]);
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [taskId]);

  if (loading) {
    return (
      <div className="px-4 py-3">
        <span className="text-xs text-foreground/40 font-medium">
          Dependencies
        </span>
        <div className="mt-2">
          <WaveSpinner size="xs" color="primary" animation="ripple" />
        </div>
      </div>
    );
  }

  const total = blockedBy.length + blocks.length;
  if (total === 0) return null;

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1 text-xs text-foreground/40 font-medium hover:text-foreground/60"
        >
          {open ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          Dependencies ({total})
        </button>
        {total > 0 && (
          <button
            onClick={() => setViewMode(viewMode === "list" ? "chain" : "list")}
            className="text-[10px] text-foreground/30 hover:text-foreground/50 transition-colors"
          >
            {viewMode === "list" ? "chain view" : "list view"}
          </button>
        )}
      </div>

      {open && viewMode === "chain" && (
        <ChainView
          blockedBy={blockedBy}
          blocks={blocks}
          currentTask={currentTask}
          taskId={taskId}
          onSelectTask={onSelectTask}
        />
      )}

      {open && viewMode === "list" && (
        <div className="mt-2 space-y-3">
          {blockedBy.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <ArrowUp className="h-3 w-3 text-red-400/60" />
                  <span className="text-[10px] text-red-400/60 font-medium">
                    Blocked by
                  </span>
                </div>
                {onAddDep && (
                  <button
                    onClick={() => setShowPicker(true)}
                    className="text-[9px] text-foreground/30 hover:text-foreground/50 transition-colors flex items-center gap-1"
                  >
                    <Plus className="h-2.5 w-2.5" />
                    add
                  </button>
                )}
              </div>
              <div className="space-y-0.5">
                {blockedBy.map((dep) => (
                  <DepRow
                    key={dep.id}
                    dep={dep}
                    onClick={() => onSelectTask?.(dep.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {blocks.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <ArrowDown className="h-3 w-3 text-amber-400/60" />
                <span className="text-[10px] text-amber-400/60 font-medium">
                  Blocks
                </span>
              </div>
              <div className="space-y-0.5">
                {blocks.map((dep) => (
                  <DepRow
                    key={dep.id}
                    dep={dep}
                    onClick={() => onSelectTask?.(dep.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* dependency picker dialog */}
      {onAddDep && (
        <TaskDepPickerDialog
          open={showPicker}
          onClose={() => setShowPicker(false)}
          onAddDep={onAddDep}
          allTasks={allTasks}
          currentTaskId={taskId}
          existingDepIds={blockedBy.map((d) => d.id)}
          workspacePath={workspacePath}
        />
      )}
    </div>
  );
}

function DepRow({ dep, onClick }: { dep: DepNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md hover:bg-accent text-left group"
    >
      <span
        className={`h-1.5 w-1.5 rounded-full shrink-0 ${
          dep.status === "closed"
            ? "bg-green-400"
            : dep.status === "in_progress"
              ? "bg-blue-400"
              : "bg-foreground/20"
        }`}
      />
      <span className="text-xs text-foreground/70 group-hover:text-foreground/90 truncate flex-1">
        {dep.label}
      </span>
      <TypeBadge type={dep.type} />
      <span className="text-[9px] font-mono text-foreground/25 shrink-0">
        {dep.id}
      </span>
    </button>
  );
}
