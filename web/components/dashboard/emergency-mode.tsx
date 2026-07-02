"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDown1Filled, ArrowRight1Filled, DangerFilled as AlertTriangle } from "@aliimam/icons";
import type { Run } from "@/lib/types";

interface DashboardDecision {
  id: string;
  taskId?: string;
  title?: string;
  prompt?: string;
  createdAt?: string;
}

interface EmergencyModeProps {
  failedRuns: Run[];
  stalledRuns: Run[];
  pendingDecisions: DashboardDecision[];
}

function runTitle(run: Run): string {
  const titleMatch = run.goal?.match(/TITLE:\s*(.+)/);
  if (titleMatch) return titleMatch[1].trim();
  return run.goal?.split("\n")[0]?.slice(0, 64) || run.chain || run.id;
}

function decisionTitle(decision: DashboardDecision): string {
  return decision.title || decision.prompt?.slice(0, 64) || decision.id;
}

export function EmergencyMode({ failedRuns, stalledRuns, pendingDecisions }: EmergencyModeProps) {
  const [expanded, setExpanded] = useState(false);
  const items: Array<{ label: string; count: number; href: string; color: string }> = [];

  if (failedRuns.length > 0) {
    items.push({ label: "failed run", count: failedRuns.length, href: "/runs", color: "text-red-400" });
  }
  if (stalledRuns.length > 0) {
    items.push({ label: "stalled run", count: stalledRuns.length, href: "/runs", color: "text-orange-400" });
  }
  if (pendingDecisions.length > 0) {
    items.push({ label: "pending decision", count: pendingDecisions.length, href: "/tasks?type=decision", color: "text-amber-400" });
  }

  if (items.length === 0) return null;

  const total = failedRuns.length + stalledRuns.length + pendingDecisions.length;
  const details = [
    ...failedRuns.slice(0, 2).map((run) => ({
      id: `failed-${run.id}`,
      label: "failed",
      title: runTitle(run),
      href: `/runs?runId=${run.id}`,
      color: "text-red-400",
    })),
    ...stalledRuns.slice(0, 2).map((run) => ({
      id: `stalled-${run.id}`,
      label: "stalled",
      title: runTitle(run),
      href: `/runs?runId=${run.id}`,
      color: "text-orange-400",
    })),
    ...pendingDecisions.slice(0, 2).map((decision) => ({
      id: `decision-${decision.id}`,
      label: "decision",
      title: decisionTitle(decision),
      href: decision.taskId
        ? `/tasks?type=decision&task=${encodeURIComponent(decision.taskId)}`
        : "/tasks?type=decision",
      color: "text-amber-400",
    })),
  ].slice(0, 4);

  return (
    <div className="mb-3 rounded-xl border border-border/50 bg-gradient-to-r from-card via-muted/20 to-card p-3 md:mb-4">
      <button
        type="button"
        onClick={() => setExpanded((next) => !next)}
        className="flex w-full min-w-0 items-center justify-between gap-3 rounded-md px-0 text-left"
        aria-expanded={expanded}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
          <span className="min-w-0 text-xs">
            <span className="font-medium">{total} issue{total !== 1 ? "s" : ""}</span>
            <span className="ml-1.5 text-muted-foreground">
              {items.map((item, i) => (
                <span key={item.label}>
                  {i > 0 && " · "}
                  <span className={item.color}>
                    {item.count} {item.label}{item.count > 1 ? "s" : ""}
                  </span>
                </span>
              ))}
            </span>
          </span>
        </span>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/25 bg-background/45 text-foreground/55 transition-colors hover:border-border/50 hover:bg-accent/40 hover:text-foreground">
          {expanded ? <ArrowDown1Filled className="h-3.5 w-3.5" /> : <ArrowRight1Filled className="h-3.5 w-3.5" />}
        </span>
      </button>
      {expanded && details.length > 0 && (
        <div className="mt-2 grid min-w-0 grid-cols-1 gap-1 md:grid-cols-2">
          {details.map((detail) => (
            <Link
              key={detail.id}
              href={detail.href}
              className="flex min-w-0 items-center gap-2 rounded-md border border-border/25 bg-background/50 px-2 py-1.5 transition-colors hover:border-border/50 hover:bg-accent/40"
            >
              <span className={`shrink-0 text-[10px] font-semibold ${detail.color}`}>{detail.label}</span>
              <span className="min-w-0 truncate text-[11px] text-foreground/70">{detail.title}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
