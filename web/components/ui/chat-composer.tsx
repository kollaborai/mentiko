"use client"

import { forwardRef, useCallback, useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { RecordCircleFilled as Circle, SendFilled as Send, AttachCircleFilled as Paperclip } from "@aliimam/icons"

export interface ChatComposerProps {
  placeholder?: string
  disabled?: boolean
  loading?: boolean
  online?: boolean
  sessionName?: string
  defaultValue?: string
  value?: string
  onChange?: (value: string) => void
  onSubmit?: (message: string) => void | Promise<void>
  onAttach?: () => void
  maxRows?: number
  className?: string
}

export const ChatComposer = forwardRef<HTMLDivElement, ChatComposerProps>(
  (
    {
      placeholder = "Type a message...",
      disabled = false,
      loading = false,
      online = false,
      sessionName,
      defaultValue = "",
      value,
      onChange,
      onSubmit,
      onAttach,
      maxRows = 4,
      className,
    },
    ref
  ) => {
    const [inputValue, setInputValue] = useState(defaultValue)
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    const currentValue = value ?? inputValue

    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newValue = e.target.value
        if (value === undefined) {
          setInputValue(newValue)
        }
        onChange?.(newValue)
      },
      [onChange, value]
    )

    const handleSubmit = useCallback(async () => {
      if (disabled || loading || !currentValue.trim()) return
      await onSubmit?.(currentValue)
      if (value === undefined) {
        setInputValue("")
      }
    }, [currentValue, disabled, loading, onSubmit, value])

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey && !disabled && !loading) {
          e.preventDefault()
          handleSubmit()
        }
      },
      [handleSubmit, disabled, loading]
    )

    useEffect(() => {
      const textarea = textareaRef.current
      if (!textarea) return

      textarea.style.height = "auto"
      const lineHeight = 20
      const maxHeight = lineHeight * maxRows
      const newHeight = Math.min(textarea.scrollHeight, maxHeight)
      textarea.style.height = `${newHeight}px`
    }, [currentValue, maxRows])

    const canSubmit = currentValue.trim().length > 0

    return (
      <div
        ref={ref}
        className={cn(
          "relative rounded-md bg-muted px-3 py-2",
          "transition-colors",
          className
        )}
      >
        <div className="flex items-start gap-2">
          {/* Status indicator */}
          <Circle
            className={cn(
              "h-2 w-2 shrink-0 mt-2",
              online
                ? "text-green-500 fill-green-500"
                : "text-foreground/30 fill-foreground/30"
            )}
          />

          {/* Session name / status */}
          <div className="shrink-0 pt-0.5">
            {sessionName ? (
              <span className="text-xs font-mono text-foreground/50">
                {sessionName}
              </span>
            ) : (
              <span className="text-xs text-foreground/30">offline</span>
            )}
          </div>

          {/* Input area */}
          <div className="flex-1 min-w-0">
            <textarea
              ref={textareaRef}
              value={currentValue}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder={online ? placeholder : "Session offline - no active agent"}
              disabled={disabled || loading || !online}
              rows={1}
              className={cn(
                "w-full resize-none bg-transparent text-sm font-mono",
                "text-foreground placeholder:text-foreground/30",
                "focus:outline-none",
                "disabled:cursor-not-allowed disabled:opacity-50",
                "scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent"
              )}
              style={{
                minHeight: "20px",
                maxHeight: `${20 * maxRows}px`,
              }}
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 shrink-0 pt-0.5">
            {onAttach && (
              <Button
                size="xs"
                variant="ghost"
                className="h-6 w-6 p-0"
                onClick={onAttach}
                disabled={disabled || loading || !online}
              >
                <Paperclip className="h-3 w-3" />
              </Button>
            )}

            <Button
              size="xs"
              variant={canSubmit && online ? "default" : "ghost"}
              className={cn(
                "h-6 w-6 p-0",
                canSubmit && online && "bg-foreground text-background hover:bg-foreground/90"
              )}
              onClick={handleSubmit}
              disabled={disabled || loading || !online || !canSubmit}
              aria-label="Send message"
            >
              {loading ? (
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : (
                <Send className="h-3 w-3" />
              )}
            </Button>
          </div>
        </div>
      </div>
    )
  }
)

ChatComposer.displayName = "ChatComposer"
