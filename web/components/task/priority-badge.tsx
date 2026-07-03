import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { priorityBgColor } from "@/lib/tasks/task-transforms"
import type { TaskPriority } from "@/lib/tasks/task-types"
import {
  DangerFilled,
  ArrowUpFilled,
  MinusFilled,
  AddCircleFilled,
} from "@aliimam/icons"

export interface PriorityBadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof priorityVariants> {
  priority: TaskPriority
  /** Numeric priority (0,1,2…) — when present the badge reads "P{n}", matching the rest of the task UI. */
  rawPriority?: number
  label?: string
  showIcon?: boolean
}

// Color classes come from the shared priorityBgColor helper
// (web/lib/tasks/task-transforms.ts) so priorities stay consistent across the
// task UI. Only layout (size) varies here.
// md is the default and matches the app's inline-badge convention (TypeBadge et
// al: text-[10px], px-1.5, h-2.5 icon) so it doesn't tower over its neighbours;
// lg is the roomier variant, sm the densest.
const priorityVariants = cva(
  "inline-flex items-center justify-center rounded-sm font-medium w-fit whitespace-nowrap shrink-0",
  {
    variants: {
      size: {
        sm: "px-1 py-0 text-[9px] gap-0.5",
        md: "px-1.5 py-0.5 text-[10px] gap-1",
        lg: "px-2 py-0.5 text-xs gap-1.5",
      },
    },
    defaultVariants: {
      size: "md",
    },
  }
)

const priorityIconComponents: Record<
  TaskPriority,
  React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>
> = {
  high: DangerFilled,
  medium: ArrowUpFilled,
  low: MinusFilled,
  none: AddCircleFilled,
}

// Icon tracks the text size so it never looks out of proportion at any size.
const iconSizeClass: Record<"sm" | "md" | "lg", string> = {
  sm: "h-2 w-2",
  md: "h-2.5 w-2.5",
  lg: "h-3 w-3",
}

export function PriorityBadge({
  priority,
  rawPriority,
  label,
  showIcon = true,
  className,
  size,
  ...props
}: PriorityBadgeProps) {
  // Prefer the numeric "P{n}" label when rawPriority is supplied (matches the
  // rest of the task UI), else an explicit label, else the priority string.
  const display = rawPriority !== undefined ? `P${rawPriority}` : (label ?? priority)
  const Icon = priorityIconComponents[priority]
  return (
    <span
      className={cn(priorityVariants({ size }), priorityBgColor(priority), className)}
      aria-label={`Priority: ${display}`}
      data-slot="priority-badge"
      data-priority={priority}
      data-size={size}
      data-testid="priority-badge"
      {...props}
    >
      {showIcon && <Icon aria-hidden className={iconSizeClass[size ?? "md"]} />}
      {display}
    </span>
  )
}
