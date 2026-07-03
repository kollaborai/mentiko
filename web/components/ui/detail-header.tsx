"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Animated dot-grid background
// ---------------------------------------------------------------------------
// Layered radial-gradients paint a masked dot matrix (first two layers) over
// a slow-moving, hue-cycling RGB wash (last four). Applied at very low opacity
// as a decorative header backdrop. Two keyframes drive it: gradient-dots-move
// (40s pan) + gradient-dots-hue (8s color cycle) — both defined in globals.css.
const DOT_STYLE = {
  backgroundColor: "var(--background)",
  backgroundImage:
    "radial-gradient(circle at 50% 50%, transparent 1.5px, var(--background) 0 6px, transparent 6px), " +
    "radial-gradient(circle at 50% 50%, transparent 1.5px, var(--background) 0 6px, transparent 6px), " +
    "radial-gradient(circle at 50% 50%, #f00, transparent 60%), " +
    "radial-gradient(circle at 50% 50%, #ff0, transparent 60%), " +
    "radial-gradient(circle at 50% 50%, #0f0, transparent 60%), " +
    "radial-gradient(ellipse at 50% 50%, #00f, transparent 60%)",
  backgroundSize:
    "12px 20.784px, 12px 20.784px, 200% 200%, 200% 200%, 200% 200%, 200% 20.784px",
  backgroundPosition: "0px 0px, 6px 10.392px, 0% 0%, 0% 0%, 0% 0px",
  animation:
    "40s linear 0s infinite normal none running gradient-dots-move, " +
    "8s linear 0s infinite normal none running gradient-dots-hue",
} as const;

// ---------------------------------------------------------------------------
// Base container
// ---------------------------------------------------------------------------
// The rounded, muted header shell. Renders the dot-grid backdrop as an
// absolutely-positioned overlay behind arbitrary children.
interface DetailHeaderProps {
  children: ReactNode;
  className?: string;
}

export function DetailHeader({ children, className = "" }: DetailHeaderProps) {
  return (
    <div
      className={`relative flex items-center justify-between bg-muted dark:bg-[#0a0a0a] rounded-md px-4 py-3 overflow-hidden ${className}`}
    >
      <div
        className="absolute inset-0 opacity-[0.07] pointer-events-none"
        style={DOT_STYLE}
      />
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Identity / actions split layout
// ---------------------------------------------------------------------------
/**
 * Identity (title/badges/meta) + actions (buttons) split for detail-panel
 * headers that live in a narrow sidebar column. Wraps naturally by content
 * width via flex-wrap instead of switching layout at a viewport breakpoint —
 * viewport breakpoints (sm:/xl:) don't know how wide the panel itself is,
 * which causes the actions block to get squeezed and overlap in narrow
 * columns even on a wide browser window.
 */
interface HeaderSplitProps {
  identity: ReactNode;
  actions: ReactNode;
  identityClassName?: string;
  actionsClassName?: string;
}

function HeaderSplitChildren({ identity, actions, identityClassName, actionsClassName }: HeaderSplitProps) {
  return (
    <>
      <div className={cn("relative flex min-w-0 flex-1 basis-72 items-center gap-3", identityClassName)}>
        {identity}
      </div>
      <div className={cn("relative flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-2 text-xs", actionsClassName)}>
        {actions}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Public split variants
// ---------------------------------------------------------------------------
// SplitDetailHeader: the split layout inside the styled DetailHeader shell
// (dot-grid backdrop + muted background). Use for standalone panel headers.
export function SplitDetailHeader({
  identity,
  actions,
  identityClassName,
  actionsClassName,
  className,
}: HeaderSplitProps & { className?: string }) {
  return (
    <DetailHeader className={cn("flex-wrap items-center justify-between gap-3", className)}>
      <HeaderSplitChildren
        identity={identity}
        actions={actions}
        identityClassName={identityClassName}
        actionsClassName={actionsClassName}
      />
    </DetailHeader>
  );
}

// HeaderSplitRow: the same split layout with NO shell — a bare flex row for
// embedding the identity/actions pattern inside an existing header container.
export function HeaderSplitRow({
  identity,
  actions,
  identityClassName,
  actionsClassName,
  className,
}: HeaderSplitProps & { className?: string }) {
  return (
    <div className={cn("flex w-full flex-wrap items-center justify-between gap-3", className)}>
      <HeaderSplitChildren
        identity={identity}
        actions={actions}
        identityClassName={identityClassName}
        actionsClassName={actionsClassName}
      />
    </div>
  );
}
