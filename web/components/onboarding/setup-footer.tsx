"use client";

import type { ComponentProps, ReactNode } from "react";
import { ArrowLeft2Filled, ArrowRight2Filled, RotateFilled } from "@aliimam/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A button that stays visually alive while an operation runs. Marco's rule:
 * "a button greyed out is not acceptable." So we never pass `disabled` (or
 * Button's `loading` prop, which forces `disabled` under the hood) — instead
 * extra clicks are swallowed by a guard while `busy` is true, and the busy
 * state is communicated with aria-busy, a spinning icon, and a label swap.
 */
export function BusyButton({
  busy = false,
  busyLabel,
  onClick,
  children,
  className,
  variant,
  size,
  type = "button",
  ...rest
}: {
  busy?: boolean;
  busyLabel?: string;
  onClick: () => void;
  children: ReactNode;
} & Omit<ComponentProps<typeof Button>, "onClick" | "disabled" | "loading" | "children">) {
  const guardedClick = () => {
    if (busy) return; // ignore extra clicks while in flight — never via `disabled`
    onClick();
  };

  return (
    <Button
      type={type}
      variant={variant}
      size={size}
      aria-busy={busy || undefined}
      onClick={guardedClick}
      className={cn(className)}
      {...rest}
    >
      {busy && <RotateFilled className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
      {busy && busyLabel ? busyLabel : children}
    </Button>
  );
}

export function SetupFooter({
  onBack,
  backLabel = "Back",
  onNext,
  nextLabel,
  busy = false,
}: {
  onBack?: () => void;
  backLabel?: string;
  onNext: () => void;
  nextLabel: string;
  busy?: boolean;
}) {
  return (
    <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-xs text-foreground/50 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md px-1 py-1"
        >
          <ArrowLeft2Filled className="h-3.5 w-3.5" />
          {backLabel}
        </button>
      ) : (
        <span aria-hidden="true" />
      )}
      <BusyButton busy={busy} busyLabel="Working…" onClick={onNext} className="gap-2">
        {nextLabel}
        <ArrowRight2Filled className="h-4 w-4" />
      </BusyButton>
    </div>
  );
}
