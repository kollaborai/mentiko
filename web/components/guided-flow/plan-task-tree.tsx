"use client";

import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { PlanTask, PlanDependency } from "@/lib/decisions/decision-types";

interface PlanTaskTreeProps {
  tasks: PlanTask[];
  dependencies: PlanDependency[];
  onTaskEdit?: (taskId: string, title: string) => void;
  onTaskRemove?: (taskId: string) => void;
}

const priorityConfig: Record<number, { bg: string; text: string; label: string }> = {
  0: { bg: "bg-rose-500/15", text: "text-rose-400", label: "P0" },
  1: { bg: "bg-orange-500/15", text: "text-orange-400", label: "P1" },
  2: { bg: "bg-amber-500/15", text: "text-amber-400", label: "P2" },
  3: { bg: "bg-sky-500/15", text: "text-sky-400", label: "P3" },
  4: { bg: "bg-foreground/5", text: "text-foreground/40", label: "P4" },
};

function PriorityBadge({ priority }: { priority: number }) {
  const config = priorityConfig[priority] ?? priorityConfig[4];
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium",
        config.bg,
        config.text
      )}
    >
      {config.label}
    </span>
  );
}

function InlineEditTitle({
  value,
  onSave,
}: {
  value: string;
  onSave: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) {
      onSave(trimmed);
    } else {
      setDraft(value);
    }
    setEditing(false);
  }, [draft, value, onSave]);

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        className="bg-transparent text-sm text-foreground outline-none w-full"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="text-sm text-foreground text-left hover:text-foreground/80 transition-colors cursor-text"
    >
      {value}
    </button>
  );
}

export function PlanTaskTree({
  tasks,
  dependencies,
  onTaskEdit,
  onTaskRemove,
}: PlanTaskTreeProps) {
  // group by phase
  const phases = new Map<number, PlanTask[]>();
  for (const task of tasks) {
    const group = phases.get(task.phase) ?? [];
    group.push(task);
    phases.set(task.phase, group);
  }
  const sortedPhases = [...phases.entries()].sort(([a], [b]) => a - b);

  // build lookup for dependency titles
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  // resolve dependencies targeting each task
  const depsFor = (taskId: string): PlanTask[] => {
    return dependencies
      .filter((d) => d.to === taskId)
      .map((d) => taskById.get(d.from))
      .filter(Boolean) as PlanTask[];
  };

  return (
    <div className="flex flex-col gap-4">
      {sortedPhases.map(([phase, phaseTasks]) => (
        <div key={phase}>
          <div className="bg-muted rounded-md px-3 py-2 flex items-center justify-between">
            <span className="text-xs text-foreground/40 font-medium">
              Phase {phase}
            </span>
            <span className="text-xs text-foreground/30">
              {phaseTasks.length} {phaseTasks.length === 1 ? "task" : "tasks"}
            </span>
          </div>

          <div className="mt-1">
            {phaseTasks.map((task) => {
              const taskDeps = depsFor(task.id);

              return (
                <div
                  key={task.id}
                  className="group px-4 py-2 hover:bg-card rounded-md"
                >
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      {onTaskEdit ? (
                        <InlineEditTitle
                          value={task.title}
                          onSave={(title) => onTaskEdit(task.id, title)}
                        />
                      ) : (
                        <span className="text-sm text-foreground">
                          {task.title}
                        </span>
                      )}
                    </div>

                    <PriorityBadge priority={task.priority} />

                    {onTaskRemove && (
                      <button
                        type="button"
                        onClick={() => onTaskRemove(task.id)}
                        className="text-xs text-foreground/20 hover:text-foreground/60 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                      >
                        remove
                      </button>
                    )}
                  </div>

                  {task.subtasks.length > 0 && (
                    <div className="mt-1 ml-4 flex flex-col gap-0.5">
                      {task.subtasks.map((sub, i) => (
                        <span
                          key={i}
                          className="text-xs text-foreground/50"
                        >
                          {sub}
                        </span>
                      ))}
                    </div>
                  )}

                  {taskDeps.length > 0 && (
                    <div className="mt-1 ml-4 flex flex-wrap items-center gap-1">
                      {taskDeps.map((dep) => (
                        <span
                          key={dep.id}
                          className="inline-flex items-center gap-0.5 text-[10px] text-foreground/20"
                        >
                          <span className="text-foreground/15">{"\u2190"}</span>
                          depends on: {dep.title}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
