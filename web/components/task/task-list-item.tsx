"use client";

import { Link2Filled, PlayFilled, ArrowUpFilled, ArrowDownFilled, TickSquareFilled, SquareRounded } from "@aliimam/icons";
import { cn } from "@/lib/utils";
import { PriorityBadge } from "./priority-badge";
import { TypeBadge } from "./type-badge";
import { timeAgo } from "@/lib/tasks/task-transforms";
import type { Task } from "@/lib/tasks/task-types";
import { WorkflowSidebarItem } from "@/components/ui/workflow-sidebar";

const MAX_AUTO_RUN_RETRIES = 3;

interface TaskListItemProps {
  task: Task;
  selected: boolean;
  onSelect: (task: Task) => void;
  onToggleComplete: (task: Task) => void;
  depInfo?: Map<string, { blockedBy: string[]; blocks: string[] }>;
  selectMode?: boolean;
  isChecked?: boolean;
}

function isRunRecent(lastRunId: string | undefined): boolean {
  if (!lastRunId) return false;
  const match = lastRunId.match(/run-(\d+)/);
  if (!match) return false;
  const timestamp = parseInt(match[1], 10);
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  return timestamp > fiveMinutesAgo;
}

function getTaskAccent(task: Task): string {
  if (
    task.chainBinding?.auto_run &&
    (task.chainBinding.auto_run_retries || 0) >= MAX_AUTO_RUN_RETRIES &&
    !task.completed
  ) {
    return "bg-red-500";
  }
  if (task.chainBinding?.last_run_decision_required) return "bg-amber-400";
  if (task.type === "decision") return task.completed ? "bg-emerald-500" : "bg-blue-400";
  if (task.completed) return "bg-emerald-500";
  switch (task.chainBinding?.last_run_status) {
    case "running":
      return "bg-sky-400";
    case "failed":
      return "bg-red-400";
    case "completed":
      return "bg-emerald-400";
    case "pending":
      return "bg-amber-400";
    default:
      return task.rawPriority <= 1 ? "bg-amber-400" : "bg-muted-foreground/40";
  }
}

export function TaskListItem({
  task,
  selected,
  onSelect,
  onToggleComplete: _onToggleComplete,
  depInfo,
  selectMode,
  isChecked,
}: TaskListItemProps) {
  const isRunning = task.chainBinding?.last_run_status === "running";
  const needsRunReview = !!task.chainBinding?.last_run_decision_required;
  const hasRecentRun = isRunning || isRunRecent(task.chainBinding?.last_run_id);
  const autoRunRetries = task.chainBinding?.auto_run_retries || 0;
  const autoRunPaused =
    !!task.chainBinding?.auto_run &&
    autoRunRetries >= MAX_AUTO_RUN_RETRIES &&
    !task.completed;

  // get dependency counts from depInfo if available
  const deps = depInfo?.get(task.id);
  const blockedByCount = deps?.blockedBy.length || 0;
  const blocksCount = deps?.blocks.length || 0;

  return (
    <WorkflowSidebarItem
      selected={!selectMode && selected}
      onClick={() => onSelect(task)}
      accentClassName={getTaskAccent(task)}
      className={cn(
        "rounded-md px-3 py-2.5",
        task.type === "decision" && "bg-blue-500/5",
        selected && task.type === "decision" && "bg-blue-500/10",
        isRunning && "animate-in fade-in duration-300"
      )}
    >
      <div className={cn("relative", selectMode ? "pl-10" : "pl-4")}>
        {selectMode && (
          <div className="absolute left-2 top-1/2 -translate-y-1/2">
            {isChecked ? (
              <TickSquareFilled className="h-4 w-4 text-foreground" />
            ) : (
              <SquareRounded className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-2">
            <span
              className={cn(
                "line-clamp-2 text-sm font-semibold leading-5",
                task.completed && "text-foreground/45 line-through"
              )}
            >
              {task.title}
            </span>
            <span className="shrink-0 text-[10px] text-foreground/30">
              {timeAgo(task.updatedAt)}
            </span>
          </div>

          {task.description ? (
            <p className="line-clamp-1 text-[11px] text-foreground/40 mt-0.5">
              {task.description}
            </p>
          ) : null}

          {task.type === "decision" && (
            <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-blue-300/60">
              human decision gate
            </p>
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-foreground/40">
            <TypeBadge type={task.type} />
            <PriorityBadge priority={task.priority} />
            <span className="font-mono text-foreground/25">{task.id}</span>
            {task.chainBinding && (
              <span className="inline-flex items-center gap-1 rounded-full bg-foreground/5 px-2 py-0.5 text-[10px] text-foreground/55">
                <Link2Filled className="h-2.5 w-2.5" />
                {task.chainBinding.chain_name || task.chainBinding.chain_id}
              </span>
            )}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-foreground/40">
            {blockedByCount > 0 && (
              <span
                className="inline-flex items-center gap-0.5 rounded-full bg-foreground/5 px-1.5 py-0.5"
                title={`Blocked by ${blockedByCount} task${blockedByCount > 1 ? 's' : ''}`}
              >
                <ArrowUpFilled className="h-2 w-2 text-red-400/60" />
                <span className={cn(
                  blockedByCount > 0 && !task.completed ? "text-red-400/70" : ""
                )}>
                  {blockedByCount}
                </span>
              </span>
            )}
            {blocksCount > 0 && (
              <span
                className="inline-flex items-center gap-0.5 rounded-full bg-foreground/5 px-1.5 py-0.5"
                title={`Unlocks ${blocksCount} task${blocksCount > 1 ? 's' : ''}`}
              >
                <ArrowDownFilled className="h-2 w-2 text-amber-400/60" />
                <span className="text-amber-400/70">{blocksCount}</span>
              </span>
            )}
            {task.chainBinding?.auto_run && !task.completed && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5",
                  autoRunPaused
                    ? "bg-red-500/15 text-red-300"
                    : autoRunRetries > 0
                      ? "bg-amber-500/15 text-amber-300"
                      : "bg-emerald-500/10 text-emerald-300"
                )}
                title={
                  autoRunPaused
                    ? `Auto-run paused after ${autoRunRetries}/${MAX_AUTO_RUN_RETRIES} failed attempts`
                    : autoRunRetries > 0
                      ? `Auto-run has ${autoRunRetries}/${MAX_AUTO_RUN_RETRIES} failed attempts`
                      : "Auto-run enabled"
                }
              >
                {autoRunPaused ? `Auto paused ${autoRunRetries}/${MAX_AUTO_RUN_RETRIES}` : autoRunRetries > 0 ? `Auto ${autoRunRetries}/${MAX_AUTO_RUN_RETRIES}` : "Auto"}
              </span>
            )}
            {hasRecentRun && task.chainBinding?.last_run_id && (
              <a
                href={`/runs?runId=${task.chainBinding.last_run_id}`}
                className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 text-sky-300 hover:bg-sky-500/15"
                onClick={(event) => event.stopPropagation()}
              >
                <PlayFilled className="h-2.5 w-2.5" />
                {task.chainBinding.last_run_id}
              </a>
            )}
            {needsRunReview && task.chainBinding?.last_run_id && (
              <a
                href={`/runs?runId=${task.chainBinding.last_run_id}`}
                className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-300 hover:bg-amber-500/15"
                onClick={(event) => event.stopPropagation()}
                title={`Run outcome: ${task.chainBinding.last_run_outcome || "review required"}`}
              >
                <PlayFilled className="h-2.5 w-2.5" />
                review run
              </a>
            )}
          </div>
        </div>
      </div>
    </WorkflowSidebarItem>
  );
}
