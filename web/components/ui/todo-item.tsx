import { ReactNode } from "react";
import { TickCircleFilled as Check, ArrowRight2Filled as ChevronRight, RotateFilled as Loader2 } from "@aliimam/icons";

interface TodoItemProps {
  title: string;
  description?: string;
  completed?: boolean;
  loading?: boolean;
  status?: "pending" | "in-progress" | "completed" | "error";
  onClick?: () => void;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function TodoItem({
  title,
  description,
  completed = false,
  loading = false,
  status = "pending",
  onClick,
  actions,
  children,
  className = "",
}: TodoItemProps) {
  const statusColors = {
    pending: "text-foreground/40",
    "in-progress": "text-blue-400",
    completed: "text-green-400",
    error: "text-red-400",
  };

  const isCompleted = completed || status === "completed";

  return (
    <div
      className={`group flex items-start gap-3 p-2.5 hover:bg-muted rounded-md transition-colors ${className}`}
    >
      {/* Status indicator */}
      <button
        onClick={onClick}
        className={`shrink-0 w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
          isCompleted
            ? "bg-green-500/20 border-green-500/30 text-green-400"
            : "bg-muted border-foreground/10 hover:border-accent"
        }`}
        disabled={loading}
      >
        {loading ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : isCompleted ? (
          <Check className="h-3 w-3" />
        ) : null}
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span
            className={`text-sm font-medium ${
              isCompleted ? "text-foreground/40 line-through" : ""
            }`}
          >
            {title}
          </span>
          {!isCompleted && status !== "pending" && (
            <ChevronRight className={`h-3 w-3 ${statusColors[status]}`} />
          )}
        </div>
        {description && (
          <p className="text-xs text-foreground/40">{description}</p>
        )}
        {children && <div className="mt-2">{children}</div>}
      </div>

      {/* Actions */}
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}
