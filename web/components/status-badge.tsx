import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

export type Status = "pending" | "running" | "complete" | "completed" | "error" | "failed" | "paused" | "cancelled" | "stopped" | "idle" | "delivered" | "warning" | "waiting_approval"

const statusVariants = cva(
  "inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 gap-1.5 transition-all",
  {
    variants: {
      status: {
        pending: "bg-amber-500/10 text-amber-600 border-amber-500/30 dark:bg-amber-500/20 dark:text-amber-400",
        running: "bg-blue-500/10 text-blue-600 border-blue-500/30 dark:bg-blue-500/20 dark:text-blue-400",
        complete: "bg-green-500/10 text-green-600 border-green-500/30 dark:bg-green-500/20 dark:text-green-400",
        completed: "bg-green-500/10 text-green-600 border-green-500/30 dark:bg-green-500/20 dark:text-green-400",
        error: "bg-red-500/10 text-red-600 border-red-500/30 dark:bg-red-500/20 dark:text-red-400",
        failed: "bg-red-500/10 text-red-600 border-red-500/30 dark:bg-red-500/20 dark:text-red-400",
        paused: "bg-yellow-500/10 text-yellow-600 border-yellow-500/30 dark:bg-yellow-500/20 dark:text-yellow-400",
        cancelled: "bg-gray-500/10 text-gray-600 border-gray-500/30 dark:bg-gray-500/20 dark:text-gray-400",
        stopped: "bg-foreground/5 text-foreground/50 border-foreground/10 dark:bg-foreground/5 dark:text-foreground/40",
        idle: "bg-gray-500/10 text-gray-600 border-gray-500/30 dark:bg-gray-500/20 dark:text-gray-400",
        delivered: "bg-green-500/10 text-green-600 border-green-500/30 dark:bg-green-500/20 dark:text-green-400",
        warning: "bg-amber-500/10 text-amber-600 border-amber-500/30 dark:bg-amber-500/20 dark:text-amber-400",
        waiting_approval: "bg-amber-500/10 text-amber-600 border-amber-500/30 dark:bg-amber-500/20 dark:text-amber-400",
      },
      size: {
        sm: "px-1.5 py-0 text-[10px] gap-1",
        md: "px-2 py-0.5 text-xs gap-1.5",
        lg: "px-2.5 py-1 text-sm gap-2",
      },
    },
    defaultVariants: {
      status: "pending",
      size: "md",
    },
  }
)

const statusIcons: Record<Status, React.ReactNode> = {
  pending: <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />,
  running: <span className="relative flex h-1.5 w-1.5">
    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-75"></span>
    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-current"></span>
  </span>,
  complete: <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
  </svg>,
  completed: <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
  </svg>,
  error: <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
  </svg>,
  failed: <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
  </svg>,
  paused: <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
  </svg>,
  cancelled: <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
  </svg>,
  stopped: <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <rect x="6" y="6" width="12" height="12" rx="1" strokeWidth={2} fill="currentColor" />
  </svg>,
  idle: <span className="w-1.5 h-1.5 rounded-full bg-current opacity-40" />,
  delivered: <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
  </svg>,
  warning: <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  </svg>,
  waiting_approval: <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>,
}

export interface StatusBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statusVariants> {
  status: Status
  label?: string
  showIcon?: boolean
}

const defaultLabels: Record<Status, string> = {
  pending: "pending",
  running: "running",
  complete: "complete",
  completed: "completed",
  error: "error",
  failed: "failed",
  paused: "paused",
  cancelled: "cancelled",
  stopped: "stopped",
  idle: "idle",
  delivered: "delivered",
  warning: "partial",
  waiting_approval: "approval needed",
}

export function StatusBadge({
  status,
  label,
  showIcon = true,
  className,
  size,
  ...props
}: StatusBadgeProps) {
  return (
    <span
      className={cn(statusVariants({ status, size }), className)}
      {...props}
    >
      {showIcon && statusIcons[status]}
      {label ?? defaultLabels[status]}
    </span>
  )
}
