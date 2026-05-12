import * as React from "react"
import { cn } from "@/lib/utils"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export interface DataCardProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string
  value: string | number
  description?: string
  icon?: React.ReactNode
  trend?: {
    value: number
    isPositive: boolean
  }
  size?: "default" | "compact" | "large"
}

const sizeStyles = {
  default: "py-6",
  compact: "py-4",
  large: "py-8",
}

const valueSizeStyles = {
  default: "text-2xl",
  compact: "text-xl",
  large: "text-4xl",
}

export function DataCard({
  title,
  value,
  description,
  icon,
  trend,
  size = "default",
  className,
  ...props
}: DataCardProps) {
  return (
    <Card className={cn(sizeStyles[size], className)} {...props}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {title}
          </CardTitle>
          {icon && (
            <div className="text-muted-foreground opacity-70">
              {icon}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <div className={cn("font-semibold tracking-tight", valueSizeStyles[size])}>
            {value}
          </div>
          {trend && (
            <span className={cn(
              "text-xs font-medium",
              trend.isPositive ? "text-green-600" : "text-red-600"
            )}>
              {trend.isPositive ? "+" : ""}{trend.value}%
            </span>
          )}
        </div>
        {description && (
          <p className="text-xs text-muted-foreground mt-1">
            {description}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
