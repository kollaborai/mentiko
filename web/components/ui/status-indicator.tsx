import { cn } from "@/lib/utils";

export type StatusState =
  | "active"
  | "running"
  | "down"
  | "error"
  | "failed"
  | "fixing"
  | "warning"
  | "pending"
  | "paused"
  | "idle"
  | "completed"
  | "complete"
  | "connected"
  | "connecting";

export interface StatusIndicatorProps {
  state?: StatusState;
  color?: string;
  label?: string;
  className?: string;
  size?: "xs" | "sm" | "md" | "lg";
  labelClassName?: string;
}

const getStateColors = (state: StatusState) => {
  switch (state) {
    case "active":
    case "running":
    case "connected":
      return { dot: "bg-green-500", ping: "bg-green-300" };
    case "down":
    case "error":
    case "failed":
      return { dot: "bg-red-500", ping: "bg-red-300" };
    case "fixing":
    case "warning":
      return { dot: "bg-amber-500", ping: "bg-amber-300" };
    case "pending":
    case "connecting":
      return { dot: "bg-blue-500", ping: "bg-blue-300" };
    case "paused":
      return { dot: "bg-purple-500", ping: "bg-purple-300" };
    case "completed":
    case "complete":
      return { dot: "bg-green-500", ping: "" };
    case "idle":
    default:
      return { dot: "bg-muted-foreground/30", ping: "" };
  }
};

const getShouldAnimate = (state: StatusState): boolean => {
  return ["active", "running", "connected", "down", "error", "failed", "fixing", "warning", "pending", "connecting"].includes(state);
};

const getSizeClasses = (size: StatusIndicatorProps["size"]) => {
  switch (size) {
    case "xs":
      return { dot: "h-1.5 w-1.5", ping: "h-1.5 w-1.5" };
    case "sm":
      return { dot: "h-2 w-2", ping: "h-2 w-2" };
    case "lg":
      return { dot: "h-4 w-4", ping: "h-4 w-4" };
    case "md":
    default:
      return { dot: "h-3 w-3", ping: "h-3 w-3" };
  }
};

export function StatusIndicator({
  state = "idle",
  color,
  label,
  className,
  size = "md",
  labelClassName
}: StatusIndicatorProps) {
  const shouldAnimate = getShouldAnimate(state);
  const colors = getStateColors(state);
  const sizeClasses = getSizeClasses(size);

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="relative flex items-center">
        {shouldAnimate && colors.ping && (
          <span
            className={cn(
              "absolute inline-flex rounded-full opacity-75 animate-ping",
              sizeClasses.ping,
              colors.ping
            )}
          />
        )}
        <span
          className={cn(
            "relative inline-flex rounded-full",
            sizeClasses.dot,
            color || colors.dot
          )}
        />
      </div>
      {label && (
        <p
          className={cn(
            "text-sm text-muted-foreground",
            labelClassName
          )}
        >
          {label}
        </p>
      )}
    </div>
  );
}

export default StatusIndicator;
