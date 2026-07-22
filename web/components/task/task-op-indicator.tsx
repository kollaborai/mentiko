"use client";

// Compact operational-attention indicator for task rows and the Operations
// Timeline. Each state gets its own glyph + color — never one collapsed red
// dot — and every glyph's tooltip carries the causal detail from the server
// read model (/api/operations/timeline), which derives it from persisted state.

import {
  ArrowDownFilled,
  ArrowUpFilled,
  DangerFilled,
  JudgeFilled,
  NextFilled,
  PauseCircleFilled,
  PlayFilled,
  ShieldCrossFilled,
} from "@aliimam/icons";
import { cn } from "@/lib/utils";
import type { TaskOpReason } from "@/lib/operations/operations-classify";

/** Serialized subset of the read model's OpsTaskState a row indicator needs. */
export interface TaskOpIndicatorState {
  reason: TaskOpReason;
  detail: string;
  blockingTaskIds: string[];
  blockedDownstreamTaskIds: string[];
  /** 1-based position in the Expected Next queue, when the task is queued. */
  expectedNextPosition?: number;
}

function chip(
  key: string,
  icon: React.ReactNode,
  label: string | null,
  className: string,
  title: string,
) {
  return (
    <span
      key={key}
      title={title}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px]",
        className,
      )}
    >
      {icon}
      {label ? <span>{label}</span> : null}
    </span>
  );
}

export function TaskOpIndicator({
  state,
  hide = [],
}: {
  state?: TaskOpIndicatorState;
  /** Chips the surrounding row already communicates (e.g. its own run link). */
  hide?: Array<"running" | "paused">;
}) {
  if (!state) return null;
  const chips: React.ReactNode[] = [];

  if (state.reason === "running" && !hide.includes("running")) {
    chips.push(chip(
      "running",
      <PlayFilled className="h-2.5 w-2.5" />,
      null,
      "bg-sky-500/15 text-sky-300",
      state.detail,
    ));
  }
  if (state.expectedNextPosition !== undefined) {
    chips.push(chip(
      "next",
      <NextFilled className="h-2.5 w-2.5" />,
      `#${state.expectedNextPosition}`,
      "bg-emerald-500/15 text-emerald-300",
      `Expected next (position ${state.expectedNextPosition}) — ${state.detail}`,
    ));
  }
  if (state.reason === "blocked_error" || state.reason === "unknown_inconsistent_state"
    || state.reason === "stale_run_scope") {
    chips.push(chip(
      "failed",
      <DangerFilled className="h-2.5 w-2.5" />,
      null,
      "bg-red-500/15 text-red-400",
      state.detail,
    ));
  }
  if (state.reason === "outcome_audit_failed") {
    chips.push(chip(
      "audit-failed",
      <ShieldCrossFilled className="h-2.5 w-2.5" />,
      "audit",
      "bg-red-500/15 text-red-400",
      state.detail,
    ));
  }
  if (state.reason === "blocked_dependency" || state.reason === "blocked_failed_dependency") {
    chips.push(chip(
      "blocked-by",
      <ArrowUpFilled className="h-2.5 w-2.5" />,
      String(state.blockingTaskIds.length),
      state.reason === "blocked_failed_dependency"
        ? "bg-red-500/15 text-red-400"
        : "bg-foreground/5 text-foreground/50",
      state.detail,
    ));
  }
  if (state.blockedDownstreamTaskIds.length > 0) {
    chips.push(chip(
      "blocks",
      <ArrowDownFilled className="h-2.5 w-2.5" />,
      String(state.blockedDownstreamTaskIds.length),
      "bg-amber-500/15 text-amber-300",
      `Blocking ${state.blockedDownstreamTaskIds.length} open downstream task${state.blockedDownstreamTaskIds.length === 1 ? "" : "s"}: ${state.blockedDownstreamTaskIds.slice(0, 8).join(", ")}${state.blockedDownstreamTaskIds.length > 8 ? "…" : ""}`,
    ));
  }
  if (state.reason === "waiting_human_decision") {
    chips.push(chip(
      "review",
      <JudgeFilled className="h-2.5 w-2.5" />,
      null,
      "bg-blue-500/15 text-blue-300",
      state.detail,
    ));
  }
  if ((state.reason === "paused_retries_exhausted" || state.reason === "paused_manual")
    && !hide.includes("paused")) {
    chips.push(chip(
      "paused",
      <PauseCircleFilled className="h-2.5 w-2.5" />,
      null,
      "bg-orange-500/15 text-orange-300",
      state.detail,
    ));
  }

  if (chips.length === 0) return null;
  return <span className="inline-flex flex-wrap items-center gap-1">{chips}</span>;
}
