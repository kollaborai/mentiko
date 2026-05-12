import { cn } from "@/lib/utils";
import { typeLabel, typeBgColor } from "@/lib/task-transforms";

interface TypeBadgeProps {
  type: string;
  className?: string;
}

export function TypeBadge({ type, className }: TypeBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium",
        typeBgColor(type),
        className
      )}
    >
      {typeLabel(type)}
    </span>
  );
}
