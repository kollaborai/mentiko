import * as React from "react"
import { CheckFilled as Check, CopyFilled as Copy } from "@aliimam/icons"
import { cn } from "@/lib/utils"
import { copyToClipboard } from "@/lib/ui/copy-to-clipboard"
import { Button } from "@/components/ui/button"

export interface CodeBlockProps extends React.HTMLAttributes<HTMLDivElement> {
  code: string
  language?: string
  showLineNumbers?: boolean
  maxHeight?: string
  size?: "sm" | "md" | "lg"
  copyable?: boolean
}

const sizeStyles = {
  sm: "text-xs",
  md: "text-sm",
  lg: "text-base",
}

export function CodeBlock({
  code,
  language = "text",
  showLineNumbers = true,
  maxHeight,
  size = "sm",
  copyable = true,
  className,
  ...props
}: CodeBlockProps) {
  const [copied, setCopied] = React.useState(false)
  const lines = code.split("\n")
  const codeRef = React.useRef<HTMLPreElement>(null)

  const handleCopy = () => {
    if (codeRef.current) {
      copyToClipboard(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className={cn("relative group", className)} {...props}>
      {copyable && (
        <Button
          variant="secondary"
          size="icon-xs"
          onClick={handleCopy}
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity h-7 w-7 bg-muted/80 hover:bg-muted text-muted-foreground"
          aria-label="Copy code"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-green-600" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          <span className="sr-only">{copied ? "Copied" : "Copy code"}</span>
        </Button>
      )}
      <div
        className={cn(
          "rounded-sm bg-card overflow-hidden",
          maxHeight && "overflow-auto"
        )}
        style={{ maxHeight }}
      >
        <div className="flex">
          {showLineNumbers && (
            <div
              className={cn(
                "sticky left-0 select-none border-r border-border/20 bg-card pr-3 pl-3 text-muted-foreground text-right tabular-nums",
                sizeStyles[size]
              )}
              aria-hidden="true"
            >
              {lines.map((_, i) => (
                <div key={i} className="leading-6">
                  {i + 1}
                </div>
              ))}
            </div>
          )}
          <pre
            ref={codeRef}
            className={cn(
              "flex-1 p-4 overflow-x-auto",
              sizeStyles[size]
            )}
          >
            <code className={`language-${language}`}>
              {code}
            </code>
          </pre>
        </div>
      </div>
      {language && language !== "text" && (
        <div className="absolute bottom-2 left-2 px-2 py-0.5 text-xs rounded-sm bg-muted text-muted-foreground">
          {language}
        </div>
      )}
    </div>
  )
}
