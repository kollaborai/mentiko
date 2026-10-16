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
  WorkflowSidebarSelect,
  WorkflowSidebarToggleFilter,
} from "@/components/ui/workflow-sidebar";

interface TaskFiltersProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  filterStatus: TaskFilterStatus[];
  onFilterStatusChange: (status: TaskFilterStatus[]) => void;
  filterType: TaskFilterType[];
  onFilterTypeChange: (type: TaskFilterType[]) => void;
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
  { value: "priority", label: "Sort: Priority" },
  { value: "updated", label: "Sort: Updated" },
  { value: "created", label: "Sort: Created" },
  { value: "title", label: "Sort: Title" },
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
    <WorkflowSidebarFilters>
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
      <WorkflowSidebarToggleFilter
        options={statusOptions}
        value={filterStatus}
        onChange={onFilterStatusChange}
      />
      {/* eight types: tighter padding keeps one row at the 280px minimum width */}
      <WorkflowSidebarToggleFilter
        options={typeOptions}
        value={filterType}
        onChange={onFilterTypeChange}
        buttonClassName="px-0.5"
      />
      <WorkflowSidebarSelect
        options={sortOptions}
        value={sortBy}
        onChange={onSortChange}
        aria-label="Sort tasks"
      />
      <div className="flex items-center justify-between gap-2">
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
        </div>
        <span className="text-[10px] text-muted-foreground">
          {filteredCount} of {totalCount}
        </span>
      </div>
    </WorkflowSidebarFilters>
  );
}
