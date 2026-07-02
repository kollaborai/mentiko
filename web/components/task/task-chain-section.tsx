"use client";

import { useState, useEffect } from "react";
import { Link2Filled as Link2, CloseCircleFilled as X, ExportFilled as ExternalLink, RefreshFilled as Refresh } from "@aliimam/icons";
import { ChainAssignWorkflow } from "./chain-assign-workflow";
import { ChainDetailPanelById } from "@/components/chain/chain-detail-panel";
import { WaveSpinner } from "@/components/ui/wave-spinner";
import { useJobStatus } from "@/hooks/use-job-status";
import type { Task } from "@/lib/tasks/task-types";

interface TaskChainSectionProps {
  task: Task;
  onAssignChain: (chainId: string, chainName: string) => Promise<void>;
  onRemoveChain: () => Promise<void>;
  onMetadataUpdate?: (metadata: Record<string, unknown>) => void;
  onClearMetadata?: () => void;
  workspacePath?: string;
}

export function TaskChainSection({
  task,
  onAssignChain,
  onRemoveChain,
  onMetadataUpdate,
  onClearMetadata,
  workspacePath,
}: TaskChainSectionProps) {
  const [showWorkflow, setShowWorkflow] = useState(false);

  const binding = task.chainBinding;

  // track generation job status for real-time updates
  // skip polling for terminal states to avoid request spam on remount
  const genStatus = binding?.generation_status;
  const generationJobId = genStatus === "complete" || genStatus === "failed"
    ? null
    : binding?.generation_job_id || null;
  const { job: generationJob } = useJobStatus(generationJobId);

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
    </div>
  );
}
