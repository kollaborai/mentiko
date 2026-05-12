"use client";

import { useState, useEffect } from "react";
import {
  TickCircleFilled as CheckIcon,
  CloseCircleFilled as XIcon,
  ClockFilled as ClockIcon,
  ArrowDown2Filled as ChevronDown,
  ArrowUp2Filled as ChevronUp,
} from "@aliimam/icons";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { TimeAgo } from "@/components/shared/time-ago";

interface ScheduleExecution {
  id: string;
  scheduleId: string;
  chainId: string;
  chainName: string;
  startedAt: string;
  completedAt?: string;
  duration?: number;
  status: "running" | "completed" | "failed" | "cancelled";
  error?: string;
  output?: string;
  triggeredBy: "cron" | "manual" | "api";
  workspaceId?: string;
  retryAttempt?: number;
}

interface ScheduleHistoryProps {
  scheduleId: string;
  chainName: string;
  open: boolean;
  onClose: () => void;
}

export function ScheduleHistory({ scheduleId, open }: ScheduleHistoryProps) {
  const [history, setHistory] = useState<ScheduleExecution[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { fetchWithNamespace } = useNamespaceFetch();

  useEffect(() => {
    if (open) {
      fetchHistory();
    }
  }, [scheduleId, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const res = await fetchWithNamespace(`/api/schedules/history?chainId=${scheduleId}&limit=50`);
      const data = await res.json();
      setHistory(data.history || []);
    } catch {
      setHistory([]);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  const formatDuration = (ms?: number) => {
    if (!ms) return "-";
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const statusIcon = (status: ScheduleExecution["status"]) => {
    switch (status) {
      case "completed":
        return <CheckIcon className="h-3.5 w-3.5 text-emerald-400" />;
      case "failed":
        return <XIcon className="h-3.5 w-3.5 text-red-400" />;
      case "running":
        return <ClockIcon className="h-3.5 w-3.5 text-blue-400 animate-spin" />;
      case "cancelled":
        return <XIcon className="h-3.5 w-3.5 text-foreground/30" />;
    }
  };

  const statusColor = (status: ScheduleExecution["status"]) => {
    switch (status) {
      case "completed": return "bg-emerald-500/15 text-emerald-400";
      case "failed": return "bg-red-500/15 text-red-400";
      case "running": return "bg-blue-500/15 text-blue-400";
      case "cancelled": return "bg-foreground/5 text-foreground/40";
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-3 flex items-center justify-between">
        <span className="text-[10px] text-foreground/30 uppercase tracking-wider">
          execution history
        </span>
        <span className="text-[10px] text-foreground/20">
          {history.length} run{history.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-4">
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="rounded-md bg-foreground/[0.03] p-3 animate-pulse">
                <div className="h-3 bg-foreground/5 rounded w-1/4 mb-2" />
                <div className="h-2 bg-foreground/5 rounded w-1/3" />
              </div>
            ))}
          </div>
        ) : history.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-xs text-foreground/25">no executions yet</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {history.map((exec) => (
              <div
                key={exec.id}
                className="rounded-md bg-foreground/[0.03] overflow-hidden"
              >
                <button
                  onClick={() => setExpanded(expanded === exec.id ? null : exec.id)}
                  className="w-full px-3 py-2.5 flex items-center gap-2.5 hover:bg-foreground/[0.05] transition-colors text-left"
                >
                  {statusIcon(exec.status)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <TimeAgo date={exec.startedAt} format="long" className="text-xs" />
                      <span className={`rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-wider ${statusColor(exec.status)}`}>
                        {exec.status}
                      </span>
                      <span className="text-[10px] text-foreground/20">
                        {exec.triggeredBy}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-foreground/25 mt-0.5">
                      <span>{formatDuration(exec.duration)}</span>
                      {exec.retryAttempt != null && exec.retryAttempt > 1 && (
                        <span className="text-amber-400">attempt {exec.retryAttempt}</span>
                      )}
                    </div>
                  </div>
                  {expanded === exec.id ? (
                    <ChevronUp className="h-3.5 w-3.5 text-foreground/15" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 text-foreground/15" />
                  )}
                </button>

                {expanded === exec.id && (
                  <div className="px-3 pb-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2 text-[10px] text-foreground/35">
                      <div>id: <span className="font-mono">{exec.id}</span></div>
                      <div>started: {new Date(exec.startedAt).toLocaleString()}</div>
                      {exec.completedAt && (
                        <div>ended: {new Date(exec.completedAt).toLocaleString()}</div>
                      )}
                      {exec.workspaceId && (
                        <div>workspace: {exec.workspaceId}</div>
                      )}
                    </div>

                    {exec.error && (
                      <div className="rounded bg-red-500/10 p-2 text-[10px] text-red-300 font-mono whitespace-pre-wrap">
                        {exec.error}
                      </div>
                    )}

                    {exec.output && (
                      <div className="rounded bg-foreground/[0.03] p-2 text-[10px] text-foreground/50 font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
                        {exec.output}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
