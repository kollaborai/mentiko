import { JudgeFilled, LinkFilled } from "@aliimam/icons";
import { cn } from "@/lib/utils";
import { typeLabel, typeBgColor } from "@/lib/tasks/task-transforms";

interface TypeBadgeProps {
  type: string;
  /** override the displayed text (e.g. "TASK-152" instead of just "TASK") */
  label?: string;
  className?: string;
}

export function TypeBadge({ type, label, className }: TypeBadgeProps) {
  const Icon = type === "decision" ? JudgeFilled : type === "link" ? LinkFilled : null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium",
        typeBgColor(type),
        className
      )}
    >
      {Icon && <Icon className="h-2.5 w-2.5" />}
      {label ?? typeLabel(type)}
    </span>
  );
}
