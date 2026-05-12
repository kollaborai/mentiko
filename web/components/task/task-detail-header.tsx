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
} from "@aliimam/icons";
import { ArrowLeftFilled, PlayFilled, LinkFilled } from "@aliimam/icons";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { DetailHeader } from "@/components/ui/detail-header";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { PriorityBadge } from "./priority-badge";
import { TypeBadge } from "./type-badge";
import { timeAgo } from "@/lib/task-transforms";
import type { Task } from "@/lib/task-types";

interface TaskDetailHeaderProps {
  task: Task;
  onBack: () => void;
  onClose: () => void;
  onReopen: () => void;
  onRunChain: () => void;
  onEdit: () => void;
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
  onSelectParent,
  isRunning,
}: TaskDetailHeaderProps) {
  const [copied, setCopied] = useState(false);

  function copyId() {
    copyToClipboard(task.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="px-3 pt-2 shrink-0">
      {/* mobile back button */}
      <button
        onClick={onBack}
        className="md:hidden flex items-center gap-1 text-xs text-foreground/40 mb-2 hover:text-foreground/60"
      >
        <ArrowLeftFilled className="h-3.5 w-3.5" />
        Back
      </button>

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
      <DetailHeader className="items-start gap-3">
        <div className="relative flex-1 min-w-0">
          <h2 className="text-base font-bold tracking-tighter leading-tight">
            {task.title}
          </h2>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <TypeBadge type={task.type} />
            <PriorityBadge
              priority={task.priority}
              rawPriority={task.rawPriority}
            />
            {task.chainBinding && (
              <Link
                href={`/chains/${encodeURIComponent(task.chainBinding.chain_id)}/edit`}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono bg-accent text-foreground/70 hover:bg-accent/80 transition-colors"
              >
                <LinkFilled className="h-2.5 w-2.5" style={{ color: "#b07ee8" }} />
                {task.chainBinding.chain_name || task.chainBinding.chain_id}
              </Link>
            )}
            {typeof task.metadata?.decision_id === "string" && (
              <a
                href={`/decisions?id=${encodeURIComponent(task.metadata.decision_id)}`}
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

        {/* actions */}
        <div className="relative flex items-center gap-1 shrink-0">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={onEdit}
          >
            <Pencil className="h-3 w-3 mr-1" />
            Edit
          </Button>
          {!task.metadata?.decision_id && (
            <Link
              href={`/decisions?new=1`}
              className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-xs font-medium text-foreground/60 hover:text-foreground hover:bg-accent transition-colors"
              title="Send to decision flow"
            >
              <DecisionIcon className="h-3 w-3" />
              Decision
            </Link>
          )}
          {task.chainBinding && !task.completed && (
            <Button
              size="sm"
              variant="default"
              className="h-7 text-xs"
              onClick={onRunChain}
              disabled={isRunning}
            >
              <PlayFilled className="h-3 w-3 mr-1" />
              Run
            </Button>
          )}
          {task.completed ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={onReopen}
            >
              <RotateCcw className="h-3 w-3 mr-1" />
              Reopen
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={onClose}
            >
              <X className="h-3 w-3 mr-1" />
              Close
            </Button>
          )}
        </div>
      </DetailHeader>

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
        {task.chainBinding && (
          <div className="flex items-center gap-1.5 col-span-2">
            <Link2 className="h-2.5 w-2.5 text-foreground/30" />
            <span className="text-foreground/30">chain</span>
            <span className="text-foreground/60 font-medium">
              {task.chainBinding.chain_name || task.chainBinding.chain_id}
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
