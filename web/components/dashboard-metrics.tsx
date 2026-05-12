"use client";

import { ChartFilled, BotMessageSquare } from "@aliimam/icons";
import { useWorkspace } from "@/lib/workspace-context";
import { useSharedRuns } from "@/lib/runs-store";

interface RunAgent {
  id: string;
  name?: string;
  status: string;
}

interface Run {
  id: string;
  chain: string;
  started: string;
  agents?: RunAgent[];
}

function RunsPerDayChart({ runs }: { runs: Run[] }) {
  const now = new Date();
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // Initialize last 7 days buckets
  const buckets: Array<{ day: string; date: Date; count: number }> = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    buckets.push({ day: dayNames[d.getDay()], date: d, count: 0 });
  }

  // Count runs per day
  for (const run of runs) {
    const runDate = new Date(run.started);
    runDate.setHours(0, 0, 0, 0);
    const bucket = buckets.find((b) => b.date.getTime() === runDate.getTime());
    if (bucket) bucket.count++;
  }

  const maxCount = Math.max(...buckets.map((b) => b.count), 1);
  const barHeight = 48;

  return (
    <div className="flex items-end justify-between gap-1 h-[60px]">
      {buckets.map((b, i) => {
        const height = maxCount > 0 ? (b.count / maxCount) * barHeight : 0;
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <div
              className="w-full bg-blue-500/60 rounded-t-sm transition-all"
              style={{ height: `${Math.max(height, b.count > 0 ? 4 : 0)}px`, minHeight: "2px" }}
            />
            <span className="text-[10px] text-foreground/40">{b.day}</span>
          </div>
        );
      })}
    </div>
  );
}

interface AgentUsage {
  name: string;
  count: number;
}

function TopAgentsList({ runs }: { runs: Run[] }) {
  const counts = new Map<string, number>();

  for (const run of runs) {
    if (!run.agents) continue;
    for (const agent of run.agents) {
      const name = agent.name || agent.id || "unknown";
      counts.set(name, (counts.get(name) || 0) + 1);
    }
  }

  const topAgents: AgentUsage[] = Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  if (topAgents.length === 0) {
    return <p className="text-xs text-foreground/40">No agent data yet</p>;
  }

  const maxCount = Math.max(...topAgents.map((a) => a.count), 1);

  return (
    <div className="space-y-2">
      {topAgents.map((agent, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-[10px] text-foreground/60 w-[60px] truncate" title={agent.name}>
            {agent.name.length > 10 ? agent.name.slice(0, 10) + "..." : agent.name}
          </span>
          <div className="flex-1 h-3 bg-muted rounded-sm overflow-hidden">
            <div
              className="h-full bg-blue-500/60 rounded-sm transition-all"
              style={{ width: `${(agent.count / maxCount) * 100}%` }}
            />
          </div>
          <span className="text-[10px] text-foreground/40 w-4 text-right">{agent.count}</span>
        </div>
      ))}
    </div>
  );
}

export function RunsChart({ className }: { className?: string }) {
  const { workspacePath } = useWorkspace();
  const { runs, loading } = useSharedRuns({ workspacePath });

  return (
    <div className={className}>
      <div className="bg-background border border-border/40 rounded-xl p-3 h-full">
        <div className="flex items-center gap-2 mb-3">
          <ChartFilled className="h-4 w-4" style={{ color: "#5b9ef5" }} />
          <span className="text-xs font-bold tracking-tight">Runs (last 7 days)</span>
        </div>
        {loading ? (
          <div className="h-[60px] flex items-center justify-center">
            <span className="text-xs text-foreground/30">...</span>
          </div>
        ) : (
          <RunsPerDayChart runs={runs} />
        )}
      </div>
    </div>
  );
}

export function TopAgents({ className }: { className?: string }) {
  const { workspacePath } = useWorkspace();
  const { runs, loading } = useSharedRuns({ workspacePath });

  return (
    <div className={className}>
      <div className="bg-background border border-border/40 rounded-xl p-3 h-full">
        <div className="flex items-center gap-2 mb-3">
          <BotMessageSquare className="h-4 w-4" style={{ color: "#b07ee8" }} />
          <span className="text-xs font-bold tracking-tight">Top Agents</span>
        </div>
        {loading ? (
          <div className="h-[80px] flex items-center justify-center">
            <span className="text-xs text-foreground/30">...</span>
          </div>
        ) : (
          <TopAgentsList runs={runs} />
        )}
      </div>
    </div>
  );
}
