"use client";

import { ArrowLeftFilled } from "@aliimam/icons";
import { cn } from "@/lib/utils";

// "Back to list" control for the list-detail split layout. On wide viewports the
// list and detail render side by side so there is nothing to go back to — the
// button hides at `hideFrom` and up. On narrow viewports only the detail is
// visible, so this returns to the list.

const HIDE_CLASS = {
  md: "md:hidden",
  lg: "lg:hidden",
  xl: "xl:hidden",
} as const;

interface BackButtonProps {
  /** Return to the list view. */
  onBack: () => void;
  /** Label next to the arrow. Defaults to "Back". */
  label?: string;
  /** Viewport at which the list+detail become side-by-side and the button
   *  hides. Match the page's breakpoint. Defaults to "lg". */
  hideFrom?: keyof typeof HIDE_CLASS;
  className?: string;
}

export function BackButton({
  onBack,
  label = "Back",
  hideFrom = "lg",
  className,
}: BackButtonProps) {
  return (
    <button
      type="button"
      onClick={onBack}
      className={cn(
        "mb-2 flex items-center gap-1 text-sm font-black text-foreground/40 hover:text-foreground/60",
        HIDE_CLASS[hideFrom],
        className,
      )}
    >
      <ArrowLeftFilled className="h-6 w-6" />
      {label}
    </button>
  );
}
