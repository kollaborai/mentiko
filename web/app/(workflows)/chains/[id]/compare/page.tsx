"use client";

import { useEffect, useState, useCallback } from "react";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { useParams, useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowLeftFilled, ClockFilled as Clock, TickCircleFilled as CheckCircle2, CloseCircleFilled as XCircle, InfoCircleFilled as AlertCircle } from "@aliimam/icons";

interface RunData {
  id: string;
  chain: string;
  goal: string;
  started: string;
  completed?: string;
  status: string;
  agents: Array<{ id: string; name: string; status: string }>;
}

export default function ComparePage() {
  const params = useParams();
  const router = useRouter();
  const chainId = params.id as string;

  const { fetchWithNamespace } = useNamespaceFetch();
  const [runs, setRuns] = useState<RunData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedA, setSelectedA] = useState<string | null>(null);
  const [selectedB, setSelectedB] = useState<string | null>(null);

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithNamespace(`/api/runs?chain=${chainId}&limit=100`);
      const data = await res.json() as { runs?: RunData[] };
      setRuns(data.runs || []);
    } catch (e) {
      console.error("failed to load runs", e);
    } finally {
      setLoading(false);
    }
  }, [chainId, fetchWithNamespace]);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  const handleCompare = () => {
    if (selectedA && selectedB) {
      router.push(`/chains/${chainId}/compare/${selectedA}/${selectedB}`);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString() + " " + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "complete": return "bg-green-500";
      case "running": return "bg-amber-500";
      case "error": return "bg-red-500";
      default: return "bg-gray-500";
    }
  };

  const StatusIcon = ({ status }: { status: string }) => {
    switch (status) {
      case "complete": return <CheckCircle2 className="h-3 w-3 text-green-400" />;
      case "running": return <Clock className="h-3 w-3 text-amber-400" />;
      case "error": return <XCircle className="h-3 w-3 text-red-400" />;
      default: return <AlertCircle className="h-3 w-3 text-gray-400" />;
    }
  };

  return (
    <div className="h-screen flex flex-col">
      {/* header */}
      <div className="bg-accent p-4">
        <div className="flex items-center gap-4">
          <Button size="sm" variant="ghost" className="h-7" onClick={() => router.back()}>
            <ArrowLeftFilled className="h-3 w-3 mr-1" />
            back
          </Button>
          <p className="text-xs font-semibold">compare runs</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-4xl mx-auto">
          {/* instructions */}
          <Card className="bg-card p-4 mb-4">
            <p className="text-xs text-foreground/60">
              select two runs from the list below to compare their metrics, agent outputs, and performance.
            </p>
          </Card>

          {/* selected runs */}
          {(selectedA || selectedB) && (
            <Card className="bg-card p-4 mb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  {selectedA && (
                    <div className="flex-1">
                      <p className="text-[10px] text-foreground/40 uppercase">run a</p>
                      <p className="text-xs font-mono">{selectedA.slice(-8)}</p>
                    </div>
                  )}
                  {selectedA && selectedB && <p className="text-foreground/40">vs</p>}
                  {selectedB && (
                    <div className="flex-1">
                      <p className="text-[10px] text-foreground/40 uppercase">run b</p>
                      <p className="text-xs font-mono">{selectedB.slice(-8)}</p>
                    </div>
                  )}
                </div>
                <Button
                  size="sm"
                  disabled={!selectedA || !selectedB || selectedA === selectedB}
                  onClick={handleCompare}
                >
                  compare
                </Button>
              </div>
            </Card>
          )}

          {/* runs list */}
          <Card className="bg-card overflow-hidden">
            {loading ? (
              <div className="p-8 text-center">
                <p className="text-xs text-foreground/40">loading runs...</p>
              </div>
            ) : runs.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-xs text-foreground/40">no runs found for this chain</p>
              </div>
            ) : (
              <div>
                {runs.map((run, idx) => {
                  const isSelectedA = selectedA === run.id;
                  const isSelectedB = selectedB === run.id;
                  const isFirstChild = idx === 0;
                  const isDisabled = (selectedA && selectedA !== run.id && selectedB && selectedB !== run.id) ||
                                   (isSelectedA && selectedB === run.id) ||
                                   (isSelectedB && selectedA === run.id);

                  return (
                    <div key={run.id}>
                      {!isFirstChild && <div className="h-px bg-accent" />}
                      <div
                        className={`p-3 hover:bg-accent transition-colors ${
                          isSelectedA ? "bg-accent" : isSelectedB ? "bg-accent" : ""
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-2 h-2 rounded-full ${statusColor(run.status)}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono text-foreground/60">{run.id.slice(-8)}</span>
                              <StatusIcon status={run.status} />
                              <Badge variant="secondary" className="text-[9px]">{run.status}</Badge>
                            </div>
                            <p className="text-xs text-foreground/40 truncate mt-0.5">{run.goal}</p>
                            <p className="text-[10px] text-foreground/30">{formatDate(run.started)}</p>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant={isSelectedA ? "secondary" : "outline"}
                              className={`h-6 text-[10px] px-2 ${isSelectedA ? "bg-blue-500/20 text-blue-400" : ""}`}
                              disabled={isDisabled}
                              onClick={() => setSelectedA(isSelectedA ? null : run.id)}
                            >
                              a
                            </Button>
                            <Button
                              size="sm"
                              variant={isSelectedB ? "secondary" : "outline"}
                              className={`h-6 text-[10px] px-2 ${isSelectedB ? "bg-purple-500/20 text-purple-400" : ""}`}
                              disabled={isDisabled}
                              onClick={() => setSelectedB(isSelectedB ? null : run.id)}
                            >
                              b
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
