import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { CheckFilled as Check, CopyFilled as Copy } from "@aliimam/icons"
import { cn } from "@/lib/utils"
import { copyToClipboard } from "@/lib/ui/copy-to-clipboard"
import { Button } from "@/components/ui/button"

export type CommandOutputVariant = "info" | "success" | "warning" | "error" | "system"

const outputVariants = cva(
  "rounded-md border border-border p-4 font-mono text-sm overflow-x-auto",
  {
    variants: {
      variant: {
        info: "bg-blue-500/5 border-blue-500/20 text-blue-700 dark:text-blue-300",
        success: "bg-green-500/5 border-green-500/20 text-green-700 dark:text-green-300",
        warning: "bg-amber-500/5 border-amber-500/20 text-amber-700 dark:text-amber-300",
        error: "bg-red-500/5 border-red-500/20 text-red-700 dark:text-red-300",
        system: "bg-muted border-muted-foreground/20 text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "system",
    },
  }
)

const iconVariants: Record<CommandOutputVariant, React.ReactNode> = {
  info: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>,
  success: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>,
  warning: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  </svg>,
  error: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>,
  system: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>,
}

export interface CommandOutputProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof outputVariants> {
  command?: string
  output: string
  showTimestamp?: boolean
  timestamp?: Date
  copyable?: boolean
}

export function CommandOutput({
  command,
  output,
  variant = "system",
  showTimestamp = false,
  timestamp,
  copyable = true,
  className,
  ...props
}: CommandOutputProps) {
  const [copied, setCopied] = React.useState(false)

  const handleCopy = () => {
    copyToClipboard(output)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const displayTimestamp = timestamp || new Date()

  return (
    <div className="space-y-2">
      {command && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">$</span>
          <code className="font-mono text-foreground">{command}</code>
        </div>
      )}
      <div className={cn("relative group", outputVariants({ variant }), className)} {...props}>
        <div className="flex items-start gap-3">
          <div className="shrink-0 mt-0.5 opacity-70">
            {iconVariants[variant || "system"]}
          </div>
          <pre className="flex-1 whitespace-pre-wrap break-words text-xs leading-relaxed">
            {output}
          </pre>
          {copyable && (
            <Button
              variant="secondary"
              size="icon-xs"
              onClick={handleCopy}
              className="shrink-0 h-7 w-7 bg-background/50 hover:bg-background opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label="Copy output"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-green-600" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              <span className="sr-only">{copied ? "Copied" : "Copy output"}</span>
            </Button>
          )}
        </div>
        {showTimestamp && (
          <div className="mt-3 pt-3 border-t border-current/10 text-xs opacity-60">
            {displayTimestamp.toLocaleTimeString()}
          </div>
        )}
      </div>
    </div>
  )
}
