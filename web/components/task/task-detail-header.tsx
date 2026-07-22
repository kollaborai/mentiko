"use client";

import {
  CloseCircleFilled as X,
  RotateLeftFilled as RotateCcw,
  UserFilled as User,
  CopyFilled as Copy,
  TickCircleFilled as Check,
  CalendarFilled as Calendar,
  TagFilled as Tag,
  ClockFilled as Clock,
  EditFilled as Pencil,
  Link2Filled as Link2,
  JudgeFilled as DecisionIcon,
  ToggleOffFilled as ToggleLeft,
  ToggleOnFilled as ToggleRight,
  InfoCircleFilled as AlertCircle,
} from "@aliimam/icons";
import { PlayFilled, LinkFilled, PauseFilled as Pause } from "@aliimam/icons";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SplitDetailHeader } from "@/components/ui/detail-header";
import { BackButton } from "@/components/ui/back-button";
import { copyToClipboard } from "@/lib/ui/copy-to-clipboard";
import { PriorityBadge } from "./priority-badge";
import { TypeBadge } from "./type-badge";
import { timeAgo } from "@/lib/tasks/task-transforms";
import { MAX_AUTO_RUN_RETRIES, resolveAutoRunState } from "@/lib/tasks/auto-run-state";
import type { Task } from "@/lib/tasks/task-types";
import { cn } from "@/lib/utils";

interface TaskDetailHeaderProps {
  task: Task;
  onBack: () => void;
  onClose: () => void;
  onReopen: () => void;
  onRunChain: () => void;
  onEdit: () => void;
  onToggleAutoRun?: (autoRun: boolean) => Promise<void>;
  onResetAutoRunAttempts?: () => Promise<void>;
  onToggleAutoRunPause?: (paused: boolean) => Promise<void>;
  onSelectParent?: (parentId: string) => void;
  isRunning: boolean;
}

export function TaskDetailHeader({
  task,
  onBack,
  onClose,
  onReopen,
  onRunChain,
  onEdit,
  onToggleAutoRun,
  onResetAutoRunAttempts,
  onToggleAutoRunPause,
  onSelectParent,
  isRunning,
}: TaskDetailHeaderProps) {
  const [copied, setCopied] = useState(false);
  const [autoRunPending, setAutoRunPending] = useState(false);
  const [autoRunResetting, setAutoRunResetting] = useState(false);
  const [autoRunPausePending, setAutoRunPausePending] = useState(false);
  const [autoRunError, setAutoRunError] = useState<string | null>(null);

  const assignedChainId = task.chainBinding?.chain_id || "";
  const hasAssignedChain = assignedChainId.length > 0;
  // Single source of truth (lib/tasks/auto-run-state.ts): resolved server-side from
  // the explicit per-task flag AND the workspace default, so the header can never
  // disagree with the admission gate about whether this task auto-runs.
  // Prefer the server-resolved state (includes the workspace default); fall back
  // to resolving from the raw chainBinding fields via the SAME resolver when the
  // DTO wasn't enriched (test fixtures / un-enriched client transforms).
  const autoRun = task.autoRun ?? resolveAutoRunState({
    explicitAutoRun: typeof task.chainBinding?.auto_run === "boolean" ? task.chainBinding.auto_run : undefined,
    retries: task.chainBinding?.auto_run_retries,
    userPaused: task.chainBinding?.auto_run_paused,
    pausedReason: task.chainBinding?.auto_run_paused_reason,
    completed: task.completed,
  });
  const autoRunEnabled = autoRun.enabled;
  const autoRunRetries = autoRun.retries;
  const autoRunPaused = autoRun.retriesExhausted;
  const autoRunUserPauseReason = autoRun.pausedReason;
  const autoRunUserPaused = autoRun.userPaused;
  const autoRunFromWorkspace = autoRun.source === "workspace";
  const generationFailure = !hasAssignedChain && Boolean(
    task.chainBinding?.generation_status
    || task.chainBinding?.generation_job_id
    || task.chainBinding?.generated_chain_run_id
    || task.metadata?.generation_last_error
    || task.metadata?.generation_error
  );
  const reportedFailure = [
    task.metadata?.generation_last_error,
    task.metadata?.generation_error,
    task.chainBinding?.last_run_blocked_reason,
    task.chainBinding?.last_run_error,
  ].find((value): value is string => typeof value === "string" && value.trim().length > 0);
  const failureReason = reportedFailure || (generationFailure
      ? "The generation run completed, but Mentiko could not import a valid runnable chain from its result."
      : "Mentiko could not complete this task automatically.");
  const failureRunId = generationFailure
    ? task.chainBinding?.generated_chain_run_id
    : task.chainBinding?.last_run_id;
  const autoRunRecovering = !autoRunPaused
    && autoRunEnabled
    && autoRunRetries > 0
    && Boolean(reportedFailure);
  const showAutoRunFailure = autoRunPaused || autoRunRecovering;

  function copyId() {
    copyToClipboard(task.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function toggleAutoRun() {
    if (!onToggleAutoRun || autoRunPending || task.completed) return;
    setAutoRunPending(true);
    setAutoRunError(null);
    try {
      await onToggleAutoRun(!autoRunEnabled);
    } catch (err) {
      setAutoRunError(err instanceof Error ? err.message : "failed to update auto-run");
    } finally {
      setAutoRunPending(false);
    }
  }

  async function resetAutoRunAttempts() {
    if (!onResetAutoRunAttempts || autoRunResetting) return;
    setAutoRunResetting(true);
    setAutoRunError(null);
    try {
      await onResetAutoRunAttempts();
    } catch (err) {
      setAutoRunError(err instanceof Error ? err.message : "failed to reset attempts");
    } finally {
      setAutoRunResetting(false);
    }
  }

  async function toggleAutoRunUserPause() {
    if (!onToggleAutoRunPause || autoRunPausePending || task.completed) return;
    setAutoRunPausePending(true);
    setAutoRunError(null);
    try {
      await onToggleAutoRunPause(!autoRunUserPaused);
    } catch (err) {
      setAutoRunError(err instanceof Error ? err.message : "failed to update pause state");
    } finally {
      setAutoRunPausePending(false);
    }
  }

  return (
    <div className="px-3 pt-2 shrink-0">
      <BackButton onBack={onBack} />

      {/* task id */}
      <button
        onClick={copyId}
        className="flex items-center gap-1 text-[10px] font-mono text-foreground/30 hover:text-foreground/50 transition-colors mb-1"
      >
        {copied ? (
          <Check className="h-2.5 w-2.5 text-green-400" />
        ) : (
          <Copy className="h-2.5 w-2.5" />
        )}
        {task.id}
      </button>

      {/* title row */}
      <SplitDetailHeader
        className="items-start"
        identityClassName="items-start"
        identity={
          <div className="relative min-w-0 flex-1">
            <h2 className="text-base font-bold tracking-tighter leading-tight">
              {task.title}
            </h2>
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <TypeBadge type={task.type} />
              <PriorityBadge
                priority={task.priority}
                rawPriority={task.rawPriority}
              />
              {hasAssignedChain && (
                <Link
                  href={`/chains/${encodeURIComponent(assignedChainId)}/edit`}
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono bg-accent text-foreground/70 hover:bg-accent/80 transition-colors"
                >
                  <LinkFilled className="h-2.5 w-2.5" style={{ color: "#b07ee8" }} />
                  {task.chainBinding?.chain_name || assignedChainId}
                </Link>
              )}
              {task.type === "decision" && typeof task.metadata?.decision_id === "string" && (
                <a
                  href={`/tasks?type=decision&task=${encodeURIComponent(task.id)}`}
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono bg-violet-500/15 text-violet-300 hover:bg-violet-500/25 transition-colors"
                >
                  <Link2 className="h-2.5 w-2.5" />
                  decision
                </a>
              )}
              <span
                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono ${
                  task.completed
                    ? "bg-green-500/15 text-green-400"
                    : "bg-foreground/5 text-foreground/50"
                }`}
              >
                {task.completed ? "closed" : "open"}
              </span>
              {task.assignee && (
                <span className="inline-flex items-center gap-0.5 text-[10px] text-foreground/40">
                  <User className="h-2.5 w-2.5" />
                  {task.assignee}
                </span>
              )}
              <span className="text-[10px] text-foreground/30 ml-auto">
                {timeAgo(task.updatedAt)}
              </span>
            </div>
          </div>
        }
        actions={
          <>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs max-[420px]:w-full"
            onClick={onEdit}
          >
            <Pencil className="h-3 w-3 mr-1" />
            Edit
          </Button>
          {task.type !== "decision" && !task.metadata?.decision_id && (
            <Link
              href="/tasks?type=decision"
              className="inline-flex items-center justify-center gap-1 h-7 px-2 rounded-md text-xs font-medium text-foreground/60 hover:text-foreground hover:bg-accent transition-colors max-[420px]:w-full"
              title="Send to decision flow"
            >
              <DecisionIcon className="h-3 w-3" />
              Decision
            </Link>
          )}
          {hasAssignedChain && !task.completed && (
            <Button
              size="sm"
              variant="default"
              className="h-7 text-xs max-[420px]:w-full"
              onClick={onRunChain}
              disabled={isRunning}
            >
              <PlayFilled className="h-3 w-3 mr-1" />
              Run
            </Button>
          )}
          {onToggleAutoRun && (
            task.completed ? (
              autoRunEnabled ? (
                <span className="inline-flex h-7 items-center gap-1 rounded-md bg-muted px-2 text-[10px] font-mono text-foreground/45 max-[420px]:w-full max-[420px]:justify-center">
                  <ToggleRight className="h-3.5 w-3.5 text-foreground/45" />
                  auto-run on
                </span>
              ) : null
            ) : (
              <div className="flex flex-wrap items-center gap-1 max-[420px]:w-full">
                <button
                  type="button"
                  role="switch"
                  aria-label="auto-run"
                  aria-checked={autoRunEnabled}
                  onClick={toggleAutoRun}
                  disabled={autoRunPending}
                  className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10px] font-mono transition-colors disabled:opacity-50 max-[420px]:flex-1 max-[420px]:justify-center ${
                    autoRunEnabled
                      ? "bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15"
                      : "bg-muted text-foreground/45 hover:bg-accent hover:text-foreground/65"
                  }`}
                >
                  {autoRunEnabled ? (
                    <ToggleRight className="h-3.5 w-3.5" />
                  ) : (
                    <ToggleLeft className="h-3.5 w-3.5" />
                  )}
                  {autoRunEnabled ? (autoRunFromWorkspace ? "auto-run on · workspace" : "auto-run on") : "auto-run off"}
                </button>
                {autoRunEnabled && onToggleAutoRunPause ? (
                  <>
                    <button
                      type="button"
                      role="switch"
                      aria-label="pause auto-run"
                      aria-checked={autoRunUserPaused}
                      onClick={toggleAutoRunUserPause}
                      disabled={autoRunPausePending}
                      className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10px] font-mono transition-colors disabled:opacity-50 max-[420px]:flex-1 max-[420px]:justify-center ${
                        autoRunUserPaused
                          ? "bg-zinc-500/15 text-zinc-300 hover:bg-zinc-500/25"
                          : "bg-muted text-foreground/45 hover:bg-accent hover:text-foreground/65"
                      }`}
                    >
                      {autoRunUserPaused ? (
                        <PlayFilled className="h-3.5 w-3.5" />
                      ) : (
                        <Pause className="h-3.5 w-3.5" />
                      )}
                      {autoRunPausePending ? "..." : autoRunUserPaused ? "resume" : "pause"}
                    </button>
                    {autoRunUserPaused ? (
                      <span
                        className="inline-flex h-7 max-w-[220px] items-center gap-1 rounded-md bg-zinc-500/15 px-2 text-[10px] font-mono text-zinc-300"
                        title={autoRunUserPauseReason || "paused by user"}
                      >
                        <Pause className="h-3 w-3 shrink-0" />
                        <span className="truncate">
                          {autoRunUserPauseReason || "paused by user"}
                        </span>
                      </span>
                    ) : null}
                  </>
                ) : null}
              </div>
            )
          )}
          {task.completed ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs max-[420px]:w-full"
              onClick={onReopen}
            >
              <RotateCcw className="h-3 w-3 mr-1" />
              Reopen
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs max-[420px]:w-full"
              onClick={onClose}
            >
              <X className="h-3 w-3 mr-1" />
              Close
            </Button>
          )}
          {autoRunError ? (
            <span className="w-full text-[10px] text-red-300 xl:text-right">
              {autoRunError}
            </span>
          ) : null}
          </>
        }
      />

      {showAutoRunFailure ? (
        <div
          role="alert"
          className={cn(
            "mt-3 flex flex-col gap-3 rounded-md px-3 py-3 sm:flex-row sm:items-start sm:justify-between",
            autoRunRecovering ? "bg-amber-500/10" : "bg-red-500/10",
          )}
          data-testid="auto-run-failure-banner"
        >
          <div className="flex min-w-0 gap-2.5">
            <AlertCircle className={cn(
              "mt-0.5 h-4 w-4 shrink-0",
              autoRunRecovering ? "text-amber-300" : "text-red-300",
            )} />
            <div className="min-w-0">
              <p className={cn(
                "text-xs font-semibold",
                autoRunRecovering ? "text-amber-200" : "text-red-200",
              )}>
                {autoRunRecovering
                  ? generationFailure
                    ? "Chain generation failed; retrying"
                    : "Auto-run failed; retrying"
                  : generationFailure
                    ? "Chain generation failed"
                    : "Auto-run failed"}
              </p>
              <p className="mt-1 break-words text-[11px] leading-relaxed text-foreground/65 [overflow-wrap:anywhere]">
                {failureReason}
              </p>
              <p className={cn(
                "mt-1.5 text-[10px] font-mono",
                autoRunRecovering ? "text-amber-200/70" : "text-red-200/70",
              )}>
                {autoRunRecovering
                  ? `Auto-recovery is active after ${autoRunRetries}/${MAX_AUTO_RUN_RETRIES} failed attempts`
                  : `Auto-recovery stopped after ${autoRunRetries}/${MAX_AUTO_RUN_RETRIES} failed attempts`}
                {task.dependentCount > 0
                  ? ` · blocking ${task.dependentCount} dependent task${task.dependentCount === 1 ? "" : "s"}`
                  : ""}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {failureRunId ? (
              <Link
                href={`/runs?runId=${encodeURIComponent(failureRunId)}`}
                className="inline-flex h-8 items-center justify-center rounded-md bg-secondary px-3 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
              >
                Open failed run
              </Link>
            ) : null}
            {!autoRunRecovering && onResetAutoRunAttempts ? (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                className="h-8 px-3 text-xs"
                onClick={resetAutoRunAttempts}
                disabled={autoRunResetting}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {autoRunResetting
                  ? "Retrying..."
                  : generationFailure
                    ? "Retry chain generation"
                    : "Retry task"}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* metadata grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-3 px-3 py-2.5 bg-muted rounded-md text-[10px]">
        <div className="flex items-center gap-1.5">
          <span className="text-foreground/30">owner</span>
          <span className="text-foreground/60 font-medium">
            {task.owner || "—"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-foreground/30">assignee</span>
          <span className="text-foreground/60 font-medium flex items-center gap-0.5">
            {task.assignee ? (
              <>
                <User className="h-2.5 w-2.5" />
                {task.assignee}
              </>
            ) : (
              "—"
            )}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-foreground/30">created by</span>
          <span className="text-foreground/60 font-medium">
            {task.createdBy || "—"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-foreground/30">created</span>
          <span className="text-foreground/60 font-medium">
            {task.createdAt
              ? new Date(task.createdAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })
              : "—"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-foreground/30">updated</span>
          <span className="text-foreground/60 font-medium">
            {timeAgo(task.updatedAt)}
          </span>
        </div>
        {task.completed && task.closedAt && (
          <div className="flex items-center gap-1.5">
            <span className="text-foreground/30">closed</span>
            <span className="text-foreground/60 font-medium">
              {new Date(task.closedAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          </div>
        )}
        {task.parentId && (
          <div className="flex items-center gap-1.5 col-span-2">
            <span className="text-foreground/30">parent</span>
            <button
              onClick={() => onSelectParent?.(task.parentId!)}
              className="text-foreground/60 font-mono font-medium hover:text-foreground/90 transition-colors cursor-pointer"
            >
              {task.parentId}
            </button>
          </div>
        )}
        {task.dueDate && (
          <div className="flex items-center gap-1.5 col-span-2">
            <Calendar className="h-2.5 w-2.5 text-foreground/30" />
            <span className="text-foreground/30">due</span>
            <span className="text-foreground/60 font-medium">
              {new Date(task.dueDate).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          </div>
        )}
        {task.labels && task.labels.length > 0 && (
          <div className="flex items-center gap-1.5 col-span-2">
            <Tag className="h-2.5 w-2.5 text-foreground/30" />
            <div className="flex items-center gap-1 flex-wrap">
              {task.labels.map((label) => (
                <span
                  key={label}
                  className="px-1 py-0.5 rounded bg-foreground/5 text-foreground/50 font-mono"
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        )}
        {hasAssignedChain && (
          <div className="flex items-center gap-1.5 col-span-2">
            <Link2 className="h-2.5 w-2.5 text-foreground/30" />
            <span className="text-foreground/30">chain</span>
            <span className="text-foreground/60 font-medium">
              {task.chainBinding?.chain_name || assignedChainId}
            </span>
          </div>
        )}

        {/* stats row */}
        <div className="flex items-center gap-4 col-span-2 pt-1 mt-1">
          <span className="text-foreground/30">
            <span className="text-foreground/60 font-medium">
              {task.dependencyCount}
            </span>{" "}
            blocking
          </span>
          <span className="text-foreground/30">
            <span className="text-foreground/60 font-medium">
              {task.dependentCount}
            </span>{" "}
            dependents
          </span>
          <span className="text-foreground/30">
            <span className="text-foreground/60 font-medium">
              {task.commentCount}
            </span>{" "}
            comments
          </span>
          {task.estimate && (
            <span className="text-foreground/30">
              <Clock className="h-2.5 w-2.5 inline mr-0.5" />
              <span className="text-foreground/60 font-medium">
                {task.estimate}
              </span>{" "}
              min
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
