"use client";

import { StatusBadge, type Status } from "@/components/common/status-badge";
import Link from "next/link";
import { PlayFilled as Play, ClockFilled as Clock, TickCircleFilled as CheckCircle2, CloseCircleFilled as XCircle, ActivityFilled as Activity, LinkFilled } from "@aliimam/icons";
import type { Run as BaseRun } from "@/lib/types";
import { useWorkspace } from "@/lib/ui-context/workspace-context";
import { useSharedRuns } from "@/lib/runs/runs-store";

interface Run extends Omit<BaseRun, 'status'> {
  status: Status;
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);

  if (diffSec < 60) return `${diffSec}s`;
  if (diffMin < 60) return `${diffMin}m`;
  if (diffHour < 24) return `${diffHour}h`;
  return `${Math.floor(diffHour / 24)}d`;
}

function getStatusIcon(status: string) {
  switch (status) {
    case "running":
      return <Play className="h-3 w-3 text-green-400" />;
    case "pending":
      return <Clock className="h-3 w-3 text-amber-400" />;
    case "completed":
      return <CheckCircle2 className="h-3 w-3 text-blue-400" />;
    case "failed":
      return <XCircle className="h-3 w-3 text-red-400" />;
    default:
      return <Clock className="h-3 w-3 text-foreground/40" />;
  }
}

function getStatusBadge(status: Status) {
  return <StatusBadge status={status} size="sm" />;
}

function extractGoalSummary(goal: string): string {
  if (!goal) return "No goal specified";
  if (goal.startsWith("TASK ID:")) {
    const m = goal.match(/TITLE:\s*([^]+?)(?:\s+(?:TYPE|PRIORITY|DESCRIPTION)\s*:|$)/);
    if (m) return m[1].trim();
  }
  const first = goal.split("\n")[0] || "";
  return first.length > 80 ? first.slice(0, 77) + "..." : first;
}

interface ActiveChainsProps {
  className?: string;
}

export function ActiveChains({ className }: ActiveChainsProps) {
  const { workspacePath } = useWorkspace();
  const { runs: allRuns, loading } = useSharedRuns({ workspacePath });
  const runs = (allRuns as unknown as Run[]).slice(0, 6);

  return (
    <div className={className}>
      <div className="relative bg-background border border-border/40 rounded-xl overflow-hidden h-full">
        <div
          className="absolute inset-0 z-0 pointer-events-none"
          style={{
            backgroundImage: "repeating-linear-gradient(45deg, #b07ee8 0, #b07ee8 1px, transparent 1px, transparent 12px)",
            opacity: 0.06,
          }}
        />
        <div className="relative z-10 flex items-center justify-between px-3 md:px-4 py-3 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <LinkFilled className="h-4 w-4 shrink-0" style={{ color: "#b07ee8" }} />
            <div className="min-w-0">
              <h3 className="text-sm font-bold tracking-tight">Active Chains</h3>
              <p className="text-xs text-foreground/40">
                {runs.filter((r) => r.status === "running").length} running now
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 md:gap-3 shrink-0">
            <div className="flex items-center gap-1.5 text-foreground/30">
              <Activity className="h-3 w-3 animate-pulse" style={{ color: "#5cb88a" }} />
              <span className="text-xs">polling</span>
            </div>
            <Link href="/runs">
              <span className="text-xs text-foreground/50 hover:text-foreground transition-colors whitespace-nowrap">
                view all
              </span>
            </Link>
          </div>
        </div>

        <div className="relative z-10 max-h-64 overflow-y-auto">
          {loading ? (
          <div className="p-4 md:p-6 text-center text-foreground/40 text-sm">
            Loading runs...
          </div>
        ) : runs.length === 0 ? (
          <div className="p-4 md:p-6 text-center text-foreground/40 text-sm">
            No runs yet. Start a chain to see activity here.
          </div>
        ) : (
          runs.map((run, idx) => (
            <Link
              key={run.id}
              href={`/runs?runId=${run.id}`}
              className="block hover:bg-accent transition-colors"
              aria-label={`view run details for ${run.chain}`}
            >
              {idx > 0 && <div className="h-px bg-accent" />}
              <div className="p-3 flex items-start gap-3">
                <div className="mt-0.5 shrink-0">{getStatusIcon(run.status)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-sm font-medium truncate">
                      {run.chain}
                    </span>
                    {getStatusBadge(run.status)}
                  </div>
                  <p className="text-xs text-foreground/40 truncate mb-1">
                    {extractGoalSummary(run.goal)}
                  </p>
                  <p className="text-[10px] text-foreground/30">
                    started {formatRelativeTime(run.started)} ago
                  </p>
                </div>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
    </div>
  );
}
