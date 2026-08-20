"use client";

import { useEffect, useState } from "react";

import {
  Link2Filled,
  PlayFilled,
  ArrowUpFilled,
  ArrowDownFilled,
  TickSquareFilled,
  SquareRounded,
} from "@aliimam/icons";
import { cn } from "@/lib/utils";
import { PriorityBadge } from "./priority-badge";
import { timeAgo } from "@/lib/tasks/task-transforms";
import type { Task } from "@/lib/tasks/task-types";
import {
  resolveAutoRunState,
  MAX_AUTO_RUN_RETRIES,
} from "@/lib/tasks/auto-run-state";
import { WorkflowSidebarItem } from "@/components/ui/workflow-sidebar";
import {
  TaskOpIndicator,
  type TaskOpIndicatorState,
} from "@/components/task/task-op-indicator";
import { TaskSidebarConfiguredLayout } from "@/components/task/task-sidebar-configured";
import type { EditorState } from "@/app/docs/ui-editor/editor-model";
import {
  readTaskSidebarEditorState,
  TASK_SIDEBAR_EDITOR_UPDATED_EVENT,
} from "@/lib/task-sidebar-editor";

// Resolved auto-run state -- single source of truth (lib/tasks/auto-run-state.ts).
// Prefer the server-resolved Task.autoRun (folds in the workspace default); fall
// back to resolving from raw chainBinding fields via the SAME resolver so the list
// item never disagrees with the admission gate or the detail header.
function taskAutoRunState(task: Task) {
  return (
    task.autoRun ??
    resolveAutoRunState({
      explicitAutoRun:
        typeof task.chainBinding?.auto_run === "boolean"
          ? task.chainBinding.auto_run
          : undefined,
    retries: task.chainBinding?.auto_run_retries,
    userPaused: task.chainBinding?.auto_run_paused,
    pausedReason: task.chainBinding?.auto_run_paused_reason,
    completed: task.completed,
    })
  );
}

interface TaskListItemProps {
  task: Task;
  selected: boolean;
  onSelect: (task: Task) => void;
  onToggleComplete: (task: Task) => void;
  depInfo?: Map<string, { blockedBy: string[]; blocks: string[] }>;
  selectMode?: boolean;
  isChecked?: boolean;
  /** Operational state from /api/operations/timeline — richer than depInfo when present. */
  op?: TaskOpIndicatorState;
}

function isRunRecent(lastRunId: string | undefined): boolean {
  if (!lastRunId) return false;
  const match = lastRunId.match(/run-(\d+)/);
  if (!match) return false;
  const timestamp = parseInt(match[1], 10);
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  return timestamp > fiveMinutesAgo;
}

function TaskOperationalMeta({
  task,
  op,
  blockedByCount,
  blocksCount,
  autoRun,
  autoRunRetries,
  autoRunPaused,
  hasRecentRun,
  needsRunReview,
}: {
  task: Task;
  op?: TaskOpIndicatorState;
  blockedByCount: number;
  blocksCount: number;
  autoRun: ReturnType<typeof taskAutoRunState>;
  autoRunRetries: number;
  autoRunPaused: boolean;
  hasRecentRun: boolean;
  needsRunReview: boolean;
}) {
  return (
    <div className="mt-1 flex min-w-0 items-center gap-1.5 overflow-hidden text-[10px] text-foreground/40">
      {op && !task.completed ? (
        <TaskOpIndicator state={op} hide={["running", "paused"]} />
      ) : null}
      {!op && blockedByCount > 0 ? (
        <span
          className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-foreground/5 px-1.5 py-0.5"
          title={`${blockedByCount} dependenc${blockedByCount === 1 ? "y" : "ies"}`}
        >
          <ArrowUpFilled className="h-2 w-2 text-foreground/35" />
          <span>{blockedByCount}</span>
        </span>
      ) : null}
      {!op && blocksCount > 0 ? (
        <span
          className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-foreground/5 px-1.5 py-0.5"
          title={`Unlocks ${blocksCount} task${blocksCount > 1 ? "s" : ""}`}
        >
          <ArrowDownFilled className="h-2 w-2 text-amber-400/60" />
          <span className="text-amber-400/70">{blocksCount}</span>
        </span>
      ) : null}
      {autoRun.enabled && !task.completed ? (
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5",
            autoRunPaused
              ? "bg-red-500/15 text-red-300"
              : autoRunRetries > 0
                ? "bg-amber-500/15 text-amber-300"
                : "bg-emerald-500/10 text-emerald-300",
          )}
        >
          {autoRunPaused
            ? `Auto paused ${autoRunRetries}/${MAX_AUTO_RUN_RETRIES}`
            : autoRunRetries > 0
              ? `Auto ${autoRunRetries}/${MAX_AUTO_RUN_RETRIES}`
              : "Auto"}
        </span>
      ) : null}
      {hasRecentRun && task.chainBinding?.last_run_id ? (
        <a
          href={`/runs?runId=${task.chainBinding.last_run_id}`}
          className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-sky-500/10 px-2 py-0.5 text-sky-300 hover:bg-sky-500/15"
          onClick={(event) => event.stopPropagation()}
          title={task.chainBinding.last_run_id}
        >
          <PlayFilled className="h-2.5 w-2.5" />
          view run
        </a>
      ) : null}
      {needsRunReview && task.chainBinding?.last_run_id ? (
        <a
          href={`/runs?runId=${task.chainBinding.last_run_id}`}
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-300 hover:bg-amber-500/15"
          onClick={(event) => event.stopPropagation()}
          title={`Run outcome: ${task.chainBinding.last_run_outcome || "review required"}`}
        >
          <PlayFilled className="h-2.5 w-2.5" />
          review run
        </a>
      ) : null}
    </div>
  );
}

export function TaskListItem({
  task,
  selected,
  onSelect,
  onToggleComplete: _onToggleComplete,
  depInfo,
  selectMode,
  isChecked,
  op,
}: TaskListItemProps) {
  const [editorState, setEditorState] = useState<EditorState | null>(null);

  useEffect(() => {
    const loadEditorState = () => {
      setEditorState(readTaskSidebarEditorState());
    };

    loadEditorState();
    window.addEventListener("storage", loadEditorState);
    window.addEventListener(TASK_SIDEBAR_EDITOR_UPDATED_EVENT, loadEditorState);
    return () => {
      window.removeEventListener("storage", loadEditorState);
      window.removeEventListener(
        TASK_SIDEBAR_EDITOR_UPDATED_EVENT,
        loadEditorState,
      );
    };
  }, []);

  const isRunning = task.chainBinding?.last_run_status === "running";
  const needsRunReview = !!task.chainBinding?.last_run_decision_required;
  const hasRecentRun = isRunning || isRunRecent(task.chainBinding?.last_run_id);
  const autoRun = taskAutoRunState(task);
  const autoRunRetries = autoRun.retries;
  const autoRunPaused = autoRun.retriesExhausted;

  // get dependency counts from depInfo if available
  const deps = depInfo?.get(task.id);
  const blockedByCount = deps?.blockedBy.length || 0;
  const blocksCount = deps?.blocks.length || 0;

  return (
    <WorkflowSidebarItem
      selected={!selectMode && selected}
      onClick={() => onSelect(task)}
      className={cn(
        "rounded-md px-3 py-2",
        task.type === "decision" && "bg-blue-500/5",
        selected && task.type === "decision" && "bg-blue-500/10",
        isRunning && "animate-in fade-in duration-300",
      )}
    >
      <div className={cn("relative", selectMode ? "pl-7" : "pl-0")}>
        {selectMode && (
          <div className="absolute left-2 top-1/2 -translate-y-1/2">
            {isChecked ? (
              <TickSquareFilled className="h-4 w-4 text-foreground" />
            ) : (
              <SquareRounded className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        )}
        {editorState ? (
          <>
            <TaskSidebarConfiguredLayout
              state={editorState}
              task={task}
              depInfo={depInfo}
            />
            <TaskOperationalMeta
              task={task}
              op={op}
              blockedByCount={blockedByCount}
              blocksCount={blocksCount}
              autoRun={autoRun}
              autoRunRetries={autoRunRetries}
              autoRunPaused={autoRunPaused}
              hasRecentRun={hasRecentRun}
              needsRunReview={needsRunReview}
            />
          </>
        ) : (
          <div className="min-w-0">
            <div className="flex min-w-0 items-start justify-between gap-2">
              <span
                className={cn(
                  "min-w-0 flex-1 line-clamp-2 text-sm font-semibold leading-5",
                  task.completed && "text-foreground/45 line-through",
                )}
                title={task.title}
              >
                {task.title}
              </span>
              <span className="shrink-0 whitespace-nowrap text-[10px] font-normal text-foreground/30">
                {timeAgo(task.updatedAt)}
              </span>
            </div>

            <div className="mt-1 flex min-w-0 items-center gap-1.5 overflow-hidden text-[10px] text-foreground/40">
              <PriorityBadge
                priority={task.priority}
                rawPriority={task.rawPriority}
              />
              <span className="shrink-0 whitespace-nowrap font-mono text-foreground/25">
                {task.id}
              </span>
              {task.chainBinding && (
                <span
                  className="inline-flex min-w-0 items-center gap-1 truncate text-foreground/55"
                  title={task.chainBinding.chain_name || task.chainBinding.chain_id}
                >
                  <Link2Filled className="h-2.5 w-2.5" />
                  <span className="truncate">
                    {task.chainBinding.chain_name || task.chainBinding.chain_id}
                  </span>
                </span>
              )}
              {/* Operational indicator (server read model) supersedes the raw dep
                  counts; the counts remain the fallback when ops data is absent. */}
              {op && !task.completed && (
                <TaskOpIndicator state={op} hide={["running", "paused"]} />
              )}
              {!op && blockedByCount > 0 && (
                <span
                  className="inline-flex items-center gap-0.5 rounded-full bg-foreground/5 px-1.5 py-0.5"
                  title={`${blockedByCount} dependenc${blockedByCount === 1 ? "y" : "ies"}`}
                >
                  <ArrowUpFilled className="h-2 w-2 text-foreground/35" />
                  <span>{blockedByCount}</span>
                </span>
              )}
              {!op && blocksCount > 0 && (
                <span
                  className="inline-flex items-center gap-0.5 rounded-full bg-foreground/5 px-1.5 py-0.5"
                  title={`Unlocks ${blocksCount} task${blocksCount > 1 ? "s" : ""}`}
                >
                  <ArrowDownFilled className="h-2 w-2 text-amber-400/60" />
                  <span className="text-amber-400/70">{blocksCount}</span>
                </span>
              )}
              {autoRun.enabled && !task.completed && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5",
                    autoRunPaused
                      ? "bg-red-500/15 text-red-300"
                      : autoRunRetries > 0
                        ? "bg-amber-500/15 text-amber-300"
                        : "bg-emerald-500/10 text-emerald-300",
                  )}
                  title={
                    autoRunPaused
                      ? `Auto-run paused after ${autoRunRetries}/${MAX_AUTO_RUN_RETRIES} failed attempts`
                      : autoRunRetries > 0
                        ? `Auto-run has ${autoRunRetries}/${MAX_AUTO_RUN_RETRIES} failed attempts`
                        : "Auto-run enabled"
                  }
                >
                  {autoRunPaused
                    ? `Auto paused ${autoRunRetries}/${MAX_AUTO_RUN_RETRIES}`
                    : autoRunRetries > 0
                      ? `Auto ${autoRunRetries}/${MAX_AUTO_RUN_RETRIES}`
                      : "Auto"}
                </span>
              )}
              {hasRecentRun && task.chainBinding?.last_run_id && (
                <a
                  href={`/runs?runId=${task.chainBinding.last_run_id}`}
                  className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-sky-500/10 px-2 py-0.5 text-sky-300 hover:bg-sky-500/15"
                  onClick={(event) => event.stopPropagation()}
                  title={task.chainBinding.last_run_id}
                >
                  <PlayFilled className="h-2.5 w-2.5" />
                  view run
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
        )}
      </div>
    </WorkflowSidebarItem>
  );
}
