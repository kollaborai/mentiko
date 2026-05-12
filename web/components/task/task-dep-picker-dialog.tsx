"use client";

import { useState, useMemo } from "react";
import { AddFilled as Plus } from "@aliimam/icons";
import { Button } from "@/components/ui/button";
import { TypeBadge } from "./type-badge";
import { PriorityBadge } from "./priority-badge";
import type { Task } from "@/lib/task-types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WaveSpinner } from "@/components/ui/wave-spinner";

interface TaskDepPickerDialogProps {
  open: boolean;
  onClose: () => void;
  onAddDep: (depTaskId: string) => Promise<void>;
  allTasks: Task[];
  currentTaskId: string;
  existingDepIds: string[];
  workspacePath?: string;
}

export function TaskDepPickerDialog({
  open,
  onClose,
  onAddDep,
  allTasks,
  currentTaskId,
  existingDepIds,
  workspacePath: _workspacePath,
}: TaskDepPickerDialogProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [adding, setAdding] = useState<string | null>(null);

  // filter candidates: exclude current task, existing deps, closed tasks
  const candidates = useMemo(() => {
    const excludedIds = new Set([currentTaskId, ...existingDepIds]);
    return allTasks
      .filter((t) => !excludedIds.has(t.id) && t.status !== "closed")
      .filter((t) => {
        if (!searchQuery.trim()) return true;
        const query = searchQuery.toLowerCase();
        return (
          t.title.toLowerCase().includes(query) ||
          t.id.toLowerCase().includes(query)
        );
      })
      .sort((a, b) => {
        // sort by priority first
        const priorityDiff = a.rawPriority - b.rawPriority;
        if (priorityDiff !== 0) return priorityDiff;
        // then by title
        return a.title.localeCompare(b.title);
      });
  }, [allTasks, currentTaskId, existingDepIds, searchQuery]);

  const handleAdd = async (depTaskId: string) => {
    setAdding(depTaskId);
    try {
      await onAddDep(depTaskId);
      onClose();
    } finally {
      setAdding(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Dependency</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* search */}
          <input
            type="text"
            placeholder="Search tasks by title or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-10 px-3 rounded-lg bg-card border border-foreground/10 text-sm outline-none focus:border-foreground/30 transition-colors"
            autoFocus
          />

          {/* task list */}
          <div className="max-h-80 overflow-y-auto space-y-1">
            {candidates.length === 0 ? (
              <div className="text-center py-8 text-xs text-foreground/30">
                {searchQuery.trim() ? "No tasks match your search" : "No available tasks"}
              </div>
            ) : (
              candidates.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center gap-2 px-2 py-2 rounded-md hover:bg-accent transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-foreground truncate">
                      {task.title}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <PriorityBadge priority={task.priority} rawPriority={typeof task.rawPriority === "number" ? task.rawPriority : undefined} />
                      <TypeBadge type={task.type} />
                      <span className="text-[9px] font-mono text-foreground/20 truncate">
                        {task.id}
                      </span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleAdd(task.id)}
                    disabled={adding !== null}
                    className="shrink-0 h-7 px-2"
                  >
                    {adding === task.id ? (
                      <WaveSpinner size="xs" color="primary" animation="ripple" />
                    ) : (
                      <>
                        <Plus className="h-3 w-3" />
                        <span className="text-xs">Add</span>
                      </>
                    )}
                  </Button>
                </div>
              ))
            )}
          </div>

          {/* helper text */}
          <div className="text-[10px] text-foreground/30 text-center">
            {candidates.length} available task{candidates.length !== 1 ? "s" : ""}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
