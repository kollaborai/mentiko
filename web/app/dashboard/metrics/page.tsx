"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ChartFilled,
  TrendUpFilled,
  ChartSquareFilled as PieChart,
  ActivityFilled as Activity,
  Webhook,
  ClockFilled as Clock,
  ChartFilled as BarChart3,
  FlashFilled as Zap,
  TickCircleFilled as CheckCircle,
} from "@aliimam/icons";
import { GoalCard } from "@/components/ui/goal-card";
import { PageBanner } from "@/components/ui/page-banner";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { useSharedRuns } from "@/lib/runs-store";

interface Metrics {
  runs: {
    total: number;
    by_status: Record<string, number>;
    by_chain: Record<string, number>;
    success_rate: number;
    avg_duration_ms?: number;
  };
  agents: {
    total: number;
    by_status: Record<string, number>;
  };
  webhooks: {
    total: number;
    delivered: number;
    failed: number;
    pending: number;
    success_rate: number;
  };
  tokens?: {
    total_7d: number;
    input_7d: number;
    output_7d: number;
  };
  system: {
    uptime_ms: number;
    timestamp: string;
  };
  execution_times?: Record<string, { count: number; total_ms: number; avg_ms: number; min_ms: number; max_ms: number; type: string }>;
}

interface Run {
  id: string;
  chain: string;
  chainId?: string;
  goal: string;
  started: string;
  completed?: string;
  status: string;
}

const STATUS_COLORS: Record<string, string> = {
  completed: "#22c55e",
  failed: "#ef4444",
  running: "#3b82f6",
  pending: "#6b7280",
  stopped: "#60a5fa",
  timeout: "#dc2626",
};

function SimpleBarChart({ data }: { data: { label: string; value: number; color?: string }[] }) {
  const max = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="space-y-2">
      {data.map((item, i) => {
        const width = (item.value / max) * 100;
        const color = item.color || STATUS_COLORS[item.label] || "#3b82f6";

        return (
          <div key={i} className="flex items-center gap-2">
            <span className="text-xs text-foreground/60 w-32 truncate">{item.label}</span>
            <div className="flex-1 h-3 bg-muted rounded overflow-hidden">
              <div className="h-full rounded" style={{ width: `${Math.min(width, 100)}%`, backgroundColor: color }} />
            </div>
            <span className="text-xs font-mono w-8 text-right">{item.value}</span>
          </div>
        );
      })}
    </div>
  );
}

function SimplePieChart({ data }: { data: { label: string; value: number; color: string }[] }) {
  const total = data.reduce((sum, d) => sum + d.value, 0);

  const paths = data.map((item, index) => {
    if (total === 0 || item.value === 0) return null;

    let startAngle = 0;
    for (let i = 0; i < index; i++) {
      startAngle += (data[i].value / total) * 360;
    }

    const sliceAngle = (item.value / total) * 360;
    const endAngle = startAngle + sliceAngle;

    const x1 = 50 + 40 * Math.cos((startAngle - 90) * Math.PI / 180);
    const y1 = 50 + 40 * Math.sin((startAngle - 90) * Math.PI / 180);
    const x2 = 50 + 40 * Math.cos((endAngle - 90) * Math.PI / 180);
    const y2 = 50 + 40 * Math.sin((endAngle - 90) * Math.PI / 180);

    const largeArc = sliceAngle > 180 ? 1 : 0;

    return { item, path: `M 50 50 L ${x1} ${y1} A 40 40 0 ${largeArc} 1 ${x2} ${y2} Z` };
  }).filter(Boolean);

  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 100 100" className="w-24 h-24">
        {paths.map((p, i) => p && <path key={i} d={p.path} fill={p.item.color} />)}
        {total === 0 && <circle cx="50" cy="50" r="40" fill="rgba(255,255,255,0.1)" />}
      </svg>
      <div className="space-y-1 flex-1">
        {data.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-2 h-2 rounded" style={{ backgroundColor: item.color }} />
            <span className="text-xs text-foreground/60">{item.label}</span>
            <span className="text-xs font-mono ml-auto">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toString();
}

function formatTimeAgo(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diff = now - then;

  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

export default function MetricsPage() {
  const { fetchWithNamespace } = useNamespaceFetch();
  const { runs: sharedRuns } = useSharedRuns();
  const runs: Run[] = useMemo(() => sharedRuns.slice(0, 10) as Run[], [sharedRuns]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const metricsRes = await fetchWithNamespace("/api/metrics");
      if (metricsRes.ok) {
        const data = await metricsRes.json() as Metrics;
        setMetrics(data);
      }
    } catch (e) {
      console.error("failed to fetch metrics", e);
    } finally {
      setLoading(false);
    }
  }, [fetchWithNamespace]);

  useEffect(() => {
    fetchData();

    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const runsByChain = metrics
    ? Object.entries(metrics.runs.by_chain)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 8)
        .map(([chain, count]) => ({ label: chain, value: count }))
    : [];

  const statusData = metrics
    ? Object.entries(metrics.runs.by_status).map(([status, count]) => ({
        label: status,
        value: count,
        color: STATUS_COLORS[status] || "#6b7280",
      }))
    : [];

  return (
    <div>
      <PageBanner
        title="Metrics"
        subtitle="Run statistics, token usage, webhook delivery rates, and chain performance trends."
        icon={ChartFilled}
        sectionColor="#a0927b"
        actions={[
          { label: "Performance", href: "/settings/performance", icon: TrendUpFilled, iconColor: "#a0927b" },
        ]}
      />
      <div className="px-4 py-3 max-w-6xl mx-auto">

      {loading && !metrics ? (
        <div className="bg-card rounded-md p-8 text-center">
          <p className="text-sm text-foreground/40">loading metrics...</p>
        </div>
      ) : !metrics ? (
        <div className="bg-card rounded-md p-8 text-center">
          <p className="text-sm text-foreground/40">no metrics available</p>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {/* stat cards */}
          <div className="lg:col-span-2 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
            <GoalCard
              id="stat-total-runs"
              title="Total Runs"
              description={metrics.runs.total.toString()}
              icon={<Activity className="h-4 w-4 text-foreground/60" />}
              status="completed"
              meta="All time"
            />
            <GoalCard
              id="stat-success-rate"
              title="Success Rate"
              description={`${metrics.runs.success_rate.toFixed(1)}%`}
              icon={<CheckCircle className="h-4 w-4 text-foreground/60" />}
              status={metrics.runs.success_rate >= 80 ? "completed" : metrics.runs.success_rate >= 50 ? "in_progress" : "blocked"}
              progress={metrics.runs.success_rate}
              meta="Target: 80%"
            />
            <GoalCard
              id="stat-avg-duration"
              title="Avg Duration"
              description={metrics.runs.avg_duration_ms ? formatDuration(metrics.runs.avg_duration_ms) : "-"}
              icon={<Clock className="h-4 w-4 text-foreground/60" />}
              status="completed"
              meta="Per run"
            />
            <GoalCard
              id="stat-total-agents"
              title="Total Agents"
              description={metrics.agents.total.toString()}
              icon={<BarChart3 className="h-4 w-4 text-foreground/60" />}
              status="completed"
              meta="executed"
            />
            <GoalCard
              id="stat-tokens-7d"
              title="Tokens (7d)"
              description={metrics.tokens ? formatTokenCount(metrics.tokens.total_7d) : "-"}
              icon={<Zap className="h-4 w-4 text-foreground/60" />}
              status="completed"
              meta={metrics.tokens ? `${formatTokenCount(metrics.tokens.input_7d)} in / ${formatTokenCount(metrics.tokens.output_7d)} out` : "last 7 days"}
            />
          </div>

          {/* runs by chain */}
          <div className="bg-card rounded-md p-4">
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 className="h-4 w-4 text-foreground/60" />
              <span className="text-sm font-medium">Runs by Chain</span>
            </div>
            {runsByChain.length === 0 ? (
              <p className="text-xs text-foreground/40">no data</p>
            ) : (
              <SimpleBarChart data={runsByChain} />
            )}
          </div>

          {/* status distribution */}
          <div className="bg-card rounded-md p-4">
            <div className="flex items-center gap-2 mb-3">
              <PieChart className="h-4 w-4 text-foreground/60" />
              <span className="text-sm font-medium">run status distribution</span>
            </div>
            {statusData.every((d) => d.value === 0) ? (
              <p className="text-xs text-foreground/40">no data</p>
            ) : (
              <SimplePieChart data={statusData} />
            )}
          </div>

          {/* webhook success rate */}
          <div className="bg-card rounded-md p-4">
            <div className="flex items-center gap-2 mb-3">
              <Webhook className="h-4 w-4 text-foreground/60" />
              <span className="text-sm font-medium">Webhook Success Rate</span>
            </div>
            <div className="flex items-center gap-4">
              <div className="relative w-24 h-24">
                <svg className="w-full h-full transform -rotate-90">
                  <circle cx="48" cy="48" r="40" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="8" />
                  <circle
                    cx="48"
                    cy="48"
                    r="40"
                    fill="none"
                    stroke={metrics.webhooks.success_rate >= 90 ? "#22c55e" : metrics.webhooks.success_rate >= 70 ? "#eab308" : "#ef4444"}
                    strokeWidth="8"
                    strokeDasharray={`${2 * Math.PI * 40}`}
                    strokeDashoffset={`${2 * Math.PI * 40 * (1 - metrics.webhooks.success_rate / 100)}`}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-lg font-semibold">{Math.round(metrics.webhooks.success_rate)}%</span>
                </div>
              </div>
              <div className="space-y-2 flex-1">
                <div className="flex justify-between">
                  <span className="text-xs text-foreground/60">delivered</span>
                  <span className="text-xs font-mono">{metrics.webhooks.delivered}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-foreground/60">failed</span>
                  <span className="text-xs font-mono text-red-400">{metrics.webhooks.failed}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-foreground/60">pending</span>
                  <span className="text-xs font-mono">{metrics.webhooks.pending}</span>
                </div>
              </div>
            </div>
          </div>

          {/* recent runs timeline */}
          <div className="bg-card rounded-md p-4">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="h-4 w-4 text-foreground/60" />
              <span className="text-sm font-medium">Recent Runs</span>
            </div>
            {runs.length === 0 ? (
              <p className="text-xs text-foreground/40">no runs yet</p>
            ) : (
              <div className="space-y-2">
                {runs.slice(0, 6).map((run) => {
                  const statusColor = STATUS_COLORS[run.status] || "#6b7280";
                  return (
                    <div key={run.id} className="flex items-center gap-2 text-xs">
                      <div
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: statusColor }}
                      />
                      <span className="flex-1 truncate text-foreground/80">{run.chain}</span>
                      <span className="text-foreground/40">{formatTimeAgo(run.started)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
