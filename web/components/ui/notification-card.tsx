import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { RotateFilled as Loader2, ExportFilled as ArrowUpRight, Code1Filled as Code, LinkFilled as Workflow, Element3Filled as PanelTop } from "@aliimam/icons"

function formatRelativeTime(timestamp: string | Date): string {
  const date = typeof timestamp === "string" ? new Date(timestamp) : timestamp
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
}

export type ActionType = "redirect" | "api_call" | "workflow" | "modal"
export type NotificationActionStyle = "primary" | "danger" | "default"
export type NotificationStatus = "unread" | "read" | "archived"

export interface NotificationAction {
  id: string
  label: string
  type: ActionType
  style?: NotificationActionStyle
  executed?: boolean
}

export interface NotificationCardProps {
  id: string
  title: string
  body: string
  status?: NotificationStatus
  createdAt: string | Date
  actions?: NotificationAction[]
  onMarkAsRead?: (id: string) => void
  onAction?: (notifId: string, actionId: string, actionType: ActionType) => void | Promise<void>
  loadingActionId?: string
  className?: string
}

function getActionIcon(type: ActionType) {
  switch (type) {
    case "redirect":
      return <ArrowUpRight className="h-3.5 w-3.5" />
    case "api_call":
      return <Code className="h-3.5 w-3.5" />
    case "workflow":
      return <Workflow className="h-3.5 w-3.5" />
    case "modal":
      return <PanelTop className="h-3.5 w-3.5" />
  }
}

function getActionStyleClass(style: NotificationActionStyle = "default") {
  switch (style) {
    case "primary":
      return "bg-foreground text-background hover:bg-foreground/90"
    case "danger":
      return "bg-destructive text-destructive-foreground hover:bg-destructive/90"
    default:
      return "bg-muted text-foreground hover:bg-accent"
  }
}

export function NotificationCard({
  id,
  title,
  body,
  status = "unread",
  createdAt,
  actions = [],
  onMarkAsRead,
  onAction,
  loadingActionId,
  className,
}: NotificationCardProps) {
  const handleClick = () => {
    if (status === "unread" && onMarkAsRead) {
      onMarkAsRead(id)
    }
  }

  const handleAction = async (actionId: string, actionType: ActionType) => {
    if (onAction) {
      await onAction(id, actionId, actionType)
    }
  }

  return (
    <div
      data-slot="notification-card"
      data-status={status}
      className={cn(
        "group relative rounded-md p-4 transition-colors cursor-pointer",
        status === "unread" && "bg-accent",
        status === "read" && "bg-card",
        status === "archived" && "bg-muted opacity-60",
        "hover:bg-muted",
        className
      )}
      onClick={handleClick}
    >
      {status === "unread" && (
        <div className="absolute left-0 top-4 bottom-4 w-1 rounded-r-full bg-foreground" />
      )}

      <div className="flex gap-3">
        <div className="flex-1 min-w-0">
          <h4 className={cn(
            "text-sm font-medium leading-tight",
            status === "unread" ? "text-foreground" : "text-foreground/80"
          )}>
            {title}
          </h4>
          <p className="text-xs text-foreground/60 mt-1 leading-relaxed">
            {body}
          </p>
        </div>

        {actions.length > 0 && (
          <div className="flex gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
            {actions.map((action) => {
              const isLoading = loadingActionId === action.id
              return (
                <Button
                  key={action.id}
                  size="xs"
                  variant="ghost"
                  className={cn(
                    "gap-1.5 h-7 px-2 text-xs",
                    getActionStyleClass(action.style),
                    action.executed && "opacity-50",
                    isLoading && "cursor-wait"
                  )}
                  onClick={() => handleAction(action.id, action.type)}
                  disabled={isLoading || action.executed}
                >
                  {isLoading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    getActionIcon(action.type)
                  )}
                  {action.label}
                </Button>
              )
            })}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mt-2">
        <span className="text-[10px] text-foreground/40">
          {formatRelativeTime(createdAt)}
        </span>
        {status === "unread" && (
          <span className="text-[10px] text-foreground/40">click to read</span>
        )}
      </div>
    </div>
  )
}
