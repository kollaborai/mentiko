"use client";

import { useState } from "react";
import { ArrowDown1Filled, ArrowRight1Filled, JudgeFilled, ToggleOffFilled as ToggleLeft, ToggleOnFilled as ToggleRight } from "@aliimam/icons";
import { TaskDetailHeader } from "./task-detail-header";
import { TaskChainSection } from "./task-chain-section";
import { TaskChildren } from "./task-children";
import { TaskComments } from "./task-comments";
import { TaskActivity } from "./task-activity";
import { TaskDepsGraph } from "./task-deps-graph";
import { TaskRunStoryPanels } from "./task-run-story-panels";
import { TaskAttemptsPanel } from "./task-attempts-panel";
import { DecisionDetail } from "@/components/decision/decision-detail";
import { filterVisibleTasks } from "@/lib/tasks/task-visibility";
import type { Task, TaskComment } from "@/lib/tasks/task-types";
import { Markdown } from "@/components/ui/markdown";

interface TaskDetailProps {
  task: Task;
  subtasks: Task[];
  comments: TaskComment[];
  onBack: () => void;
  onClose: () => void;
  onReopen: () => void;
  onEdit: () => void;
  onSelectChild: (task: Task) => void;
  onSelectDep: (taskId: string) => void;
  onAssignChain: (chainId: string, chainName: string) => Promise<void>;
  onRemoveChain: () => Promise<void>;
  onRunChain: () => Promise<void>;
  onToggleAutoRun: (autoRun: boolean) => Promise<void>;
  onResetAutoRunAttempts?: () => Promise<void>;
  onToggleAutoRunPause?: (paused: boolean) => Promise<void>;
  onToggleEpicAutoRun?: (autoRun: boolean) => Promise<void>;
  onMetadataUpdate?: (metadata: Record<string, unknown>) => void;
  onClearMetadata?: () => void;
  onRefreshTask?: () => Promise<void>;
  onDecisionUpdate?: () => Promise<void> | void;
  onOpenTask?: (taskId: string) => void;
  onAddComment: (text: string) => Promise<void>;
  isRunning: boolean;
  workspacePath?: string;
  allTasks?: Task[];
  onAddDep?: (depTaskId: string) => Promise<void>;
  depInfo?: Map<string, { blockedBy: string[]; blocks: string[] }>;
}

function CollapsibleSection({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="px-4 py-3">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs text-foreground/40 font-medium hover:text-foreground/60"
      >
        {open ? (
          <ArrowDown1Filled className="h-3 w-3" />
        ) : (
          <ArrowRight1Filled className="h-3 w-3" />
        )}
        {title}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

export function TaskDetail({
  task,
  subtasks,
  comments,
  onBack,
  onClose,
  onReopen,
  onEdit,
  onSelectChild,
  onSelectDep,
  onAssignChain,
  onRemoveChain,
  onRunChain,
  onToggleAutoRun,
  onResetAutoRunAttempts,
  onToggleAutoRunPause,
  onToggleEpicAutoRun,
  onMetadataUpdate,
  onClearMetadata,
  onRefreshTask,
  onDecisionUpdate,
  onOpenTask,
  onAddComment,
  isRunning,
  workspacePath,
  allTasks = [],
  onAddDep,
  depInfo,
}: TaskDetailProps) {
  const decisionId = task.type === "decision" && typeof task.metadata?.decision_id === "string"
    ? task.metadata.decision_id
    : undefined;
  const eventArtifactChildIds = Array.isArray(task.metadata?.event_artifact_child_task_ids)
    ? task.metadata.event_artifact_child_task_ids.filter((id): id is string => typeof id === "string")
    : [];
  const eventArtifactRunId = typeof task.metadata?.event_artifact_run_id === "string"
    ? task.metadata.event_artifact_run_id
    : undefined;
  const auditVerdict = typeof task.metadata?.last_audit_verdict === "string"
    ? (task.metadata.last_audit_verdict as string)
    : undefined;
  const reopenedReason = typeof task.metadata?.reopened_reason === "string"
    ? (task.metadata.reopened_reason as string)
    : undefined;
  const decisionSubtaskId = typeof task.metadata?.decision_subtask_id === "string"
    ? (task.metadata.decision_subtask_id as string)
    : undefined;
  const visibleSubtasks = filterVisibleTasks([task, ...subtasks]).filter(
    (subtask) => subtask.id !== task.id,
  );

  if (decisionId) {
    return (
      <DecisionDetail
        decisionId={decisionId}
        workspacePath={workspacePath}
        onBack={onBack}
        onUpdate={onDecisionUpdate ?? onRefreshTask}
        onDelete={onDecisionUpdate ?? onRefreshTask}
        onOpenTask={onOpenTask ?? onSelectDep}
      />
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <TaskDetailHeader
        task={task}
        onBack={onBack}
        onClose={onClose}
        onReopen={onReopen}
        onRunChain={onRunChain}
        onEdit={onEdit}
        onToggleAutoRun={onToggleAutoRun}
        onResetAutoRunAttempts={onResetAutoRunAttempts}
        onToggleAutoRunPause={onToggleAutoRunPause}
        onSelectParent={onSelectDep}
        isRunning={isRunning}
      />

      {/* chain section */}
      <TaskChainSection
        task={task}
        onAssignChain={onAssignChain}
        onRemoveChain={onRemoveChain}
        onMetadataUpdate={onMetadataUpdate}
        onClearMetadata={onClearMetadata}
        workspacePath={workspacePath}
      />

      <TaskAttemptsPanel taskId={task.id} />

      <TaskRunStoryPanels task={task} onRefreshTask={onRefreshTask} />

      {auditVerdict && (
        <div className={`mx-4 my-3 rounded-md p-3 ${
          auditVerdict === "decision" ? "bg-blue-500/10" :
          auditVerdict === "close" ? "bg-green-500/10" :
          "bg-amber-500/10"
        }`}>
          <div className="flex items-center gap-1.5">
            <JudgeFilled className={`h-3.5 w-3.5 shrink-0 ${
              auditVerdict === "decision" ? "text-blue-400" :
              auditVerdict === "close" ? "text-green-400" :
              "text-amber-400"
            }`} />
            <p className={`text-xs font-medium ${
              auditVerdict === "decision" ? "text-blue-300" :
              auditVerdict === "close" ? "text-green-300" :
              "text-amber-300"
            }`}>
              completion audit · {auditVerdict}
            </p>
          </div>
          {reopenedReason && (
            <p className="mt-1 text-[11px] text-foreground/55">{reopenedReason}</p>
          )}
          {decisionSubtaskId && (
            <button
              onClick={() => (onOpenTask ?? onSelectDep)(decisionSubtaskId)}
              className="mt-2 rounded-sm bg-background/50 px-2 py-1 text-[10px] font-mono text-foreground/60 hover:text-foreground"
            >
              → view decision subtask
            </button>
          )}
        </div>
      )}

      {eventArtifactChildIds.length > 0 && (
        <div className="mx-4 my-3 rounded-md bg-amber-500/10 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-amber-300">quality gate follow-up</p>
              <p className="mt-1 text-[11px] text-foreground/55">
                created {eventArtifactChildIds.length} child task{eventArtifactChildIds.length === 1 ? "" : "s"}
                {eventArtifactRunId ? ` from ${eventArtifactRunId}` : ""}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {eventArtifactChildIds.map((id) => (
                  <button
                    key={id}
                    onClick={() => onSelectDep(id)}
                    className="rounded-sm bg-background/50 px-2 py-1 text-[10px] font-mono text-foreground/60 hover:text-foreground"
                  >
                    {id}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* description */}
      {task.description && (
        <div className="px-4 py-3">
          <span className="text-xs text-foreground/40 font-medium">
            Description
          </span>
          <div className="mt-1.5 text-sm text-foreground/70">
            <Markdown content={task.description} />
          </div>
        </div>
      )}

      {/* acceptance criteria */}
      {task.acceptance && (
        <CollapsibleSection title="Acceptance Criteria">
          <div className="text-xs text-foreground/60">
            <Markdown content={task.acceptance} />
          </div>
        </CollapsibleSection>
      )}

      {/* design notes */}
      {task.design && (
        <CollapsibleSection title="Design Notes" defaultOpen={false}>
          <div className="text-xs text-foreground/60">
            <Markdown content={task.design} />
          </div>
        </CollapsibleSection>
      )}

      {/* notes */}
      {task.notes && (
        <CollapsibleSection title="Notes" defaultOpen={false}>
          <div className="text-xs text-foreground/60">
            <Markdown content={task.notes} />
          </div>
        </CollapsibleSection>
      )}

      {/* epic auto-run toggle */}
      {task.type === "epic" && visibleSubtasks.length > 0 && onToggleEpicAutoRun && (
        <div className="px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-foreground/40 font-medium">
              Auto-run
            </span>
            <button
              onClick={() => onToggleEpicAutoRun(!task.chainBinding?.auto_run)}
              className="flex items-center gap-1.5 text-xs text-foreground/40 hover:text-foreground/60"
            >
              {task.chainBinding?.auto_run ? (
                <ToggleRight className="h-4 w-4 text-green-400" />
              ) : (
                <ToggleLeft className="h-4 w-4" />
              )}
              {task.chainBinding?.auto_run ? "on" : "off"}
            </button>
          </div>
          <p className="mt-1 text-[10px] text-foreground/25">
            runs each subtask in dependency order when unblocked
          </p>
        </div>
      )}

      {/* subtasks */}
      <TaskChildren items={visibleSubtasks} onSelectChild={onSelectChild} depInfo={depInfo} />

      {/* deps graph */}
      <TaskDepsGraph
        taskId={task.id}
        onSelectTask={onSelectDep}
        allTasks={allTasks}
        onAddDep={onAddDep}
        workspacePath={workspacePath}
      />

      {/* comments */}
      <TaskComments
        taskId={task.id}
        comments={comments}
        onAddComment={onAddComment}
      />

      {/* activity */}
      <TaskActivity taskId={task.id} />
    </div>
  );
}
