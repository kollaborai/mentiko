"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { getApiErrorMessage } from "@/lib/api/api-client";
import { useSharedRuns } from "@/lib/runs/runs-store";
import { StatusBadge, type Status } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { WaveSpinner } from "@/components/ui/wave-spinner";
import { ArrowLeftFilled, TrendUpFilled, TrendDownFilled, ArrowDown2Filled as ChevronDown, MinusFilled as Minus } from "@aliimam/icons";

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
    started?: string;
    completed?: string;
  }>;
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

interface ComparisonData {
  runA: RunData;
  runB: RunData;
  metricsDiff: {
    duration: number;
    durationPercent: number;
    tokens: number;
    tokensPercent: number;
    cost: number;
    costPercent: number;
    agentCount: number;
  };
  agentComparison: Array<{
    agentId: string;
    nameA: string;
    nameB: string;
    statusA: string;
    statusB: string;
    outputDiff?: Array<{
      type: "added" | "removed" | "unchanged";
      value: string;
    }>;
  }>;
  perfA?: PerformanceData;
  perfB?: PerformanceData;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `${(usd * 1000).toFixed(2)}c`;
  return `$${usd.toFixed(4)}`;
}

function RunSelector({
  runs,
  selected,
  onSelect,
  label,
}: {
  runs: RunData[];
  selected: string | null;
  onSelect: (id: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);

  const selectedRun = runs.find((r) => r.id === selected);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="w-full bg-card rounded-md px-3 py-2 text-left flex items-center justify-between hover:bg-card/80 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="text-[10px] text-foreground/40 uppercase">{label}</div>
          <div className="text-sm truncate">
            {selectedRun ? `${selectedRun.chain} (${selectedRun.id.slice(-8)})` : "Select a run..."}
          </div>
        </div>
        <ChevronDown className={`h-4 w-4 text-foreground/40 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 w-full mt-1 bg-card rounded-md shadow-lg max-h-64 overflow-y-auto">
            {runs.map((run) => (
              <button
                key={run.id}
                onClick={() => {
                  onSelect(run.id);
                  setOpen(false);
                }}
                className={`w-full px-3 py-2 text-left hover:bg-accent transition-colors border-b border-border/50 last:border-0 ${
                  selected === run.id ? "bg-accent" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm truncate flex-1">{run.chain}</span>
                  <StatusBadge status={run.status as Status} size="sm" />
                </div>
                <div className="text-[10px] text-foreground/30 font-mono">{run.id.slice(-8)}</div>
                <div className="text-[10px] text-foreground/40">
                  {new Date(run.started).toLocaleString()}
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function DiffIndicator({ value, percent }: { value: number; percent: number }) {
  if (value === 0) {
    return <Minus className="h-3 w-3 text-foreground/40" />;
  }
  const isNegative = value < 0;
  const Icon = isNegative ? TrendDownFilled : TrendUpFilled;
  const colorClass = isNegative ? "text-green-400" : "text-red-400";

  return (
    <div className={colorClass} title={`${isNegative ? "" : "+"}${value.toFixed(2)} (${isNegative ? "" : "+"}${percent.toFixed(1)}%)`}>
      <Icon className="h-3 w-3" />
    </div>
  );
}

function OutputDiff({ diff }: { diff: Array<{ type: "added" | "removed" | "unchanged"; value: string }> }) {
  return (
    <div className="bg-muted/50 p-3 rounded-md font-mono text-xs overflow-x-auto max-h-96 overflow-y-auto">
      {diff.map((part, idx) => {
        const lines = part.value.split("\n");
        return (
          <div key={idx}>
            {lines.map((line, lineIdx) => (
              <div
                key={`${idx}-${lineIdx}`}
                className={
                  part.type === "added"
                    ? "text-green-400 bg-green-400/5"
                    : part.type === "removed"
                    ? "text-red-400 bg-red-400/5"
                    : "text-foreground/60"
                }
              >
                {line || " "}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function ComparePageContent() {
  const { fetchWithNamespace } = useNamespaceFetch();
  const { runs: sharedRuns } = useSharedRuns();
  const runs: RunData[] = sharedRuns as unknown as RunData[];
  const searchParams = useSearchParams();
  const router = useRouter();

  const runAParam = searchParams.get("a");
  const runBParam = searchParams.get("b");

  const [runAId, setRunAId] = useState<string | null>(runAParam);
  const [runBId, setRunBId] = useState<string | null>(runBParam);
  const [comparison, setComparison] = useState<ComparisonData | null>(null);
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCompare = async () => {
    if (!runAId || !runBId) return;
    setComparing(true);
    setError(null);

    try {
      const res = await fetchWithNamespace(`/api/runs/compare?runA=${encodeURIComponent(runAId)}&runB=${encodeURIComponent(runBId)}`);
      if (!res.ok) {
        const err = await res.json();
        setError(getApiErrorMessage(err, "Failed to compare runs"));
        return;
      }
      const data = await res.json() as ComparisonData;
      setComparison(data);

      const params = new URLSearchParams();
      params.set("a", runAId);
      params.set("b", runBId);
      router.replace(`/runs/compare?${params.toString()}`);
    } catch {
      setError("Failed to compare runs");
    } finally {
      setComparing(false);
    }
  };

  const runA = runs.find((r) => r.id === runAId);
  const runB = runs.find((r) => r.id === runBId);

  const getDuration = (run: RunData | undefined): number => {
    if (!run) return 0;
    const start = new Date(run.started).getTime();
    const end = run.completed ? new Date(run.completed).getTime() : Date.now();
    return end - start;
  };

  const fasterRun =
    comparison && getDuration(runA) < getDuration(runB)
      ? "A"
      : comparison && getDuration(runB) < getDuration(runA)
      ? "B"
      : null;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/runs">
            <Button size="sm" variant="ghost">
              <ArrowLeftFilled className="mr-1 h-3 w-3" />
              Runs
            </Button>
          </Link>
          <h1>Compare Runs</h1>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-6xl mx-auto space-y-4">
          {/* Selector section */}
          <div className="grid grid-cols-2 gap-4">
            <RunSelector runs={runs} selected={runAId} onSelect={setRunAId} label="Run A" />
            <RunSelector runs={runs} selected={runBId} onSelect={setRunBId} label="Run B" />
          </div>

          <Button
            onClick={handleCompare}
            disabled={!runAId || !runBId || comparing}
            className="w-full"
          >
            {comparing ? "Comparing..." : "Compare"}
          </Button>

          {error && (
            <div className="bg-red-500/10 text-red-400 rounded-md p-3 text-sm">
              {error}
            </div>
          )}

          {comparison && (
            <>
              {/* Summary stats */}
              <div className="bg-card rounded-md p-4">
                <h2 className="text-sm font-medium mb-3">Summary</h2>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-xs">
                  <div>
                    <div className="text-foreground/40 mb-1">Duration A</div>
                    <div className="font-mono">{formatDuration(getDuration(runA))}</div>
                  </div>
                  <div>
                    <div className="text-foreground/40 mb-1">Duration B</div>
                    <div className="font-mono">{formatDuration(getDuration(runB))}</div>
                  </div>
                  <div>
                    <div className="text-foreground/40 mb-1">Faster</div>
                    <div className="font-medium">
                      {fasterRun ? `Run ${fasterRun}` : "Same"}
                    </div>
                  </div>
                  <div>
                    <div className="text-foreground/40 mb-1">Agent Count</div>
                    <div>
                      {runA?.agents.length || 0} vs {runB?.agents.length || 0}
                    </div>
                  </div>
                  <div>
                    <div className="text-foreground/40 mb-1">Status</div>
                    <div className="flex items-center gap-2">
                      {runA && <StatusBadge status={runA.status as Status} size="sm" />}
                      {runB && <StatusBadge status={runB.status as Status} size="sm" />}
                    </div>
                  </div>
                </div>
              </div>

              {/* Metrics diff */}
              <div className="bg-card rounded-md p-4">
                <h2 className="text-sm font-medium mb-3">Metrics Difference</h2>
                <div className="space-y-2">
                  <div className="flex items-center justify-between py-2 border-b border-border/50">
                    <span className="text-xs text-foreground/60">Duration</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono">{formatDuration(getDuration(runA))}</span>
                      <DiffIndicator value={comparison.metricsDiff.duration} percent={comparison.metricsDiff.durationPercent} />
                      <span className="text-xs font-mono">{formatDuration(getDuration(runB))}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-border/50">
                    <span className="text-xs text-foreground/60">Tokens</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono">{comparison.perfA?.summary.total_tokens || 0}</span>
                      <DiffIndicator value={comparison.metricsDiff.tokens} percent={comparison.metricsDiff.tokensPercent} />
                      <span className="text-xs font-mono">{comparison.perfB?.summary.total_tokens || 0}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-border/50">
                    <span className="text-xs text-foreground/60">Cost</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono">{formatCost(comparison.perfA?.summary.total_cost_usd || 0)}</span>
                      <DiffIndicator value={comparison.metricsDiff.cost} percent={comparison.metricsDiff.costPercent} />
                      <span className="text-xs font-mono">{formatCost(comparison.perfB?.summary.total_cost_usd || 0)}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-xs text-foreground/60">Agent Count</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono">{runA?.agents.length || 0}</span>
                      <DiffIndicator value={comparison.metricsDiff.agentCount} percent={0} />
                      <span className="text-xs font-mono">{runB?.agents.length || 0}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Split view */}
              <div className="grid grid-cols-2 gap-4">
                {/* Run A */}
                <div className="bg-card rounded-md p-4">
                  <h3 className="text-sm font-medium mb-2">Run A</h3>
                  <div className="space-y-2">
                    <div>
                      <div className="text-[10px] text-foreground/40">Chain</div>
                      <div className="text-sm">{runA?.chain || "-"}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-foreground/40">Status</div>
                      {runA && <StatusBadge status={runA.status as Status} size="sm" />}
                    </div>
                    <div>
                      <div className="text-[10px] text-foreground/40">Started</div>
                      <div className="text-xs">{runA ? new Date(runA.started).toLocaleString() : "-"}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-foreground/40">Duration</div>
                      <div className="text-xs font-mono">{formatDuration(getDuration(runA))}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-foreground/40">Goal</div>
                      <div className="text-xs text-foreground/60 line-clamp-3">{runA?.goal || "-"}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-foreground/40 mb-1">Agents</div>
                      <div className="space-y-1">
                        {runA?.agents.map((agent) => (
                          <div key={agent.id} className="flex items-center justify-between text-xs bg-muted/50 px-2 py-1 rounded">
                            <span>{agent.name || agent.id}</span>
                            <StatusBadge status={agent.status as Status} size="sm" />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Run B */}
                <div className="bg-card rounded-md p-4">
                  <h3 className="text-sm font-medium mb-2">Run B</h3>
                  <div className="space-y-2">
                    <div>
                      <div className="text-[10px] text-foreground/40">Chain</div>
                      <div className="text-sm">{runB?.chain || "-"}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-foreground/40">Status</div>
                      {runB && <StatusBadge status={runB.status as Status} size="sm" />}
                    </div>
                    <div>
                      <div className="text-[10px] text-foreground/40">Started</div>
                      <div className="text-xs">{runB ? new Date(runB.started).toLocaleString() : "-"}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-foreground/40">Duration</div>
                      <div className="text-xs font-mono">{formatDuration(getDuration(runB))}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-foreground/40">Goal</div>
                      <div className="text-xs text-foreground/60 line-clamp-3">{runB?.goal || "-"}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-foreground/40 mb-1">Agents</div>
                      <div className="space-y-1">
                        {runB?.agents.map((agent) => (
                          <div key={agent.id} className="flex items-center justify-between text-xs bg-muted/50 px-2 py-1 rounded">
                            <span>{agent.name || agent.id}</span>
                            <StatusBadge status={agent.status as Status} size="sm" />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Output diff */}
              {comparison.agentComparison.some((ac) => ac.outputDiff && ac.outputDiff.length > 0) && (
                <div className="bg-card rounded-md p-4">
                  <h2 className="text-sm font-medium mb-3">Output Diff</h2>
                  <div className="space-y-4">
                    {comparison.agentComparison
                      .filter((ac) => ac.outputDiff && ac.outputDiff.length > 0)
                      .map((ac) => (
                        <div key={ac.agentId}>
                          <div className="text-xs text-foreground/40 mb-2">
                            Agent: {ac.nameA} vs {ac.nameB}
                          </div>
                          <OutputDiff diff={ac.outputDiff || []} />
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full">
          <WaveSpinner size="sm" color="primary" animation="ripple" />
        </div>
      }
    >
      <ComparePageContent />
    </Suspense>
  );
}
