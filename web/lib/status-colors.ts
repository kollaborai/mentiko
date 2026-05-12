/**
 * Shared status color mappings for sidebar items, pills, and accent bars.
 * Used across all pages for consistent status visualization.
 *
 * Semantics:
 *   running    = amber   (in progress)
 *   complete/d = green   (success)
 *   error      = red     (failure)
 *   stopped    = orange  (needs attention)
 *   cancelled  = zinc    (intentional, no big deal)
 *   pending    = neutral (waiting)
 */

/** Accent bar colors (left edge of sidebar items) */
export const STATUS_BAR: Record<string, string> = {
  running: "bg-amber-400",
  complete: "bg-emerald-400",
  completed: "bg-emerald-400",
  error: "bg-red-400",
  stopped: "bg-orange-400",
  cancelled: "bg-zinc-400",
  pending: "bg-foreground/20",
};

/** Status pill styles (bg + text color) */
export const STATUS_PILL: Record<string, string> = {
  running: "bg-amber-500/15 text-amber-400",
  complete: "bg-emerald-500/15 text-emerald-400",
  completed: "bg-emerald-500/15 text-emerald-400",
  error: "bg-red-500/15 text-red-400",
  stopped: "bg-orange-500/15 text-orange-400",
  cancelled: "bg-zinc-500/15 text-zinc-400",
  pending: "bg-foreground/5 text-foreground/40",
};

/** Display label for status (e.g. "complete" -> "done") */
export function statusLabel(status: string): string {
  if (status === "complete" || status === "completed") return "done";
  return status;
}

/** Get accent bar class for a status, with fallback */
export function statusBar(status: string): string {
  return STATUS_BAR[status] || "bg-foreground/20";
}

/** Get pill class for a status, with fallback */
export function statusPill(status: string): string {
  return STATUS_PILL[status] || "bg-foreground/5";
}
