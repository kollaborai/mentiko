"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DocumentDownloadFilled as Download,
  ClockFilled as Clock,
  TickCircleFilled as CheckCircle2,
  CloseCircleFilled as XCircle,
  DangerFilled as AlertTriangle,
  FlashFilled as Zap,
  Star1Filled as CircleDollarSign,
} from "@aliimam/icons";

interface ApiCall {
  model: string;
  timestamp: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  duration_ms: number;
}

interface AgentPerf {
  id: string;
  name: string;
  session: string;
  started: string;
  start_ms: number;
  status: string;
  end_ms?: number;
  duration_ms: number;
  api_calls: ApiCall[];
  total_calls: number;
  total_tokens: number;
  total_cost_usd: number;
  resource_samples?: Array<{
    timestamp: string;
    cpu_pct?: number;
    mem_pct?: number;
    elapsed?: string;
  }>;
}

interface PerformanceApiResponse {
  run_id: string;
  started: string;
  agents: Record<string, AgentPerf>;
  summary: {
    total_api_calls: number;
    total_tokens: number;
    total_cost_usd: number;
    total_duration_ms: number;
  };
}

interface AgentTiming {
  agentId: string;
  agentName: string;
  status: string;
  started?: string;
  completed?: string;
  duration?: number; // ms
}

interface WebhookTiming {
  event_id: string;
  event_type: string;
  url: string;
  attempts: number;
  status: "delivered" | "failed" | "pending";
  created_at: string;
  updated_at?: string;
  http_code?: number;
  duration?: number; // ms
}

interface CostData {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostCents: number;
  totalCostDisplay: string;
  agentBreakdown: Array<{
    agentId: string;
    agentName?: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costCents: number;
    costDisplay: string;
  }>;
}

interface PerformanceData {
  runId: string;
  started: string;
  completed?: string;
  totalDuration?: number;
  agents: AgentTiming[];
  webhooks: WebhookTiming[];
  totalTokens?: number;
  estimatedCost?: number;
  // new fields from performance api
  perfData?: PerformanceApiResponse;
  costData?: CostData;
}

interface SparklineProps {
  data: number[];
  width: number;
  height: number;
  color?: string;
}

function Sparkline({ data, width, height, color = "#22c55e" }: SparklineProps) {
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;

  const points = data.map((val, i) => {
    const x = (i / (data.length - 1 || 1)) * width;
    const y = height - ((val - min) / range) * height;
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2"
        points={points}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

interface PerformanceTabProps {
  runId?: string | null;
  chainId?: string;
}

export function PerformanceTab({ runId, chainId }: PerformanceTabProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [data, setData] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchPerformanceData = useCallback(async () => {
    if (!runId) return;
    setLoading(true);
    try {
      const [runRes, webhookRes, perfRes, costRes] = await Promise.all([
        fetchWithNamespace(`/api/runs/${runId}`),
        fetchWithNamespace(`/api/webhooks/status?chain=${chainId}`),
        fetchWithNamespace(`/api/performance?run-id=${runId}`),
        fetchWithNamespace(`/api/runs/${runId}/cost`),
      ]);

        const runData = await runRes.json() as { run?: { id?: string; started?: string; completed?: string; agents?: unknown[] } };
        const webhookData = await webhookRes.json() as { deliveries?: WebhookTiming[] };

        const run = runData.run;
        if (!run?.started) {
          setData(null);
          return;
        }

        // parse performance api response
        let apiPerf: PerformanceApiResponse | null = null;
        if (perfRes.ok) {
          apiPerf = await perfRes.json() as PerformanceApiResponse;
        }

        const started = new Date(run.started).getTime();
        const completed = run.completed ? new Date(run.completed).getTime() : Date.now();
        const totalDuration = completed - started;

        const agentTimings: AgentTiming[] = (run.agents || []).map((agent: unknown) => {
          const a = agent as { id?: string; name?: string; status?: string; started?: string; completed?: string };
          const agentStart = a.started ? new Date(a.started).getTime() : started;
          const agentEnd = a.completed ? new Date(a.completed).getTime() : completed;
          return {
            agentId: a.id || "",
            agentName: a.name || a.id || "",
            status: a.status || "unknown",
            started: a.started,
            completed: a.completed,
            duration: agentEnd - agentStart,
          };
        });

        const webhookTimings: WebhookTiming[] = (webhookData.deliveries || [])
          .filter((d) => d.event_id.includes(runId) || d.event_id.includes(chainId || ""))
          .map((d) => ({
            ...d,
            duration: d.updated_at && d.created_at
              ? new Date(d.updated_at).getTime() - new Date(d.created_at).getTime()
              : undefined,
          }));

        let costData: CostData | undefined;
        if (costRes.ok) {
          costData = await costRes.json() as CostData;
        }

        setData({
          runId: run.id || runId,
          started: run.started,
          completed: run.completed,
          totalDuration,
          agents: agentTimings,
          webhooks: webhookTimings,
          perfData: apiPerf || undefined,
          costData,
        });
    } catch (e) {
      console.error("failed to load performance data", e);
    } finally {
      setLoading(false);
    }
  }, [runId, chainId, fetchWithNamespace]);

  useEffect(() => {
    fetchPerformanceData();
    const interval = setInterval(fetchPerformanceData, 5000);
    return () => clearInterval(interval);
  }, [fetchPerformanceData]);

  const handleExport = () => {
    if (!data) return;

    const exportData = {
      runId: data.runId,
      started: data.started,
      completed: data.completed,
      totalDuration: data.totalDuration,
      agents: data.agents,
      webhooks: data.webhooks,
      exportedAt: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `performance-${data.runId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const stats = useMemo(() => {
    if (!data) return null;

    const completedAgents = data.agents.filter((a) => a.status === "complete");
    const avgAgentDuration = completedAgents.length > 0
      ? completedAgents.reduce((sum, a) => sum + (a.duration || 0), 0) / completedAgents.length
      : 0;

    const deliveredWebhooks = data.webhooks.filter((w) => w.status === "delivered");
    const failedWebhooks = data.webhooks.filter((w) => w.status === "failed");
    const webhookSuccessRate = data.webhooks.length > 0
      ? (deliveredWebhooks.length / data.webhooks.length) * 100
      : 0;

    const avgWebhookDuration = deliveredWebhooks.length > 0
      ? deliveredWebhooks.reduce((sum, w) => sum + (w.duration || 0), 0) / deliveredWebhooks.length
      : 0;

    return {
      totalDuration: data.totalDuration || 0,
      completedAgents: completedAgents.length,
      totalAgents: data.agents.length,
      avgAgentDuration,
      totalWebhooks: data.webhooks.length,
      deliveredWebhooks: deliveredWebhooks.length,
      failedWebhooks: failedWebhooks.length,
      webhookSuccessRate,
      avgWebhookDuration,
      // prefer cost API data (from JSONL parsing), fall back to perf API
      totalTokens: data.costData
        ? data.costData.totalInputTokens + data.costData.totalOutputTokens
        : (data.perfData?.summary.total_tokens || 0),
      totalCost: data.costData
        ? data.costData.totalCostCents / 100
        : (data.perfData?.summary.total_cost_usd || 0),
      totalCostDisplay: data.costData?.totalCostDisplay,
      totalApiCalls: data.perfData?.summary.total_api_calls || 0,
    };
  }, [data]);

  const timelineData = useMemo(() => {
    if (!data) return [];

    // create 20-point timeline of agent activity
    const points: number[] = [];
    const now = data.completed ? new Date(data.completed).getTime() : Date.now();
    const start = new Date(data.started).getTime();
    const total = now - start;
    const interval = total / 20;

    for (let i = 0; i < 20; i++) {
      const t = start + interval * i;
      const activeCount = data.agents.filter((a) => {
        const aStart = a.started ? new Date(a.started).getTime() : start;
        const aEnd = a.completed ? new Date(a.completed).getTime() : now;
        return t >= aStart && t <= aEnd;
      }).length;
      points.push(activeCount);
    }
    return points;
  }, [data]);

  if (!runId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-muted-foreground/60">no active run</p>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-muted-foreground/80">loading performance data...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-muted-foreground/60">no performance data available</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      {/* header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium">performance</h2>
          <p className="text-[10px] text-muted-foreground/80 font-mono">{data.runId}</p>
        </div>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleExport}>
          <Download className="h-3 w-3 mr-1" />
          export
        </Button>
      </div>

      {/* summary cards */}
      {stats && (
        <div className="grid grid-cols-5 gap-2">
          <div className="bg-muted/30 rounded-md p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Clock className="h-3 w-3 text-muted-foreground/80" />
              <p className="text-[10px] text-muted-foreground/80 uppercase">total time</p>
            </div>
            <p className="text-lg font-mono">{formatDuration(stats.totalDuration)}</p>
          </div>

          <div className="bg-muted/30 rounded-md p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Zap className="h-3 w-3 text-muted-foreground/80" />
              <p className="text-[10px] text-muted-foreground/80 uppercase">agents</p>
            </div>
            <p className="text-lg font-mono">
              {stats.completedAgents}/{stats.totalAgents}
            </p>
            <p className="text-[9px] text-muted-foreground/60">
              avg {formatDuration(stats.avgAgentDuration || 0)}
            </p>
          </div>

          <div className="bg-muted/30 rounded-md p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <CircleDollarSign className="h-3 w-3 text-green-400/60" />
              <p className="text-[10px] text-muted-foreground/80 uppercase">cost</p>
            </div>
            <p className="text-lg font-mono">
              {stats.totalCostDisplay || `$${(stats.totalCost || 0).toFixed(4)}`}
            </p>
            <p className="text-[9px] text-muted-foreground/60">
              {stats.totalApiCalls || 0} calls
            </p>
          </div>

          <div className="bg-muted/30 rounded-md p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <CheckCircle2 className="h-3 w-3 text-green-400/60" />
              <p className="text-[10px] text-muted-foreground/80 uppercase">webhooks</p>
            </div>
            <p className="text-lg font-mono">
              {stats.deliveredWebhooks}/{stats.totalWebhooks}
            </p>
            <p className="text-[9px] text-muted-foreground/60">
              {stats.webhookSuccessRate.toFixed(0)}% success
            </p>
          </div>

          <div className="bg-muted/30 rounded-md p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <AlertTriangle className="h-3 w-3 text-amber-400/60" />
              <p className="text-[10px] text-muted-foreground/80 uppercase">tokens</p>
            </div>
            <p className="text-lg font-mono">
              {formatNumber(stats.totalTokens || 0)}
            </p>
            <p className="text-[9px] text-muted-foreground/60">total processed</p>
          </div>
        </div>
      )}

      {/* timeline sparkline */}
      {timelineData.length > 0 && (
        <div className="bg-muted/30 rounded-md p-3">
          <p className="text-[10px] text-muted-foreground/80 uppercase mb-2">activity timeline</p>
          <div className="h-16 flex items-end gap-0.5">
            {timelineData.map((val, i) => {
              const height = Math.max(4, (val / Math.max(...timelineData, 1)) * 64);
              return (
                <div
                  key={i}
                  className="flex-1 bg-green-500/30 rounded-t"
                  style={{ height }}
                />
              );
            })}
          </div>
          <Sparkline data={timelineData} width={300} height={64} color="#22c55e" />
        </div>
      )}

      {/* agent timings */}
      <div>
        <p className="text-[10px] text-muted-foreground/80 uppercase tracking-wider mb-2 px-1">
          agent execution times
        </p>
        <div className="space-y-1">
          {data.agents.map((agent) => {
            const statusColor = agent.status === "complete"
              ? "bg-green-500"
              : agent.status === "running"
              ? "bg-amber-500 animate-pulse"
              : agent.status === "error"
              ? "bg-red-500"
              : "bg-gray-500";

            const durationPercent = stats?.totalDuration && agent.duration
              ? Math.min(100, (agent.duration / stats.totalDuration) * 100)
              : 0;

            return (
              <div key={agent.agentId} className="flex items-center gap-2 px-2 py-1.5 rounded bg-muted/30 text-xs">
                <div className={`w-1.5 h-1.5 rounded-full ${statusColor}`} />
                <span className="font-mono text-foreground/60 shrink-0">{agent.agentId}</span>
                <span className="flex-1 truncate">{agent.agentName}</span>
                <span className="font-mono text-muted-foreground/80">
                  {agent.duration ? formatDuration(agent.duration) : "-"}
                </span>
                <div className="w-12 h-1 bg-border/50 rounded overflow-hidden">
                  <div
                    className="h-full bg-primary/60 rounded"
                    style={{ width: `${durationPercent}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* api calls details */}
      {data.perfData && Object.keys(data.perfData.agents || {}).length > 0 && (
        <div>
          <p className="text-[10px] text-muted-foreground/80 uppercase tracking-wider mb-2 px-1">
            api calls by agent
          </p>
          <div className="space-y-2">
            {Object.values(data.perfData.agents).map((agent: AgentPerf) => (
              <div key={agent.id} className="bg-muted/30 rounded-md p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium">{agent.name}</span>
                  <Badge variant="secondary" className={`text-[9px] ${
                    agent.status === "complete"
                      ? "bg-green-500/10 text-green-400"
                      : agent.status === "running"
                      ? "bg-amber-500/10 text-amber-400"
                      : "bg-gray-500/10 text-gray-400"
                  }`}>
                    {agent.status}
                  </Badge>
                </div>
                <div className="grid grid-cols-4 gap-2 text-[10px] text-foreground/60 mb-1">
                  <div>{agent.total_calls} calls</div>
                  <div>{formatNumber(agent.total_tokens)} tokens</div>
                  <div>${agent.total_cost_usd.toFixed(4)}</div>
                  <div>{formatDuration(agent.duration_ms)}</div>
                </div>
                {agent.api_calls.length > 0 && (
                  <div className="space-y-0.5 mt-1">
                    {agent.api_calls.slice(-3).map((call: ApiCall, i: number) => (
                      <div key={i} className="flex items-center gap-2 text-[9px] text-muted-foreground/80 px-1">
                        <span className="font-mono">{call.model.split("-").pop()}</span>
                        <span>{formatNumber(call.total_tokens)}t</span>
                        <span>${call.cost_usd.toFixed(4)}</span>
                        <span className="ml-auto">{new Date(call.timestamp).toLocaleTimeString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* webhook timings */}
      {data.webhooks.length > 0 && (
        <div>
          <p className="text-[10px] text-muted-foreground/80 uppercase tracking-wider mb-2 px-1">
            webhook delivery
          </p>
          <div className="space-y-1">
            {data.webhooks.map((webhook) => {
              const statusIcon = webhook.status === "delivered"
                ? <CheckCircle2 className="h-3 w-3 text-green-400" />
                : webhook.status === "failed"
                ? <XCircle className="h-3 w-3 text-red-400" />
                : <Clock className="h-3 w-3 text-amber-400" />;

              const statusBg = webhook.status === "delivered"
                ? "bg-green-500/10 text-green-400"
                : webhook.status === "failed"
                ? "bg-red-500/10 text-red-400"
                : "bg-amber-500/10 text-amber-400";

              return (
                <div
                  key={webhook.event_id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded bg-muted/30 text-xs"
                >
                  {statusIcon}
                  <Badge variant="secondary" className={`text-[9px] ${statusBg} border-0 shrink-0`}>
                    {webhook.event_type}
                  </Badge>
                  <span className="font-mono text-foreground/60 truncate flex-1">
                    {webhook.url.replace(/^https?:\/\//, "").split("/")[0]}
                  </span>
                  {webhook.duration !== undefined && (
                    <span className="font-mono text-muted-foreground/80">
                      {formatDuration(webhook.duration)}
                    </span>
                  )}
                  {webhook.attempts > 1 && (
                    <Badge variant="outline" className="text-[9px] bg-muted/30">
                      {webhook.attempts}x
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function formatDuration(ms?: number): string {
  if (ms === undefined || ms === null || isNaN(ms)) return "-";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}
