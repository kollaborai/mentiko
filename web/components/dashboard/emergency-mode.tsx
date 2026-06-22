"use client";

import Link from "next/link";
import { DangerFilled as AlertTriangle } from "@aliimam/icons";
import type { Run } from "@/lib/types";

interface DashboardDecision {
  id: string;
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
      href: `/tasks?type=decision&decisionId=${decision.id}`,
      color: "text-amber-400",
    })),
  ].slice(0, 4);

  return (
    <div className="mb-3 rounded-xl border border-border/50 bg-gradient-to-r from-card via-muted/20 to-card p-3 md:mb-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-2.5">
        <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
        <p className="text-xs min-w-0">
          <span className="font-medium">{total} issue{total !== 1 ? "s" : ""}</span>
          <span className="text-muted-foreground ml-1.5">
            {items.map((item, i) => (
              <span key={item.label}>
                {i > 0 && " · "}
                <Link href={item.href} className={`${item.color} hover:underline`}>
                  {item.count} {item.label}{item.count > 1 ? "s" : ""}
                </Link>
              </span>
            ))}
          </span>
        </p>
      </div>
        <div className="grid min-w-0 flex-1 grid-cols-1 gap-1 md:max-w-[72%] md:grid-cols-2">
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
      </div>
    </div>
  );
}
