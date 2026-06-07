"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useEffect, useMemo, useCallback } from "react";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge, type Status } from "@/components/common/status-badge";
import { ArrowLeftFilled, ArrowRightFilled, ClockFilled as Clock, ArrowSwapFilled as ArrowUpDown, Star1Filled as DollarSign, FlashFilled as Zap, DocumentTextFilled as FileText, AddFilled as Plus, MinusFilled as Minus, DocumentDownloadFilled as Download } from "@aliimam/icons";
import { exportComparisonJSON, exportComparisonPDF } from "@/lib/system/export-comparison";

interface DiffPart {
  type: "added" | "removed" | "unchanged";
  value: string;
}

interface AgentComparison {
  agentId: string;
  nameA: string;
  nameB: string;
  statusA: string;
  statusB: string;
  outputDiff?: DiffPart[];
}

interface MetricsDiff {
  duration: number;
  durationPercent: number;
  tokens: number;
  tokensPercent: number;
  cost: number;
  costPercent: number;
  agentCount: number;
}

interface PerformanceData {
  summary: {
    total_tokens: number;
    total_cost_usd: number;
    total_duration_ms: number;
    total_api_calls: number;
  };
  agents: Record<string, {
    id: string;
    name: string;
    total_calls: number;
    total_tokens: number;
    total_cost_usd: number;
    duration_ms: number;
  }>;
}

interface RunData {
  id: string;
  chain: string;
  goal: string;
  started: string;
  completed?: string;
  status: string;
  agents: Array<{ id: string; name: string; status: string }>;
}

interface ComparisonData {
  runA: RunData;
  runB: RunData;
  metricsDiff: MetricsDiff;
  agentComparison: AgentComparison[];
  perfA?: PerformanceData;
  perfB?: PerformanceData;
}

export default function ComparePage() {
  const params = useParams();
  const router = useRouter();
  const chainId = params.id as string;
  const runIdA = params.runA as string;
  const runIdB = params.runB as string;

  const { fetchWithNamespace } = useNamespaceFetch();
  const [comparison, setComparison] = useState<ComparisonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  const loadComparison = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithNamespace(`/api/runs/compare?runA=${runIdA}&runB=${runIdB}`);
      if (res.ok) {
        const data = await res.json();
        setComparison(data);
        if (data.agentComparison?.length > 0) {
          setSelectedAgent(data.agentComparison[0].agentId);
        }
      } else {
        const err = await res.json();
        setError(err.error || "Failed to load comparison");
      }
    } catch (e) {
      console.error("failed to load comparison", e);
      setError("Failed to load comparison");
    } finally {
      setLoading(false);
    }
  }, [runIdA, runIdB, fetchWithNamespace]);

  useEffect(() => {
    if (runIdA && runIdB) {
      loadComparison();
    }
  }, [runIdA, runIdB, loadComparison]);

  const swapRuns = () => {
    router.push(`/chains/${chainId}/compare/${runIdB}/${runIdA}`);
  };

  const selectedAgentData = useMemo(() => {
    if (!comparison || !selectedAgent) return null;
    return comparison.agentComparison.find((a) => a.agentId === selectedAgent);
  }, [comparison, selectedAgent]);

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    return `${mins}m ${secs}s`;
  };

  const formatNumber = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
  };

  const DiffBadge = ({ value, percent }: { value: number; percent: number }) => {
    const isPositive = value > 0;
    const isNegative = value < 0;
    const color = isNegative ? "text-green-400" : isPositive ? "text-red-400" : "text-foreground/60";
    const icon = isNegative ? <Minus className="h-3 w-3" /> : isPositive ? <Plus className="h-3 w-3" /> : null;

    return (
      <div className={`flex items-center gap-1 ${color}`}>
        {icon}
        <span className="text-xs font-mono">
          {isNegative ? "" : isPositive ? "+" : ""}{value.toFixed(2)}
        </span>
        <span className="text-[10px] text-foreground/40">({percent.toFixed(1)}%)</span>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <p className="text-xs text-foreground/40">loading comparison...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-xs text-red-400">{error}</p>
        <Button size="sm" variant="secondary" onClick={() => router.back()}>
          <ArrowLeftFilled className="h-3 w-3 mr-1" />
          go back
        </Button>
      </div>
    );
  }

  if (!comparison) {
    return (
      <div className="h-screen flex items-center justify-center">
        <p className="text-xs text-foreground/40">no comparison data</p>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      {/* header */}
      <div className="bg-accent p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-4">
            <Button size="sm" variant="ghost" className="h-7" onClick={() => router.back()}>
              <ArrowLeftFilled className="h-3 w-3 mr-1" />
              back
            </Button>
            <p className="text-xs font-semibold">run comparison</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              className="h-7 text-xs"
              onClick={() => exportComparisonJSON(comparison)}
            >
              <Download className="h-3 w-3 mr-1" />
              json
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="h-7 text-xs"
              onClick={() => exportComparisonPDF(comparison)}
            >
              <Download className="h-3 w-3 mr-1" />
              pdf
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex-1">
            <p className="text-[10px] text-foreground/40 uppercase tracking-wider mb-1">run a</p>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono">{comparison.runA.id.slice(-8)}</span>
              <StatusBadge status={comparison.runA.status as Status} size="sm" />
            </div>
            <p className="text-[10px] text-foreground/40 mt-1 truncate">{comparison.runA.goal}</p>
          </div>

          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={swapRuns}>
            <ArrowUpDown className="h-4 w-4 text-foreground/40" />
          </Button>

          <div className="flex-1">
            <p className="text-[10px] text-foreground/40 uppercase tracking-wider mb-1">run b</p>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono">{comparison.runB.id.slice(-8)}</span>
              <StatusBadge status={comparison.runB.status as Status} size="sm" />
            </div>
            <p className="text-[10px] text-foreground/40 mt-1 truncate">{comparison.runB.goal}</p>
          </div>
        </div>
      </div>

      <Tabs defaultValue="metrics" className="flex-1 flex flex-col overflow-hidden">
        <div className="bg-accent px-4">
          <TabsList className="h-8 bg-transparent">
            <TabsTrigger value="metrics" className="text-xs">metrics</TabsTrigger>
            <TabsTrigger value="agents" className="text-xs">agents</TabsTrigger>
            <TabsTrigger value="output" className="text-xs">output diff</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="metrics" className="flex-1 overflow-y-auto p-4 space-y-4 m-0">
          {/* summary cards */}
          <div className="grid grid-cols-4 gap-3">
            <Card className="p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Clock className="h-3.5 w-3.5 text-foreground/40" />
                <p className="text-[10px] text-foreground/40 uppercase">duration</p>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-mono">{formatDuration(Math.abs(comparison.metricsDiff.duration))}</p>
                  <p className="text-[9px] text-foreground/30">difference</p>
                </div>
                <DiffBadge value={comparison.metricsDiff.duration} percent={comparison.metricsDiff.durationPercent} />
              </div>
              <div className="mt-2 pt-2 grid grid-cols-2 gap-2 text-[9px]">
                <div>
                  <span className="text-foreground/40">a: </span>
                  <span className="font-mono">{formatDuration(comparison.perfA?.summary.total_duration_ms || 0)}</span>
                </div>
                <div>
                  <span className="text-foreground/40">b: </span>
                  <span className="font-mono">{formatDuration(comparison.perfB?.summary.total_duration_ms || 0)}</span>
                </div>
              </div>
            </Card>

            <Card className="p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Zap className="h-3.5 w-3.5 text-foreground/40" />
                <p className="text-[10px] text-foreground/40 uppercase">tokens</p>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-mono">{formatNumber(Math.abs(comparison.metricsDiff.tokens))}</p>
                  <p className="text-[9px] text-foreground/30">difference</p>
                </div>
                <DiffBadge value={comparison.metricsDiff.tokens} percent={comparison.metricsDiff.tokensPercent} />
              </div>
              <div className="mt-2 pt-2 grid grid-cols-2 gap-2 text-[9px]">
                <div>
                  <span className="text-foreground/40">a: </span>
                  <span className="font-mono">{formatNumber(comparison.perfA?.summary.total_tokens || 0)}</span>
                </div>
                <div>
                  <span className="text-foreground/40">b: </span>
                  <span className="font-mono">{formatNumber(comparison.perfB?.summary.total_tokens || 0)}</span>
                </div>
              </div>
            </Card>

            <Card className="p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <DollarSign className="h-3.5 w-3.5 text-green-400/60" />
                <p className="text-[10px] text-foreground/40 uppercase">cost</p>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-mono">${Math.abs(comparison.metricsDiff.cost).toFixed(4)}</p>
                  <p className="text-[9px] text-foreground/30">difference</p>
                </div>
                <DiffBadge value={comparison.metricsDiff.cost} percent={comparison.metricsDiff.costPercent} />
              </div>
              <div className="mt-2 pt-2 grid grid-cols-2 gap-2 text-[9px]">
                <div>
                  <span className="text-foreground/40">a: </span>
                  <span className="font-mono">${(comparison.perfA?.summary.total_cost_usd || 0).toFixed(4)}</span>
                </div>
                <div>
                  <span className="text-foreground/40">b: </span>
                  <span className="font-mono">${(comparison.perfB?.summary.total_cost_usd || 0).toFixed(4)}</span>
                </div>
              </div>
            </Card>

            <Card className="p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <FileText className="h-3.5 w-3.5 text-foreground/40" />
                <p className="text-[10px] text-foreground/40 uppercase">agents</p>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-mono">{comparison.metricsDiff.agentCount > 0 ? "+" : ""}{comparison.metricsDiff.agentCount}</p>
                  <p className="text-[9px] text-foreground/30">difference</p>
                </div>
                {comparison.metricsDiff.agentCount !== 0 && (
                  <Badge variant="secondary" className={`text-[9px] ${
                    comparison.metricsDiff.agentCount > 0 ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
                  }`}>
                    {comparison.metricsDiff.agentCount > 0 ? <Plus className="h-3 w-3 mr-1" /> : <Minus className="h-3 w-3 mr-1" />}
                    {Math.abs(comparison.metricsDiff.agentCount)}
                  </Badge>
                )}
              </div>
              <div className="mt-2 pt-2 grid grid-cols-2 gap-2 text-[9px]">
                <div>
                  <span className="text-foreground/40">a: </span>
                  <span className="font-mono">{comparison.runA.agents?.length || 0}</span>
                </div>
                <div>
                  <span className="text-foreground/40">b: </span>
                  <span className="font-mono">{comparison.runB.agents?.length || 0}</span>
                </div>
              </div>
            </Card>
          </div>

          {/* per-agent metrics table */}
          {comparison.perfA?.agents && comparison.perfB?.agents && (
            <div>
              <p className="text-[10px] text-foreground/40 uppercase tracking-wider mb-2 px-1">
                agent metrics comparison
              </p>
              <Card className="overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th className="text-left p-2 text-[10px] text-foreground/40 font-normal">agent</th>
                      <th className="text-right p-2 text-[10px] text-foreground/40 font-normal">tokens a</th>
                      <th className="text-right p-2 text-[10px] text-foreground/40 font-normal">tokens b</th>
                      <th className="text-right p-2 text-[10px] text-foreground/40 font-normal">cost a</th>
                      <th className="text-right p-2 text-[10px] text-foreground/40 font-normal">cost b</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.values({ ...comparison.perfA.agents, ...comparison.perfB.agents }).map((agent) => {
                      const agentA = comparison.perfA?.agents[agent.id];
                      const agentB = comparison.perfB?.agents[agent.id];

                      if (!agentA && !agentB) return null;

                      const tokensA = agentA?.total_tokens || 0;
                      const tokensB = agentB?.total_tokens || 0;
                      const costA = agentA?.total_cost_usd || 0;
                      const costB = agentB?.total_cost_usd || 0;
                      const tokensDiff = tokensB - tokensA;
                      const costDiff = costB - costA;

                      return (
                        <tr key={agent.id}>
                          <td className="p-2">
                            <span className="font-mono text-foreground/60">{agent.id}</span>
                            <span className="ml-2 text-foreground/40">{agent.name}</span>
                          </td>
                          <td className="text-right p-2 font-mono text-foreground/60">{formatNumber(tokensA)}</td>
                          <td className={`text-right p-2 font-mono ${tokensDiff > 0 ? "text-red-400" : tokensDiff < 0 ? "text-green-400" : ""}`}>
                            {formatNumber(tokensB)}
                            {tokensDiff !== 0 && (
                              <span className="text-[9px] ml-1 opacity-60">
                                ({tokensDiff > 0 ? "+" : ""}{tokensDiff})
                              </span>
                            )}
                          </td>
                          <td className="text-right p-2 font-mono text-foreground/60">${costA.toFixed(4)}</td>
                          <td className={`text-right p-2 font-mono ${costDiff > 0 ? "text-red-400" : costDiff < 0 ? "text-green-400" : ""}`}>
                            ${costB.toFixed(4)}
                            {costDiff !== 0 && (
                              <span className="text-[9px] ml-1 opacity-60">
                                ({costDiff > 0 ? "+" : ""}${costDiff.toFixed(4)})
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent value="agents" className="flex-1 overflow-y-auto p-4 space-y-4 m-0">
          <div className="grid grid-cols-2 gap-4">
            {/* run a agents */}
            <div>
              <p className="text-[10px] text-foreground/40 uppercase tracking-wider mb-2 px-1">
                run a agents ({comparison.runA.agents?.length || 0})
              </p>
              <div className="space-y-1">
                {comparison.runA.agents?.map((agent) => (
                  <div key={agent.id} className="flex items-center gap-2 px-2 py-1.5 rounded bg-card text-xs">
                    <span className="font-mono text-foreground/60">{agent.id}</span>
                    <span className="flex-1 truncate">{agent.name}</span>
                    <StatusBadge status={agent.status as Status} size="sm" showIcon />
                  </div>
                ))}
              </div>
            </div>

            {/* run b agents */}
            <div>
              <p className="text-[10px] text-foreground/40 uppercase tracking-wider mb-2 px-1">
                run b agents ({comparison.runB.agents?.length || 0})
              </p>
              <div className="space-y-1">
                {comparison.runB.agents?.map((agent) => (
                  <div key={agent.id} className="flex items-center gap-2 px-2 py-1.5 rounded bg-card text-xs">
                    <span className="font-mono text-foreground/60">{agent.id}</span>
                    <span className="flex-1 truncate">{agent.name}</span>
                    <StatusBadge status={agent.status as Status} size="sm" showIcon />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* status changes */}
          {comparison.agentComparison.some((a) => a.statusA !== a.statusB) && (
            <div>
              <p className="text-[10px] text-foreground/40 uppercase tracking-wider mb-2 px-1">
                status changes
              </p>
              <div className="space-y-1">
                {comparison.agentComparison
                  .filter((a) => a.statusA !== a.statusB)
                  .map((agent) => (
                    <div key={agent.agentId} className="flex items-center gap-3 px-3 py-2 rounded bg-card text-xs">
                      <span className="font-mono text-foreground/60 w-16 truncate">{agent.agentId}</span>
                      <span className="flex-1">{agent.nameA}</span>
                      <Badge variant="secondary" className="text-[9px]">{agent.statusA}</Badge>
                      <ArrowRightFilled className="h-3 w-3 text-foreground/40" />
                      <Badge variant="secondary" className={`text-[9px] ${
                        agent.statusB === "complete" ? "bg-green-500/10 text-green-400" :
                        agent.statusB === "error" ? "bg-red-500/10 text-red-400" : ""
                      }`}>
                        {agent.statusB}
                      </Badge>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="output" className="flex-1 overflow-hidden m-0 flex">
          {/* agent selector */}
          <div className="w-48 bg-muted p-2 overflow-y-auto">
            <p className="text-[10px] text-foreground/40 uppercase tracking-wider mb-2 px-1">
              agents
            </p>
            <div className="space-y-0.5">
              {comparison.agentComparison.map((agent) => (
                <button
                  key={agent.agentId}
                  onClick={() => setSelectedAgent(agent.agentId)}
                  className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                    selectedAgent === agent.agentId ? "bg-accent" : "hover:bg-card"
                  }`}
                >
                  <div className="font-mono text-foreground/60 truncate">{agent.agentId}</div>
                  <div className="truncate text-foreground/40">{agent.nameA}</div>
                </button>
              ))}
            </div>
          </div>

          {/* diff view */}
          <div className="flex-1 overflow-y-auto p-4">
            {selectedAgentData ? (
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <div>
                    <p className="text-[10px] text-foreground/40 uppercase">run a</p>
                    <p className="text-xs">{selectedAgentData.nameA}</p>
                  </div>
                  <ArrowRightFilled className="h-4 w-4 text-foreground/40" />
                  <div>
                    <p className="text-[10px] text-foreground/40 uppercase">run b</p>
                    <p className="text-xs">{selectedAgentData.nameB}</p>
                  </div>
                </div>

                {selectedAgentData.outputDiff ? (
                  <div className="bg-card rounded-md p-3 font-mono text-xs overflow-x-auto">
                    <pre className="whitespace-pre-wrap break-words">
                      {selectedAgentData.outputDiff.map((part, i) => (
                        <span
                          key={i}
                          className={
                            part.type === "added" ? "bg-green-500/20 text-green-300" :
                            part.type === "removed" ? "bg-red-500/20 text-red-300 line-through" :
                            "text-foreground/80"
                          }
                        >
                          {part.value}
                        </span>
                      ))}
                    </pre>
                  </div>
                ) : (
                  <p className="text-xs text-foreground/40">no output diff available for this agent</p>
                )}
              </div>
            ) : (
              <p className="text-xs text-foreground/40">select an agent to view output diff</p>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
