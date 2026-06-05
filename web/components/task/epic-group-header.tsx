"use client";

import { WorkflowSidebarSectionHeader } from "@/components/ui/workflow-sidebar";
import type { EpicStatus } from "@/lib/tasks/task-types";

interface EpicGroupHeaderProps {
  epic: EpicStatus | null;
  taskCount: number;
  collapsed?: boolean;
  selected?: boolean;
  onToggle?: () => void;
  onSelect?: () => void;
}

function getEpicDot(epic: EpicStatus | null): string {
  if (!epic) return "bg-muted-foreground/40";
  if (epic.total_children > 0 && epic.closed_children === epic.total_children) {
    return "bg-emerald-500";
  }
  if (epic.closed_children > 0) {
    return "bg-sky-400";
  }
  return "bg-amber-400";
}

export function EpicGroupHeader({ epic, taskCount, collapsed, selected, onToggle, onSelect }: EpicGroupHeaderProps) {
  return (
    <WorkflowSidebarSectionHeader
      title={epic?.title || "Ungrouped"}
      count={taskCount}
      meta={epic ? `${epic.closed_children}/${epic.total_children} done` : undefined}
      dotClassName={getEpicDot(epic)}
      collapsed={collapsed}
      selected={selected}
      onToggle={onToggle}
      onSelect={onSelect}
      className="px-3 pt-2"
    />
  );
}
