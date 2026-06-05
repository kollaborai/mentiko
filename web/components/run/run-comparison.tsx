"use client";

import { useState, useEffect, useCallback } from "react";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowDown2Filled as ChevronDown,
  ArrowUp2Filled as ChevronUp,
  TrendUpFilled as TrendingUp,
  TrendDownFilled as TrendingDown,
  MinusFilled as Minus,
  DocumentDownloadFilled as Download,
  CloseCircleFilled as X,
} from "@aliimam/icons";
import { exportComparisonPDF, exportComparisonJSON } from "@/lib/system/export-comparison";
import { unwrapApiData } from "@/lib/api/api-client";

interface RunData {
  id: string;
  chain: string;
  chainId: string;
  goal: string;
  started: string;
  completed?: string;
  status: string;
  agents: Array<{
    id: string;
    name: string;
    status: string;
    session: string;
    emits?: string;
    started?: string;
    completed?: string;
  }>;
}

interface PerformanceData {
  summary?: {
    total_tokens: number;
    total_cost_usd: number;
    total_duration_ms: number;
    total_api_calls: number;
  };
}

interface MetricDiff {
  value: number;
  percent: number;
  direction: "up" | "down" | "same";
}

interface RunComparisonProps {
  currentRun: RunData;
  currentPerf: PerformanceData;
  onClose: () => void;
}

interface OtherRun extends RunData {
  perf?: PerformanceData;
}

export function RunComparison({ currentRun, currentPerf, onClose }: RunComparisonProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [otherRuns, setOtherRuns] = useState<OtherRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  // fetch other runs from the same chain
  useEffect(() => {
    const fetchOtherRuns = async () => {
      try {
        const res = await fetchWithNamespace(`/api/runs?chainId=${encodeURIComponent(currentRun.chainId)}`);
        if (res.ok) {
          const raw = await res.json();
          const data = unwrapApiData<{ runs?: RunData[] }>(raw);
          const runs = (data.runs || []).filter((r: RunData) => r.id !== currentRun.id);
          setOtherRuns(runs);
        }
      } catch (e) {
        console.error("failed to fetch other runs", e);
      } finally {
        setLoading(false);
      }
    };
    fetchOtherRuns();
  }, [currentRun.chainId, currentRun.id, fetchWithNamespace]);

  // fetch performance data for selected run
  useEffect(() => {
    if (!selectedRunId) return;
    const fetchPerf = async () => {
      try {
        const res = await fetchWithNamespace(`/api/runs/${selectedRunId}/performance`);
        if (res.ok) {
          const data = await res.json() as PerformanceData;
          setOtherRuns(prev =>
            prev.map(r => (r.id === selectedRunId ? { ...r, perf: data } : r))
          );
        }
      } catch (e) {
        console.error("failed to fetch performance", e);
      }
    };
    fetchPerf();
  }, [selectedRunId, fetchWithNamespace]);

  const selectedRun = otherRuns.find(r => r.id === selectedRunId);
  const selectedPerf = selectedRun?.perf;

  // calculate differences
  const calculateDiff = useCallback((a: number, b: number): MetricDiff => {
    if (a === b) return { value: 0, percent: 0, direction: "same" };
    const diff = b - a;
    const percent = a !== 0 ? ((diff / a) * 100) : 0;
    return {
      value: Math.abs(diff),
      percent: Math.abs(percent),
      direction: diff > 0 ? "up" : diff < 0 ? "down" : "same",
    };
  }, []);

  const durationDiff = calculateDiff(
    currentPerf.summary?.total_duration_ms || 0,
    selectedPerf?.summary?.total_duration_ms || 0
  );
  const tokensDiff = calculateDiff(
    currentPerf.summary?.total_tokens || 0,
    selectedPerf?.summary?.total_tokens || 0
  );
  const costDiff = calculateDiff(
    currentPerf.summary?.total_cost_usd || 0,
    selectedPerf?.summary?.total_cost_usd || 0
  );

  // format helpers
  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    return `${mins}m ${secs}s`;
  };

  const formatCost = (usd: number): string => {
    if (usd < 0.01) return `${(usd * 1000).toFixed(2)}¢`;
    return `$${usd.toFixed(4)}`;
  };

  const formatNumber = (n: number): string => {
    return n.toLocaleString();
  };

  // handle export
  const handleExport = async (format: "json" | "pdf") => {
    if (!selectedRun || !selectedPerf) return;

    const defaultSummary = {
      total_tokens: 0,
      total_cost_usd: 0,
      total_duration_ms: 0,
      total_api_calls: 0,
    };

    const data = {
      runA: {
        id: currentRun.id,
        chain: currentRun.chain,
        goal: currentRun.goal,
        started: currentRun.started,
        completed: currentRun.completed,
        status: currentRun.status,
      },
      runB: {
        id: selectedRun.id,
        chain: selectedRun.chain,
        goal: selectedRun.goal,
        started: selectedRun.started,
        completed: selectedRun.completed,
        status: selectedRun.status,
      },
      metricsDiff: {
        duration: durationDiff.value,
        durationPercent: durationDiff.percent,
        tokens: tokensDiff.value,
        tokensPercent: tokensDiff.percent,
        cost: costDiff.value,
        costPercent: costDiff.percent,
        agentCount: selectedRun.agents.length - currentRun.agents.length,
      },
      perfA: { summary: currentPerf.summary || defaultSummary },
      perfB: { summary: selectedPerf.summary || defaultSummary },
    };

    if (format === "json") {
      exportComparisonJSON(data);
    } else {
      await exportComparisonPDF(data);
    }
  };

  const DiffIndicator = ({ diff }: { diff: MetricDiff }) => {
    if (diff.direction === "same") {
      return <Minus className="h-3 w-3 text-foreground/40" />;
    }
    const Icon = diff.direction === "up" ? TrendingUp : TrendingDown;
    const colorClass =
      diff.direction === "up" ? "text-destructive" : "text-emerald-500";
    return (
      <div className={colorClass} title={`${diff.direction === "up" ? "+" : "-"}${diff.percent.toFixed(1)}%`}>
        <Icon className="h-3 w-3" />
      </div>
    );
  };

  return (
    <Card className="border-0 bg-card">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">Run Comparison</h3>
          {selectedRun && (
            <Badge variant="outline" className="text-xs">
              {selectedRun.id.slice(-8)}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {selectedRun && (
            <>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => handleExport("json")}
                className="h-6 px-2 text-xs"
              >
                <Download className="h-3 w-3 mr-1" />
                JSON
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => handleExport("pdf")}
                className="h-6 px-2 text-xs"
              >
                <Download className="h-3 w-3 mr-1" />
                PDF
              </Button>
            </>
          )}
          <Button
            size="icon"
            variant="ghost"
            onClick={onClose}
            className="h-6 w-6"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <div className="p-4">
        {/* current run info */}
        <div className="mb-4">
          <div className="text-xs text-foreground/60 mb-1">Current Run</div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{currentRun.chain}</span>
            <Badge variant="outline">{currentRun.status}</Badge>
          </div>
          <div className="text-xs text-foreground/40 mt-1">
            {new Date(currentRun.started).toLocaleString()}
          </div>
        </div>

        {/* select run to compare */}
        <div className="mb-4">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setExpanded(!expanded)}
            className="w-full justify-between"
          >
            <span>
              {selectedRun
                ? `Comparing with: ${selectedRun.id.slice(-8)}`
                : "Select a run to compare"}
            </span>
            {expanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>

          {expanded && (
            <div className="mt-2 border rounded-md bg-background p-2 max-h-48 overflow-y-auto">
              {loading ? (
                <div className="text-xs text-foreground/40 text-center py-4">
                  loading runs...
                </div>
              ) : otherRuns.length === 0 ? (
                <div className="text-xs text-foreground/40 text-center py-4">
                  no other runs found
                </div>
              ) : (
                <div className="space-y-1">
                  {otherRuns.map((run) => (
                    <button
                      key={run.id}
                      onClick={() => {
                        setSelectedRunId(run.id);
                        setExpanded(false);
                      }}
                      className={`w-full text-left px-3 py-2 rounded text-xs hover:bg-accent transition-colors ${
                        selectedRunId === run.id ? "bg-accent" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span>{run.id.slice(-8)}</span>
                        <Badge variant="outline">{run.status}</Badge>
                      </div>
                      <div className="text-foreground/40 mt-0.5">
                        {run.started}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* comparison metrics */}
        {selectedRun && selectedPerf && (
          <div className="space-y-3">
            {/* duration */}
            <div className="flex items-center justify-between py-2 border-b border-border/50">
              <div className="text-xs text-foreground/60">Duration</div>
              <div className="flex items-center gap-4 text-xs">
                <span>{formatDuration(currentPerf.summary?.total_duration_ms || 0)}</span>
                <DiffIndicator diff={durationDiff} />
                <span>{formatDuration(selectedPerf.summary?.total_duration_ms || 0)}</span>
              </div>
            </div>

            {/* tokens */}
            <div className="flex items-center justify-between py-2 border-b border-border/50">
              <div className="text-xs text-foreground/60">Tokens</div>
              <div className="flex items-center gap-4 text-xs">
                <span>{formatNumber(currentPerf.summary?.total_tokens || 0)}</span>
                <DiffIndicator diff={tokensDiff} />
                <span>{formatNumber(selectedPerf.summary?.total_tokens || 0)}</span>
              </div>
            </div>

            {/* cost */}
            <div className="flex items-center justify-between py-2 border-b border-border/50">
              <div className="text-xs text-foreground/60">Cost</div>
              <div className="flex items-center gap-4 text-xs">
                <span>{formatCost(currentPerf.summary?.total_cost_usd || 0)}</span>
                <DiffIndicator diff={costDiff} />
                <span>{formatCost(selectedPerf.summary?.total_cost_usd || 0)}</span>
              </div>
            </div>

            {/* api calls */}
            <div className="flex items-center justify-between py-2">
              <div className="text-xs text-foreground/60">API Calls</div>
              <div className="flex items-center gap-4 text-xs">
                <span>{currentPerf.summary?.total_api_calls || 0}</span>
                <span className="text-foreground/40">—</span>
                <span>{selectedPerf.summary?.total_api_calls || 0}</span>
              </div>
            </div>

            {/* agent count */}
            <div className="flex items-center justify-between py-2">
              <div className="text-xs text-foreground/60">Agents</div>
              <div className="flex items-center gap-4 text-xs">
                <span>{currentRun.agents.length}</span>
                <span className="text-foreground/40">—</span>
                <span>{selectedRun.agents.length}</span>
              </div>
            </div>
          </div>
        )}

        {/* legend */}
        {selectedRun && (
          <div className="mt-4 pt-3 border-t border-border/50">
            <div className="flex items-center gap-4 text-xs text-foreground/40">
              <div className="flex items-center gap-1">
                <TrendingUp className="h-3 w-3 text-destructive" />
                <span>worse (more)</span>
              </div>
              <div className="flex items-center gap-1">
                <TrendingDown className="h-3 w-3 text-emerald-500" />
                <span>better (less)</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

export default RunComparison;
