"use client";

import { TickSquareFilled, SquareRounded, Trash2, TickCircleFilled, MagicStarFilled } from "@aliimam/icons";
import { Button } from "@/components/ui/button";
import type {
  TaskFilterStatus,
  TaskFilterType,
  TaskSortBy,
} from "@/lib/tasks/task-types";
import {
  WorkflowSidebarFilters,
  WorkflowSidebarSearchInput,
  WorkflowSidebarSegmentedControl,
} from "@/components/ui/workflow-sidebar";

interface TaskFiltersProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  filterStatus: TaskFilterStatus;
  onFilterStatusChange: (status: TaskFilterStatus) => void;
  filterType: TaskFilterType;
  onFilterTypeChange: (type: TaskFilterType) => void;
  sortBy: TaskSortBy;
  onSortChange: (sort: TaskSortBy) => void;
  totalCount: number;
  filteredCount: number;
  selectMode?: boolean;
  onToggleSelectMode?: () => void;
  selectedCount?: number;
  onBulkClose?: () => void;
  onBulkDelete?: () => void;
  onGenerate?: () => void;
}

const statusOptions: { value: TaskFilterStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "ready", label: "Ready" },
  { value: "in_progress", label: "Active" },
  { value: "closed", label: "Closed" },
];

const typeOptions: { value: TaskFilterType; label: string }[] = [
  { value: "all", label: "All" },
  { value: "epic", label: "Epic" },
  { value: "feature", label: "Feat" },
  { value: "task", label: "Task" },
  { value: "decision", label: "Dec" },
  { value: "link", label: "Link" },
  { value: "bug", label: "Bug" },
  { value: "chore", label: "Chore" },
];

const sortOptions: { value: TaskSortBy; label: string }[] = [
  { value: "priority", label: "Priority" },
  { value: "updated", label: "Updated" },
  { value: "created", label: "Created" },
  { value: "title", label: "Title" },
];

export function TaskFilters({
  searchQuery,
  onSearchChange,
  filterStatus,
  onFilterStatusChange,
  filterType,
  onFilterTypeChange,
  sortBy,
  onSortChange,
  totalCount,
  filteredCount,
  selectMode,
  onToggleSelectMode,
  selectedCount = 0,
  onBulkClose,
  onBulkDelete,
  onGenerate,
}: TaskFiltersProps) {
  return (
    <WorkflowSidebarFilters className="space-y-1.5 bg-muted/60 p-2.5">
      <div className="flex items-center gap-1.5">
        <WorkflowSidebarSearchInput
          value={searchQuery}
          onChange={onSearchChange}
          placeholder="Search tasks"
        />
        {onGenerate && (
          <Button size="sm" variant="default" className="shrink-0" onClick={onGenerate} title="Create or generate task">
            <MagicStarFilled className="h-3 w-3" />
          </Button>
        )}
      </div>
      <WorkflowSidebarSegmentedControl
        options={statusOptions}
        value={filterStatus}
        onChange={onFilterStatusChange}
      />
      <WorkflowSidebarSegmentedControl
        options={typeOptions}
        value={filterType}
        onChange={onFilterTypeChange}
        buttonClassName="text-[9px]"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground">
          {filteredCount} of {totalCount}
        </span>
        <div className="flex items-center gap-1.5">
          {onToggleSelectMode && (
            <Button
              size="xs"
              variant={selectMode ? "default" : "ghost"}
              className="text-[10px]"
              onClick={onToggleSelectMode}
            >
              {selectMode ? <TickSquareFilled className="h-3 w-3" /> : <SquareRounded className="h-3 w-3" />}
              {selectMode ? "Done" : "Select"}
            </Button>
          )}
          {selectMode && selectedCount > 0 && (
            <>
              <Button size="xs" variant="ghost" className="text-[10px]" onClick={onBulkClose}>
                <TickCircleFilled className="h-3 w-3" />
                Close ({selectedCount})
              </Button>
              <Button size="xs" variant="destructive" className="text-[10px]" onClick={onBulkDelete}>
                <Trash2 className="h-3 w-3" />
                Delete ({selectedCount})
              </Button>
            </>
          )}
          <div className="flex items-center gap-1 rounded-md bg-card p-0.5">
            {sortOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                aria-pressed={sortBy === opt.value}
                onClick={() => onSortChange(opt.value)}
                className={
                  sortBy === opt.value
                    ? "h-6 rounded-sm bg-foreground px-2 text-[10px] text-background"
                    : "h-6 rounded-sm px-2 text-[10px] text-muted-foreground hover:text-foreground"
                }
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </WorkflowSidebarFilters>
  );
}
