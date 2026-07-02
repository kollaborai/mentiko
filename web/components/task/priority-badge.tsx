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
  label?: string
  showIcon?: boolean
}

// Color classes come from the shared priorityBgColor helper
// (web/lib/tasks/task-transforms.ts) so priorities stay consistent across the
// task UI. Only layout (size) varies here.
const priorityVariants = cva(
  "inline-flex items-center justify-center rounded-sm px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 gap-1.5",
  {
    variants: {
      size: {
        sm: "px-1.5 py-0 text-[10px] gap-1",
        md: "px-2 py-0.5 text-xs gap-1.5",
        lg: "px-2.5 py-1 text-sm gap-2",
      },
    },
    defaultVariants: {
      size: "md",
    },
  }
)

const priorityIcons: Record<TaskPriority, React.ReactNode> = {
  high: <DangerFilled aria-hidden="true" className="h-3 w-3" />,
  medium: <ArrowUpFilled aria-hidden="true" className="h-3 w-3" />,
  low: <MinusFilled aria-hidden="true" className="h-3 w-3" />,
  none: <AddCircleFilled aria-hidden="true" className="h-3 w-3" />,
}

export function PriorityBadge({
  priority,
  label,
  showIcon = true,
  className,
  size,
  ...props
}: PriorityBadgeProps) {
  return (
    <span
      className={cn(priorityVariants({ size }), priorityBgColor(priority), className)}
      aria-label={`Priority: ${label ?? priority}`}
      data-slot="priority-badge"
      data-priority={priority}
      data-size={size}
      data-testid="priority-badge"
      {...props}
    >
      {showIcon && priorityIcons[priority]}
      {label ?? priority}
    </span>
  )
}
