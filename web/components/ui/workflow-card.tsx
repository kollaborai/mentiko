import { cn } from "@/lib/utils"
import { StatusBadge, type Status } from "@/components/common/status-badge"
import { ClockFilled as Clock, FlashFilled as Zap, CommandSquareFilled as Terminal, PeopleFilled as Users } from "@aliimam/icons"
import { TimeAgo } from "@/components/shared/time-ago"
import type { ReactNode } from "react"

export interface WorkflowAgent {
  id: string
  name?: string
  status: string
  session?: string
  started?: string
  completed?: string
}

export interface WorkflowCardProps {
  id?: string
  title: string
  description?: string
  icon?: ReactNode
  status?: "idle" | "running" | "completed" | "error" | Status
  goal?: string
  started?: string
  completed?: string
  agents?: WorkflowAgent[]
  stats?: Array<{ label: string; value: string | number | ReactNode; icon?: ReactNode }>
  onClick?: () => void;
  actions?: ReactNode;
  selected?: boolean
  variant?: "compact" | "default" | "detailed"
  className?: string;
  taskId?: string;
  chainId?: string;
  lastRunStatus?: "pending" | "running" | "completed" | "failed" | "cancelled" | null;
}

function formatDuration(start?: string, end?: string) {
  if (!start) return "-"
  const startDate = new Date(start).getTime()
  const endDate = end ? new Date(end).getTime() : Date.now()
  const diff = endDate - startDate
  if (diff < 1000) return `${diff}ms`
  if (diff < 60000) return `${(diff / 1000).toFixed(1)}s`
  const mins = Math.floor(diff / 60000)
  const secs = Math.floor((diff % 60000) / 1000)
  return `${mins}m ${secs}s`
}

const completedAgents = (agents?: WorkflowAgent[]) =>
  agents?.filter((a) => a.status === "complete").length || 0
const totalAgents = (agents?: WorkflowAgent[]) => agents?.length || 0
const runningAgents = (agents?: WorkflowAgent[]) =>
  agents?.filter((a) => a.status === "running").length || 0

function getLastRunDotColor(status: "pending" | "running" | "completed" | "failed" | "cancelled" | null | undefined) {
  switch (status) {
    case "completed": return "bg-green-400"
    case "failed": return "bg-red-400"
    case "cancelled": return "bg-orange-400"
    case "running": case "pending": return "bg-amber-400"
    default: return "bg-muted-foreground/30"
  }
}

export function WorkflowCard({
  id,
  title,
  description,
  icon,
  status = "idle",
  goal,
  started,
  completed,
  agents,
  stats,
  onClick,
  actions,
  selected = false,
  variant = "default",
  className,
  lastRunStatus,
}: WorkflowCardProps) {
  const isRunning = status === "running" || status === "pending"
  const hasAgents = agents && agents.length > 0

  return (
    <div
      data-slot="workflow-card"
      data-variant={variant}
      data-status={status}
      className={cn(
        "group relative rounded-md transition-colors",
        selected && "bg-accent",
        !selected && "bg-card hover:bg-card",
        onClick && "cursor-pointer",
        isRunning && "animate-pulse-subtle",
        className
      )}
      onClick={onClick}
    >
      {/* status indicator for running */}
      {isRunning && (
        <div className="absolute left-0 top-3 bottom-3 w-0.5 bg-amber-400/60 rounded-r-full" />
      )}

      {/* compact variant - minimal list item */}
      {variant === "compact" && (
        <div className="px-3 py-2">
          <div className="flex items-center gap-2">
            {icon && (
              <div className="w-6 h-6 flex items-center justify-center shrink-0">
                {icon}
              </div>
            )}
            <span className="text-xs font-medium truncate flex-1">{title}</span>
            {status && <StatusBadge status={status as Status} size="sm" />}
            {hasAgents && (
              <span className="text-[10px] text-foreground/30 font-mono">
                {completedAgents(agents)}/{totalAgents(agents)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* default variant - standard list card */}
      {variant === "default" && (
        <div className="p-3 md:p-4">
          <div className="flex items-start gap-3">
            {icon && (
              <div className="w-10 h-10 flex items-center justify-center shrink-0">
                {icon}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-sm font-medium truncate">{title}</h3>
                {lastRunStatus !== undefined && (
                  <span
                    className={cn("w-2 h-2 rounded-full shrink-0", getLastRunDotColor(lastRunStatus))}
                    title={`Last run: ${lastRunStatus || "never"}`}
                  />
                )}
                {status && <StatusBadge status={status as Status} size="sm" />}
              </div>
              {(description || goal) && (
                <p className="text-xs text-foreground/50 truncate line-clamp-1">
                  {description || goal}
                </p>
              )}
              <div className="flex items-center gap-3 mt-2 text-[10px] text-foreground/30">
                {started && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-2.5 w-2.5" />
                    <TimeAgo date={started} format="short" suffix={false} />
                  </span>
                )}
                {hasAgents && (
                  <span className="flex items-center gap-1">
                    <Zap className="h-2.5 w-2.5" />
                    {completedAgents(agents)}/{totalAgents(agents)}
                  </span>
                )}
                {started && (
                  <span className="font-mono">
                    {formatDuration(started, completed)}
                  </span>
                )}
                {stats && stats.map((stat, idx) => (
                  <span key={idx} className="flex items-center gap-1">
                    {stat.icon}
                    {stat.label}: {stat.value}
                  </span>
                ))}
              </div>
            </div>
            {actions && (
              <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                {actions}
              </div>
            )}
          </div>
        </div>
      )}

      {/* detailed variant - full expanded view */}
      {variant === "detailed" && (
        <div className="p-4 md:p-5">
          {/* header */}
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                {icon || <Terminal className="h-4 w-4 text-foreground/40" />}
                <h3 className="text-base font-medium">{title}</h3>
                {status && <StatusBadge status={status as Status} size="sm" />}
                {isRunning && (
                  <span className="text-[9px] uppercase tracking-wide text-amber-400">
                    live
                  </span>
                )}
              </div>
              {id && <p className="text-xs text-foreground/30 font-mono">{id}</p>}
            </div>
            <div className="flex items-center gap-3 text-xs">
              {started && (
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-foreground/40" />
                  <span className="font-mono">{formatDuration(started, completed)}</span>
                </div>
              )}
              {hasAgents && (
                <div className="flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-foreground/40" />
                  <span className="font-mono">{completedAgents(agents)}/{totalAgents(agents)}</span>
                </div>
              )}
            </div>
          </div>

          {/* goal/description section */}
          {(goal || description) && (
            <div className="bg-card rounded-md p-3 mb-4">
              <p className="text-[10px] text-foreground/40 uppercase tracking-wider mb-1">
                goal
              </p>
              <p className="text-xs text-foreground/80 whitespace-pre-wrap">
                {goal || description}
              </p>
            </div>
          )}

          {/* metrics grid */}
          {hasAgents && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
              <div className="bg-card rounded-md p-2.5">
                <div className="flex items-center gap-1.5 text-foreground/40 mb-1">
                  <Clock className="h-3 w-3" />
                  <span className="text-[9px] uppercase">duration</span>
                </div>
                <div className="text-sm font-mono">{formatDuration(started, completed)}</div>
              </div>
              <div className="bg-card rounded-md p-2.5">
                <div className="flex items-center gap-1.5 text-foreground/40 mb-1">
                  <Zap className="h-3 w-3" />
                  <span className="text-[9px] uppercase">progress</span>
                </div>
                <div className="text-sm">{completedAgents(agents)}/{totalAgents(agents)}</div>
              </div>
              <div className="bg-card rounded-md p-2.5">
                <div className="flex items-center gap-1.5 text-foreground/40 mb-1">
                  <Users className="h-3 w-3" />
                  <span className="text-[9px] uppercase">active</span>
                </div>
                <div className="text-sm font-mono">{runningAgents(agents)}</div>
              </div>
              <div className="bg-card rounded-md p-2.5">
                <div className="flex items-center gap-1.5 text-foreground/40 mb-1">
                  <Terminal className="h-3 w-3" />
                  <span className="text-[9px] uppercase">status</span>
                </div>
                <div className="text-xs capitalize">{status}</div>
              </div>
            </div>
          )}

          {/* agents list */}
          {hasAgents && (
            <div>
              <p className="text-[10px] text-foreground/40 uppercase tracking-wider mb-2">
                agents ({agents.length})
              </p>
              <div className="space-y-1.5">
                {agents.map((agent) => (
                  <div
                    key={agent.id}
                    className="bg-muted rounded-md p-2.5 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <Terminal className="h-3 w-3 text-foreground/30" />
                      <span className="text-xs font-medium">
                        {agent.name || agent.id}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-foreground/30 font-mono">
                        {formatDuration(agent.started || started, agent.completed)}
                      </span>
                      <StatusBadge status={agent.status as Status} size="sm" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
