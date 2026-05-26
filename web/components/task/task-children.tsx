"use client";

import { ArrowDownFilled, ArrowUpFilled, Link2Filled as Link2 } from "@aliimam/icons";
import { cn } from "@/lib/utils";
import { PriorityBadge } from "./priority-badge";
import { TypeBadge } from "./type-badge";
import type { Task } from "@/lib/task-types";
import { sortTasksByDependencyOrder } from "@/lib/task-ordering";

interface TaskChildrenProps {
  items: Task[];
  onSelectChild: (task: Task) => void;
  depInfo?: Map<string, { blockedBy: string[]; blocks: string[] }>;
}

function shortId(id: string): string {
  return id.split("-").pop() || id;
}

function isReadyInSequence(
  task: Task,
  itemsById: Map<string, Task>,
  depInfo?: Map<string, { blockedBy: string[]; blocks: string[] }>
): boolean {
  if (task.completed) return false;
  const blockers = depInfo?.get(task.id)?.blockedBy;
  if (!blockers) return true;
  return blockers.every((blockerId) => itemsById.get(blockerId)?.completed ?? true);
}

export function TaskChildren({ items, onSelectChild, depInfo }: TaskChildrenProps) {
  if (items.length === 0) return null;

  const orderedItems = sortTasksByDependencyOrder(items, depInfo || []);
  const itemsById = new Map(orderedItems.map((item) => [item.id, item]));
  const activeIndex = Math.max(
    0,
    orderedItems.findIndex((item) => isReadyInSequence(item, itemsById, depInfo))
  );

  return (
    <div className="px-4 py-3">
      <span className="text-xs text-foreground/40 font-medium">
        Subtasks ({items.length})
      </span>
      <div className="relative mt-3 space-y-1">
        <div className="absolute left-2.5 top-3 bottom-3 w-px bg-foreground/10" />
        {orderedItems.map((child, index) => {
          const isActive = index === activeIndex && !child.completed;
          const deps = depInfo?.get(child.id);
          const blockedByCount = deps?.blockedBy.length ?? child.dependencyCount;
          const blocksCount = deps?.blocks.length ?? child.dependentCount;

          return (
            <button
              key={child.id}
              className={cn(
                "relative w-full text-left rounded-md transition-colors group",
                isActive
                  ? "bg-accent pl-8 pr-3 py-3 border-l-2 border-foreground/40"
                  : "pl-8 pr-3 py-2 hover:bg-accent/50"
              )}
              onClick={() => onSelectChild(child)}
            >
              <div className="absolute left-1.5 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center">
                <span
                  className={cn(
                    "h-2 w-2 rounded-full shrink-0 ring-2 ring-background",
                    child.completed
                      ? "bg-green-400"
                      : child.chainBinding?.last_run_status === "running"
                        ? "bg-blue-400 animate-pulse"
                        : isActive
                          ? "bg-foreground/50"
                          : "bg-foreground/20"
                  )}
                />
              </div>

              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[10px] text-foreground/35">
                    {blocksCount > 0 && (
                      <ArrowUpFilled className="h-2.5 w-2.5 text-amber-400/60" />
                    )}
                    {blockedByCount > 0 && (
                      <ArrowDownFilled className="h-2.5 w-2.5 text-red-400/50" />
                    )}
                    <PriorityBadge
                      priority={child.priority}
                      rawPriority={child.rawPriority}
                    />
                    <TypeBadge type={child.type} />
                    <span className="font-mono text-foreground/30">{shortId(child.id)}</span>
                    {child.chainBinding && (
                      <span className="inline-flex items-center gap-0.5 text-foreground/30">
                        <Link2 className="h-2.5 w-2.5" />
                        {child.chainBinding.chain_name || child.chainBinding.chain_id}
                      </span>
                    )}
                  </div>
                  <span className="mt-1 block truncate text-sm text-foreground/80 group-hover:text-foreground">
                    {child.title}
                  </span>
                </div>
                {child.chainBinding?.last_run_status === "running" && (
                  <span className="shrink-0 text-[9px] text-blue-400 font-medium">
                    running
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
