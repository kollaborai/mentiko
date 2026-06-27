"use client";

import { useState, useEffect, useCallback } from "react";
import { Link2Filled as Link2, PlayFilled as Play, CloseCircleFilled as X, ToggleOffFilled as ToggleLeft, ToggleOnFilled as ToggleRight, ExportFilled as ExternalLink, RefreshFilled as Refresh } from "@aliimam/icons";
import { Button } from "@/components/ui/button";
import { ChainAssignWorkflow } from "./chain-assign-workflow";
import { ChainDetailPanelById } from "@/components/chain/chain-detail-panel";
import { WaveSpinner } from "@/components/ui/wave-spinner";
import { useJobStatus } from "@/hooks/use-job-status";
import type { Task } from "@/lib/tasks/task-types";

interface TaskChainSectionProps {
  task: Task;
  onAssignChain: (chainId: string, chainName: string) => Promise<void>;
  onRemoveChain: () => Promise<void>;
  onRunChain: () => Promise<void>;
  onToggleAutoRun: (autoRun: boolean) => Promise<void>;
  onResetAutoRunAttempts?: () => Promise<void>;
  onMetadataUpdate?: (metadata: Record<string, unknown>) => void;
  onClearMetadata?: () => void;
  workspacePath?: string;
}

function ProvenanceRunLink({
  label,
  runId,
}: {
  label: string;
  runId?: string;
}) {
  if (!runId) return null;

  return (
    <a
      href={`/runs?runId=${encodeURIComponent(runId)}`}
      className="inline-flex items-center gap-1 text-[10px] text-foreground/35 hover:text-cyan-400 transition-colors"
    >
      <span>{label}</span>
      <span className="font-mono">{runId}</span>
      <ExternalLink className="h-2.5 w-2.5" />
    </a>
  );
}

function TaskChainProvenanceLinks({ task }: { task: Task }) {
  const binding = task.chainBinding;
  if (!binding?.recommendation_run_id && !binding?.generated_chain_run_id) return null;

  return (
    <div className="flex flex-col gap-1 py-1">
      <ProvenanceRunLink
        label="analysis run"
        runId={binding.recommendation_run_id}
      />
      <ProvenanceRunLink
        label="chain generation run"
        runId={binding.generated_chain_run_id}
      />
    </div>
  );
}

export function TaskChainSection({
  task,
  onAssignChain,
  onRemoveChain,
  onRunChain,
  onToggleAutoRun,
  onResetAutoRunAttempts,
  onMetadataUpdate,
  onClearMetadata,
  workspacePath,
}: TaskChainSectionProps) {
  const [showWorkflow, setShowWorkflow] = useState(false);
  const [startingRun, setStartingRun] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [resettingAttempts, setResettingAttempts] = useState(false);

  const binding = task.chainBinding;
  const autoRunRetries = binding?.auto_run_retries || 0;
  const autoRunPaused = !!binding?.auto_run && autoRunRetries >= 3 && !task.completed;
  const isRunRunning = binding?.last_run_status === "running";

  // track generation job status for real-time updates
  // skip polling for terminal states to avoid request spam on remount
  const genStatus = binding?.generation_status;
  const generationJobId = genStatus === "complete" || genStatus === "failed"
    ? null
    : binding?.generation_job_id || null;
  const { job: generationJob } = useJobStatus(generationJobId);

  const handleRun = useCallback(async () => {
    if (startingRun) return;
    setStartingRun(true);
    setRunError(null);

    try {
      await onRunChain();
      // success - parent will update task with run info
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Failed to start chain");
    } finally {
      // small delay to show starting state
      setTimeout(() => setStartingRun(false), 1000);
    }
  }, [onRunChain, startingRun]);

  const handleResetAutoRunAttempts = useCallback(async () => {
    if (!onResetAutoRunAttempts || resettingAttempts) return;
    setResettingAttempts(true);
    setRunError(null);
    try {
      await onResetAutoRunAttempts();
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Failed to reset auto-run attempts");
    } finally {
      setResettingAttempts(false);
    }
  }, [onResetAutoRunAttempts, resettingAttempts]);

  // reset workflow state when task changes
  useEffect(() => {
    queueMicrotask(() => {
      setShowWorkflow(false);

      // auto-show workflow if there's an active analysis job
      if (binding?.analysis_job_id && binding.analysis_status === "running") {
        setShowWorkflow(true);
      } else if (binding?.analysis_job_id && binding.analysis_status === "complete") {
        // also auto-show if analysis completed but no chain assigned yet
        setShowWorkflow(true);
      } else if (binding?.generation_job_id && binding.generation_status === "running") {
        setShowWorkflow(true);
      } else if (binding?.generation_job_id && binding.generation_status === "complete") {
        setShowWorkflow(true);
      }
    });
  }, [task.id, binding?.analysis_job_id, binding?.analysis_status, binding?.generation_job_id, binding?.generation_status]);

  if (!binding?.chain_id) {
    return (
      <div className="px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-foreground/40 font-medium">
            Chain
          </span>
        </div>
        {showWorkflow ? (
          <ChainAssignWorkflow
            key={task.id}
            task={task}
            onAssignChain={async (chainId, chainName) => {
              await onAssignChain(chainId, chainName);
              setShowWorkflow(false);
            }}
            onCancel={() => setShowWorkflow(false)}
            onMetadataUpdate={onMetadataUpdate}
            onClearMetadata={onClearMetadata}
            workspacePath={workspacePath}
          />
        ) : (
          <div className="space-y-2">
            <TaskChainProvenanceLinks task={task} />
            <button
              onClick={() => setShowWorkflow(true)}
              disabled={!!generationJobId}
              className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-muted hover:bg-accent transition-colors text-xs text-foreground/50 w-full disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="assign-chain-btn"
            >
              <Link2 className="h-3.5 w-3.5" />
              {generationJobId ? "Chain Generation in Progress..." : "Assign Chain"}
            </button>

            {/* generation status indicator */}
            {generationJobId && (
              <div className="rounded-md bg-card p-2.5 space-y-1.5">
                {generationJob?.status === "running" || generationJob?.status === "pending" ? (
                  <div className="flex items-center gap-2">
                    <WaveSpinner
                      color="cyan"
                      pattern="line"
                      animation="horizontal"
                      size="xs"
                      className="shrink-0"
                    />
                    <span className="text-xs text-foreground/60">
                      {generationJob?.status === "pending" ? "Queued for generation..." : "Generating chain..."}
                    </span>
                  </div>
                ) : generationJob?.status === "complete" && generationJob?.result ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-[10px] text-green-400">
                      <span className="text-[10px]">✓</span>
                      <span>Chain generated successfully!</span>
                    </div>
                    <button
                      onClick={() => setShowWorkflow(true)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-cyan-500/15 text-cyan-400 text-[10px] font-medium hover:bg-cyan-500/25 transition-colors w-full"
                    >
                      <Link2 className="h-3 w-3" />
                      View & Assign Generated Chain
                    </button>
                  </div>
                ) : generationJob?.status === "failed" ? (
                  <div className="space-y-1.5">
                    <div className="text-[10px] text-red-400">
                      {generationJob?.error || "Generation failed"}
                    </div>
                    <button
                      onClick={() => setShowWorkflow(true)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-cyan-500/15 text-cyan-400 text-[10px] font-medium hover:bg-cyan-500/25 transition-colors w-full"
                    >
                      <Refresh className="h-3 w-3" />
                      Retry Generation
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <WaveSpinner
                      color="cyan"
                      pattern="line"
                      animation="horizontal"
                      size="xs"
                      className="shrink-0"
                    />
                    <span className="text-xs text-foreground/60">
                      Checking generation status...
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // chain assigned view
  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-foreground/40 font-medium">
          Chain
        </span>
        <div className="flex items-center gap-2">
          <a
            href={`/runs?task=${encodeURIComponent(task.id)}`}
            className="text-[10px] text-foreground/30 hover:text-cyan-400 flex items-center gap-0.5 transition-colors"
          >
            all runs
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
          <button
            onClick={onRemoveChain}
            className="text-[10px] text-foreground/30 hover:text-red-400 transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>

      <ChainDetailPanelById
        chainId={binding.chain_id}
        fallbackName={binding.chain_name}
        compact
      />

      <div className="mt-2 space-y-2">
        <div className="rounded-md bg-muted px-3 py-2">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-medium uppercase tracking-wide text-foreground/45">
              task execution
            </span>
            <button
              onClick={() => onToggleAutoRun(!binding.auto_run)}
              className="flex items-center gap-1 text-[10px] text-foreground/35 hover:text-foreground/60"
            >
              {binding.auto_run ? (
                <ToggleRight className="h-3.5 w-3.5 text-foreground/45" />
              ) : (
                <ToggleLeft className="h-3.5 w-3.5" />
              )}
              {binding.auto_run ? "auto-run on" : "manual run"}
            </button>
          </div>

          <div className="flex items-center gap-2">
            {!task.completed && isRunRunning && binding.last_run_id ? (
              <a
                href={`/runs?runId=${binding.last_run_id}`}
                className="inline-flex h-7 items-center justify-center rounded-md bg-card px-3 text-xs font-medium text-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
              >
                <ExternalLink className="h-3 w-3 mr-1" />
                View run
              </a>
            ) : !task.completed ? (
              <Button
                size="sm"
                variant="default"
                className="h-7 text-xs"
                onClick={handleRun}
                disabled={startingRun}
                data-testid="run-chain-btn"
              >
                <Play className="h-3 w-3 mr-1" />
                {startingRun ? "Starting..." : "Run chain"}
              </Button>
            ) : null}
          </div>
        </div>

        <TaskChainProvenanceLinks task={task} />

        {binding.last_run_id && (
          <div className="flex items-center gap-2 rounded-sm bg-muted px-2 py-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${
              isRunRunning
                ? "bg-cyan-400 animate-pulse"
                : binding.last_run_status === "complete"
                  ? "bg-green-400"
                  : binding.last_run_status === "failed"
                    ? "bg-red-400"
                    : "bg-foreground/30"
            }`} />
            <span className="text-[10px] text-foreground/45">
              {isRunRunning ? "current run" : "last run"}
            </span>
            <a
              href={`/runs?runId=${binding.last_run_id}`}
              className="min-w-0 flex items-center gap-1 text-[10px] font-mono text-foreground/60 hover:text-cyan-400 transition-colors"
            >
              <span className="truncate">{binding.last_run_id}</span>
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
            <span className={`ml-auto text-[10px] ${
              isRunRunning
                ? "text-cyan-400"
                : binding.last_run_status === "complete"
                  ? "text-green-400"
                  : binding.last_run_status === "failed"
                    ? "text-red-400"
                    : "text-foreground/35"
            }`}>
              {binding.last_run_status || "unknown"}
            </span>
          </div>
        )}

        {startingRun && (
          <div className="flex items-center gap-2 text-[10px] text-cyan-400">
            <div className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
            <span>Starting...</span>
          </div>
        )}
        {runError && (
          <div className="text-[10px] text-red-400">
            {runError}
          </div>
        )}

        {binding.auto_run && autoRunRetries > 0 && !task.completed && (
          <div
            className={`rounded-md px-3 py-2 text-[10px] ${
              autoRunPaused
                ? "bg-red-500/10 text-red-200"
                : "bg-amber-500/10 text-amber-200"
            }`}
            data-testid="auto-run-attempt-warning"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="font-semibold">
                  {autoRunPaused ? "Auto-run paused" : "Auto-run had a failed attempt"}
                </div>
                <div className={autoRunPaused ? "text-red-200/75" : "text-amber-200/75"}>
                  {autoRunRetries}/3 attempts used
                  {binding.last_run_status ? ` · last status: ${binding.last_run_status}` : ""}
                </div>
                {binding.last_run_error && (
                  <div className="line-clamp-2 text-red-200/70">
                    {binding.last_run_error}
                  </div>
                )}
              </div>
              {onResetAutoRunAttempts && (
                <button
                  onClick={handleResetAutoRunAttempts}
                  disabled={resettingAttempts}
                  className={`shrink-0 rounded-sm px-2 py-1 font-medium transition-colors disabled:opacity-50 ${
                    autoRunPaused
                      ? "bg-red-500/15 text-red-100 hover:bg-red-500/25"
                      : "bg-amber-500/15 text-amber-100 hover:bg-amber-500/25"
                  }`}
                >
                  {resettingAttempts ? "Resetting..." : "Reset attempts"}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
