"use client";

import { useState } from "react";
import { ArrowDown1Filled, ArrowRight1Filled, ToggleOffFilled as ToggleLeft, ToggleOnFilled as ToggleRight } from "@aliimam/icons";
import { TaskDetailHeader } from "./task-detail-header";
import { TaskChainSection } from "./task-chain-section";
import { TaskChildren } from "./task-children";
import { TaskComments } from "./task-comments";
import { TaskActivity } from "./task-activity";
import { TaskDepsGraph } from "./task-deps-graph";
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
  onToggleEpicAutoRun?: (autoRun: boolean) => Promise<void>;
  onMetadataUpdate?: (metadata: Record<string, unknown>) => void;
  onClearMetadata?: () => void;
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
  onToggleEpicAutoRun,
  onMetadataUpdate,
  onClearMetadata,
  onAddComment,
  isRunning,
  workspacePath,
  allTasks = [],
  onAddDep,
  depInfo,
}: TaskDetailProps) {
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <TaskDetailHeader
        task={task}
        onBack={onBack}
        onClose={onClose}
        onReopen={onReopen}
        onRunChain={onRunChain}
        onEdit={onEdit}
        onSelectParent={onSelectDep}
        isRunning={isRunning}
      />

      {/* chain section */}
      <TaskChainSection
        task={task}
        onAssignChain={onAssignChain}
        onRemoveChain={onRemoveChain}
        onRunChain={onRunChain}
        onToggleAutoRun={onToggleAutoRun}
        onResetAutoRunAttempts={onResetAutoRunAttempts}
        onMetadataUpdate={onMetadataUpdate}
        onClearMetadata={onClearMetadata}
        workspacePath={workspacePath}
      />

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
      {task.type === "epic" && subtasks.length > 0 && onToggleEpicAutoRun && (
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
      <TaskChildren items={subtasks} onSelectChild={onSelectChild} depInfo={depInfo} />

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
