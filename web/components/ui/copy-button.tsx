"use client";

import { useState, useRef, useCallback } from "react";
import { CopyFilled as Copy, TickCircleFilled as Check } from "@aliimam/icons";
import { cn } from "@/lib/utils";
import { copyToClipboard } from "@/lib/ui/copy-to-clipboard";

interface CopyButtonProps {
  /** text to copy on single click */
  value: string;
  /** object or string to copy on double-click (JSON.stringify'd if object) */
  fullValue?: unknown;
  /** optional display label - defaults to value */
  label?: string;
  /** whether to show the label text alongside the icon */
  showLabel?: boolean;
  /** simple mode - just text prop for basic copy */
  text?: string;
  className?: string;
}

/**
 * Inline copy button that matches the task ID copy pattern.
 * Single click -> copies value (green check)
 * Double click -> copies fullValue as JSON (blue check)
 *
 * Simple usage: <CopyButton text="hello" />
 * Advanced usage: <CopyButton value={id} fullValue={obj} />
 */
export function CopyButton({
  value,
  fullValue,
  label,
  showLabel = true,
  text,
  className,
}: CopyButtonProps) {
  const [state, setState] = useState<"idle" | "id" | "full">("idle");
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clickCount = useRef(0);

  // simple mode: text prop
  const copyValue = text || value;

  const triggerCopy = useCallback((copyText: string, type: "id" | "full") => {
    copyToClipboard(copyText);
    setState(type);
    if (stateTimerRef.current) clearTimeout(stateTimerRef.current);
    stateTimerRef.current = setTimeout(() => setState("idle"), 1500);
  }, []);

  const handleClick = useCallback(() => {
    clickCount.current += 1;

    if (clickCount.current === 1) {
      clickTimerRef.current = setTimeout(() => {
        clickCount.current = 0;
        triggerCopy(copyValue, "id");
      }, 250);
    } else {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      clickCount.current = 0;
      if (fullValue !== undefined) {
        const fullText =
          typeof fullValue === "string"
            ? fullValue
            : JSON.stringify(fullValue, null, 2);
        triggerCopy(fullText, "full");
      } else {
        triggerCopy(copyValue, "id");
      }
    }
  }, [copyValue, fullValue, triggerCopy]);

  const displayLabel = label ?? copyValue;
  const title = fullValue !== undefined
    ? "click to copy · double-click to copy full object"
    : "click to copy";

  return (
    <button
      onClick={handleClick}
      title={title}
      className={cn(
        "flex items-center gap-1 text-[10px] font-mono text-foreground/30 hover:text-foreground/50 transition-colors",
        className
      )}
    >
      {state === "idle" ? (
        <Copy className="h-2.5 w-2.5 shrink-0" />
      ) : state === "full" ? (
        <Check className="h-2.5 w-2.5 shrink-0 text-blue-400" />
      ) : (
        <Check className="h-2.5 w-2.5 shrink-0 text-green-400" />
      )}
      {showLabel && displayLabel}
    </button>
  );
}
