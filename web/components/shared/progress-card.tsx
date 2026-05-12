import * as React from "react"
import { cn } from "@/lib/utils"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export interface ProgressCardProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string
  value: number
  max?: number
  size?: "default" | "sm" | "lg"
  showValue?: boolean
  color?: "default" | "success" | "warning" | "error"
  label?: string
}

const colorStyles = {
  default: "bg-primary",
  success: "bg-green-500",
  warning: "bg-amber-500",
  error: "bg-red-500",
}

const sizeStyles = {
  default: "h-2",
  sm: "h-1",
  lg: "h-3",
}

export function ProgressCard({
  title,
  value,
  max = 100,
  size = "default",
  showValue = true,
  color = "default",
  label,
  className,
  ...props
}: ProgressCardProps) {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100)

  return (
    <Card className={cn("py-5", className)} {...props}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {title}
          </CardTitle>
          {showValue && (
            <span className="text-sm font-semibold">
              {Math.round(percentage)}%
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className={cn("w-full bg-muted rounded-full overflow-hidden", sizeStyles[size])}>
          <div
            className={cn("h-full rounded-full transition-all duration-500 ease-out", colorStyles[color])}
            style={{ width: `${percentage}%` }}
          />
        </div>
        {label && (
          <p className="text-xs text-muted-foreground">
            {label}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
