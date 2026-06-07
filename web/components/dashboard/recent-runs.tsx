"use client";

import Link from "next/link";
import { TickCircleFilled as CheckCircle2, CloseCircleFilled as XCircle, ClockFilled as Clock, InfoCircleFilled as AlertCircle, StopCircleFilled as StopCircle, RouteSquareFilled } from "@aliimam/icons";
import { TimeAgo } from "@/components/shared/time-ago";
import { WaveSpinner } from "@/components/ui/wave-spinner";
import { useSharedRuns } from "@/lib/runs/runs-store";

interface RecentRunsProps {
  className?: string;
}

export function RecentRuns({ className }: RecentRunsProps) {
  const { runs: allRuns, loading } = useSharedRuns();
  const runs = allRuns.slice(0, 5);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "complete":
      case "completed":
        return <CheckCircle2 className="h-3 w-3 text-green-400 shrink-0" />;
      case "error":
      case "failed":
        return <XCircle className="h-3 w-3 text-red-400 shrink-0" />;
      case "running":
        return <Clock className="h-3 w-3 text-amber-400 shrink-0 animate-pulse" />;
      case "stopped":
        return <StopCircle className="h-3 w-3 text-gray-400 shrink-0" />;
      default:
        return <AlertCircle className="h-3 w-3 text-gray-400 shrink-0" />;
    }
  };

  const extractSummary = (goal: string) => {
    const titleMatch = goal?.match(/TITLE:\s*(.+)/);
    if (titleMatch) return titleMatch[1].trim();
    return goal?.split("\n")[0]?.slice(0, 60) || "";
  };

  return (
    <div className={className}>
      <div className="relative bg-background border border-border/40 rounded-xl overflow-hidden h-full">
        <div
          className="absolute inset-0 z-0 pointer-events-none"
          style={{
            backgroundImage: "radial-gradient(#5b9ef5 1px, transparent 1px)",
            backgroundSize: "14px 14px",
            opacity: 0.08,
          }}
        />
        <div className="relative z-10 px-3 md:px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <RouteSquareFilled className="h-4 w-4 shrink-0" style={{ color: "#5b9ef5" }} />
            <div>
              <h3 className="text-sm font-bold tracking-tight">Recent Runs</h3>
              <p className="text-xs text-muted-foreground">Latest executions</p>
            </div>
          </div>
          <Link href="/runs" className="text-[10px] text-muted-foreground/60 hover:text-foreground transition-colors">
            view all
          </Link>
        </div>

        <div className="relative z-10 p-3">
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <WaveSpinner size="sm" color="muted" animation="ripple" />
          </div>
        ) : runs.length === 0 ? (
          <div className="text-center py-6 text-xs text-muted-foreground/50">
            no runs yet
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {runs.map((run) => (
              <Link key={run.id} href={`/runs?runId=${run.id}`} className="block">
                <div className="flex items-center gap-2 rounded-md border border-border/20 bg-gradient-to-r from-muted/90 via-muted/65 to-muted/35 px-2 py-2 transition-colors hover:border-border/35 hover:from-muted hover:via-muted/80 hover:to-accent/35">
                  {getStatusIcon(run.status)}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground/70 truncate">
                      {extractSummary(run.goal) || run.chain}
                    </p>
                    <p className="text-[10px] text-muted-foreground/40 truncate">
                      {run.chain}
                    </p>
                  </div>
                  {(run as unknown as { totalCostDisplay?: string }).totalCostDisplay && (
                    <span className="text-xs text-muted-foreground shrink-0">{(run as unknown as { totalCostDisplay?: string }).totalCostDisplay}</span>
                  )}
                  <TimeAgo date={run.started} format="short" suffix={false} className="text-[10px] text-muted-foreground/40 shrink-0" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
    </div>
  );
}
