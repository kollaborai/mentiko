"use client"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import {
  ClockFilled as Clock,
  GlobalFilled as Globe,
  PlayFilled as Play,
  NotificationStatusFilled as BellOff,
  DangerFilled as AlertTriangle,
  UndoFilled as History,
} from "@aliimam/icons"

export type ScheduleStatus = "enabled" | "disabled" | "snoozed" | "paused"

export interface CalendarEventCardProps {
  id: string
  title: string
  schedule: string
  timezone: string
  status: ScheduleStatus
  nextRun?: string | null
  lastRun?: string | null
  avgDuration?: number
  runCount?: number
  conflictDetected?: boolean
  conflictingChains?: string[]
  snoozedUntil?: string | null
  enabled?: boolean
  onToggle?: (id: string, enabled: boolean) => void
  onRunNow?: (id: string) => void
  onSnooze?: (id: string, duration: string) => void
  onUnsnooze?: (id: string) => void
  onEdit?: (id: string) => void
  onHistory?: (id: string) => void
  className?: string
}

function formatNextRun(nextRun: string | null | undefined): string {
  if (!nextRun) return "not scheduled"
  try {
    const date = new Date(nextRun)
    const now = new Date()
    const diffMs = date.getTime() - now.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    const diffHour = Math.floor(diffMin / 60)
    const diffDay = Math.floor(diffHour / 24)

    if (diffMin < 0) return "overdue"
    if (diffMin < 60) return `in ${diffMin}m`
    if (diffHour < 24) return `in ${diffHour}h`
    return `in ${diffDay}d`
  } catch {
    return "unknown"
  }
}

function formatTimeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return "never"
  try {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffSec = Math.floor(diffMs / 1000)
    const diffMin = Math.floor(diffSec / 60)
    const diffHour = Math.floor(diffMin / 60)
    const diffDay = Math.floor(diffHour / 24)

    if (diffSec < 60) return "just now"
    if (diffMin < 60) return `${diffMin}m ago`
    if (diffHour < 24) return `${diffHour}h ago`
    return `${diffDay}d ago`
  } catch {
    return "unknown"
  }
}

function getStatusBadgeProps(status: ScheduleStatus) {
  switch (status) {
    case "enabled":
      return { label: "Active", className: "bg-green-500/20 text-green-400" }
    case "disabled":
      return { label: "Paused", className: "bg-muted" }
    case "snoozed":
      return { label: "Snoozed", className: "bg-yellow-500/20 text-yellow-400" }
    case "paused":
      return { label: "Paused", className: "bg-muted" }
    default:
      return { label: status, className: "bg-muted" }
  }
}

export function CalendarEventCard({
  id,
  title,
  schedule,
  timezone,
  status,
  nextRun,
  lastRun,
  avgDuration: _avgDuration,
  runCount,
  conflictDetected,
  conflictingChains,
  snoozedUntil,
  enabled,
  onToggle,
  onRunNow,
  onSnooze,
  onUnsnooze,
  onEdit,
  onHistory,
  className,
}: CalendarEventCardProps) {
  const statusBadge = getStatusBadgeProps(status)

  return (
    <div
      data-slot="calendar-event-card"
      data-status={status}
      className={cn(
        "group relative rounded-md p-4 bg-card transition-colors",
        "hover:bg-muted",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-medium truncate">{title}</h3>
            <Badge variant="secondary" className={cn("text-[10px]", statusBadge.className)}>
              {statusBadge.label}
            </Badge>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-foreground/40 font-mono">
            <code>{schedule}</code>
          </div>
        </div>

        {enabled !== undefined && onToggle && (
          <Switch
            checked={enabled}
            onCheckedChange={(checked) => onToggle(id, checked)}
            className="shrink-0"
          />
        )}
      </div>

      {/* Conflict Alert */}
      {conflictDetected && conflictingChains && conflictingChains.length > 0 && (
        <div className="mb-3 flex items-center gap-2 rounded-sm bg-orange-500/10 px-3 py-2">
          <AlertTriangle className="h-3 w-3 shrink-0 text-orange-400" />
          <span className="text-[10px] text-orange-200">
            Conflicts with: {conflictingChains.join(", ")}
          </span>
        </div>
      )}

      {/* Snooze Alert */}
      {status === "snoozed" && snoozedUntil && (
        <div className="mb-3 flex items-center justify-between rounded-sm bg-yellow-500/10 px-3 py-2">
          <span className="text-[10px] text-yellow-200">
            Snoozed until {new Date(snoozedUntil).toLocaleTimeString()}
          </span>
          {onUnsnooze && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onUnsnooze(id)}
              className="h-5 text-[10px] px-2"
            >
              Resume
            </Button>
          )}
        </div>
      )}

      {/* Meta Info */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3 text-[10px]">
        <div className="flex items-center gap-1.5 text-foreground/50">
          <Globe className="h-3 w-3 shrink-0" />
          <span className="truncate">{timezone}</span>
        </div>
        <div className="flex items-center gap-1.5 text-foreground/50">
          <Clock className="h-3 w-3 shrink-0" />
          <span className="truncate">{formatNextRun(nextRun)}</span>
        </div>
        {lastRun && (
          <div className="flex items-center gap-1.5 text-foreground/50">
            <History className="h-3 w-3 shrink-0" />
            <span className="truncate">{formatTimeAgo(lastRun)}</span>
          </div>
        )}
        {runCount !== undefined && runCount > 0 && (
          <div className="flex items-center gap-1.5 text-foreground/50">
            <Play className="h-3 w-3 shrink-0" />
            <span>{runCount} runs</span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {onRunNow && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onRunNow(id)}
            disabled={!enabled}
            className="h-7 text-xs"
          >
            <Play className="h-3 w-3 mr-1" />
            Run Now
          </Button>
        )}

        {status !== "snoozed" && onSnooze && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onSnooze(id, "30min")}
            disabled={!enabled}
            className="h-7 text-xs"
          >
            <BellOff className="h-3 w-3 mr-1" />
            Snooze 30m
          </Button>
        )}

        <div className="flex-1" />

        {onHistory && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onHistory(id)}
            className="h-7 text-xs"
          >
            <History className="h-3 w-3 mr-1" />
            History
          </Button>
        )}
        {onEdit && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onEdit(id)}
            className="h-7 text-xs"
          >
            Edit
          </Button>
        )}
      </div>
    </div>
  )
}
