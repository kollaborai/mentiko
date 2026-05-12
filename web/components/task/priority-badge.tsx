import { cn } from "@/lib/utils";
import { priorityBgColor } from "@/lib/task-transforms";
import type { TaskPriority } from "@/lib/task-types";

interface PriorityBadgeProps {
  priority: TaskPriority;
  rawPriority?: number;
  className?: string;
}

export function PriorityBadge({
  priority,
  rawPriority,
  className,
}: PriorityBadgeProps) {
  const label = rawPriority !== undefined ? `P${rawPriority}` : priority.toUpperCase();

  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium",
        priorityBgColor(priority),
        className
      )}
    >
      {label}
    </span>
  );
}
