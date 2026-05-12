import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { GpsFilled as Target, TickCircleFilled as Check, InfoCircleFilled as AlertCircle, PauseFilled as Pause, RecordCircleFilled as Circle } from "@aliimam/icons"

export type GoalStatus = "pending" | "in_progress" | "completed" | "blocked" | "cancelled"

export interface GoalCardProps {
  id?: string
  title: string
  description?: string
  status?: GoalStatus
  progress?: number
  icon?: ReactNode
  meta?: string
  onClick?: () => void
  className?: string
  children?: ReactNode
}

function getStatusIcon(status: GoalStatus) {
  switch (status) {
    case "completed":
      return <Check className="h-3.5 w-3.5 text-green-500" />
    case "in_progress":
      return <AlertCircle className="h-3.5 w-3.5 text-blue-500 animate-pulse" />
    case "blocked":
      return <Pause className="h-3.5 w-3.5 text-red-500" />
    case "cancelled":
      return <Circle className="h-3.5 w-3.5 text-foreground/30" />
    default:
      return <Circle className="h-3.5 w-3.5 text-foreground/40" />
  }
}

function getStatusColor(status: GoalStatus): string {
  switch (status) {
    case "completed":
      return "bg-green-500"
    case "in_progress":
      return "bg-blue-500"
    case "blocked":
      return "bg-red-500"
    case "cancelled":
      return "bg-foreground/20"
    default:
      return "bg-foreground/40"
  }
}

export function GoalCard({
  id,
  title,
  description,
  status = "pending",
  progress = 0,
  icon,
  meta,
  onClick,
  className,
  children,
}: GoalCardProps) {
  const Component = onClick ? "button" : "div"

  return (
    <Component
      data-slot="goal-card"
      data-id={id}
      data-status={status}
      className={cn(
        "group relative rounded-md p-4 transition-colors text-left",
        "bg-card hover:bg-muted",
        onClick && "cursor-pointer",
        className
      )}
      onClick={onClick}
    >
      {progress > 0 && progress < 100 && (
        <div className="absolute left-0 right-0 top-0 h-0.5 bg-muted overflow-hidden">
          <div
            className={cn("h-full transition-all duration-300", getStatusColor(status))}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      <div className="flex gap-3">
        <div className="shrink-0">
          {icon || (
            <div className="h-8 w-8 rounded-md bg-accent flex items-center justify-center">
              <Target className="h-4 w-4 text-foreground/60" />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-medium leading-tight truncate">
                {title}
              </h4>
              {description && (
                <p className="text-xs text-foreground/60 mt-1 leading-relaxed max-w-md">
                  {description}
                </p>
              )}
            </div>

            <div className="shrink-0 mt-0.5">
              {getStatusIcon(status)}
            </div>
          </div>

          {children && (
            <div className="mt-3">
              {children}
            </div>
          )}

          {(meta || progress > 0) && (
            <div className="flex items-center justify-between mt-2">
              {meta && (
                <span className="text-[10px] text-foreground/40 font-mono">
                  {meta}
                </span>
              )}
              {progress > 0 && !children && (
                <span className="text-[10px] text-foreground/40 ml-auto">
                  {progress}%
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </Component>
  )
}
