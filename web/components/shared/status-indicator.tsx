import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

export type StatusIndicatorVariant =
  | "success"
  | "warning"
  | "error"
  | "info"
  | "neutral"
  | "processing"

const indicatorVariants = cva(
  "inline-flex items-center gap-2 text-sm font-medium transition-colors",
  {
    variants: {
      variant: {
        success: "text-green-600 dark:text-green-400",
        warning: "text-amber-600 dark:text-amber-400",
        error: "text-red-600 dark:text-red-400",
        info: "text-blue-600 dark:text-blue-400",
        neutral: "text-gray-600 dark:text-gray-400",
        processing: "text-blue-600 dark:text-blue-400",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  }
)

const dotVariants = cva(
  "rounded-full shrink-0",
  {
    variants: {
      variant: {
        success: "bg-green-500",
        warning: "bg-amber-500",
        error: "bg-red-500",
        info: "bg-blue-500",
        neutral: "bg-gray-400",
        processing: "bg-blue-500 animate-pulse",
      },
      size: {
        sm: "w-1.5 h-1.5",
        md: "w-2 h-2",
        lg: "w-2.5 h-2.5",
      },
    },
    defaultVariants: {
      variant: "neutral",
      size: "md",
    },
  }
)

export interface StatusIndicatorProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof indicatorVariants> {
  label: string
  dotSize?: VariantProps<typeof dotVariants>["size"]
  showDot?: boolean
}

export function StatusIndicator({
  label,
  variant = "neutral",
  dotSize = "md",
  showDot = true,
  className,
  ...props
}: StatusIndicatorProps) {
  return (
    <div className={cn(indicatorVariants({ variant }), className)} {...props}>
      {showDot && <span className={cn(dotVariants({ variant, size: dotSize }))} />}
      <span>{label}</span>
    </div>
  )
}
