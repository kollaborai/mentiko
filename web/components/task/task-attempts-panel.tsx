"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ClockFilled as Clock,
  DocumentTextFilled as Document,
  FlashFilled as Flash,
  RouteSquareFilled as Route,
  Warning2Filled as Warning,
} from "@aliimam/icons";
import { RunDetailPanel } from "@/components/run/run-detail-panel";
import { unwrapApiData, getApiErrorMessage } from "@/lib/api/api-client";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { cn } from "@/lib/utils";
import type { TaskAttempt, TaskAttemptKind } from "@/lib/tasks/task-attempt-types";

type AttemptsResponse = {
  taskId: string;
  currentExecutionRunId?: string;
  attempts: TaskAttempt[];
};

function labelFor(kind: TaskAttemptKind) {
  switch (kind) {
    case "task_generation":
      return "task generation";
    case "recommendation":
      return "recommendation";
    case "chain_generation":
      return "chain generation";
    case "execution":
      return "execution";
    case "outcome_summary":
      return "outcome summary";
    case "decision_system":
      return "decision system";
    default:
      return "unknown";
  }
}

function iconFor(kind: TaskAttemptKind) {
  if (kind === "execution") return <Route className="h-3 w-3" />;
  if (kind === "outcome_summary") return <Document className="h-3 w-3" />;
  if (kind === "chain_generation") return <Flash className="h-3 w-3" />;
  return <Clock className="h-3 w-3" />;
}

function statusClass(status: string) {
  switch (status) {
    case "completed":
    case "complete":
      return "bg-emerald-500/10 text-emerald-300";
    case "running":
    case "pending":
      return "bg-sky-500/10 text-sky-300";
    case "missing":
      return "bg-amber-500/10 text-amber-300";
    case "failed":
    case "error":
    case "cancelled":
      return "bg-red-500/10 text-red-300";
    default:
      return "bg-muted text-foreground/45";
  }
}

function shortId(value: string) {
  if (value.length <= 18) return value;
  return `${value.slice(0, 10)}...${value.slice(-5)}`;
}

function formatDate(value?: string) {
  if (!value) return "no timestamp";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function RunsSectionHeader({ count }: { count?: number }) {
  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <div>
        <span className="text-xs font-medium text-foreground/40">Runs</span>
        <div className="mt-0.5 text-[10px] text-foreground/30">
          System, generation, and execution activity
        </div>
      </div>
      {typeof count === "number" ? (
        <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-mono text-foreground/45">
          {count} run{count === 1 ? "" : "s"}
        </span>
      ) : null}
    </div>
  );
}

export function TaskAttemptsPanel({ taskId }: { taskId: string }) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [data, setData] = useState<AttemptsResponse | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>();
  const [error, setError] = useState<{ taskId: string; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchWithNamespace(`/api/tasks/${encodeURIComponent(taskId)}/attempts`)
      .then(async (response) => {
        const raw = await response.json();
        if (!response.ok) throw new Error(getApiErrorMessage(raw, "Failed to load runs"));
        const nextData = unwrapApiData<AttemptsResponse>(raw);
        if (cancelled) return;
        setData(nextData);
        const attempts = nextData.attempts || [];
        const selected =
          attempts.find((attempt) => attempt.runId === nextData.currentExecutionRunId)
          || attempts.find((attempt) => attempt.kind === "execution" && attempt.isLatestForKind)
          || attempts.find((attempt) => attempt.status !== "missing")
          || attempts[0];
        setSelectedRunId(selected?.status === "missing" ? undefined : selected?.runId);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) {
          setError({
            taskId,
            message: err instanceof Error ? err.message : "Failed to load runs",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [fetchWithNamespace, taskId]);

  const activeData = data?.taskId === taskId ? data : null;
  const activeError = error?.taskId === taskId ? error.message : null;
  const loading = !activeData && !activeError;
  const attempts = useMemo(() => activeData?.attempts || [], [activeData?.attempts]);
  const orderedAttempts = useMemo(() => {
    return [...attempts].sort((a, b) => {
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
      if (a.kind === "execution" && b.kind !== "execution") return -1;
      if (b.kind === "execution" && a.kind !== "execution") return 1;
      return 0;
    });
  }, [attempts]);
  const selectedAttempt = useMemo(
    () => attempts.find((attempt) => attempt.runId === selectedRunId),
    [attempts, selectedRunId],
  );

  if (loading && !data) {
    return (
      <section id="task-runs" className="px-4 py-3">
        <RunsSectionHeader />
        <div className="rounded-sm bg-muted p-2.5">
          <div className="rounded-sm bg-background/45 p-3 text-xs text-foreground/35">
            Loading runs...
          </div>
        </div>
      </section>
    );
  }

  if (activeError) {
    return (
      <section id="task-runs" className="px-4 py-3">
        <RunsSectionHeader />
        <div className="rounded-sm bg-red-500/10 p-3 text-xs text-red-300">{activeError}</div>
      </section>
    );
  }

  if (!attempts.length) {
    return null;
  }

  return (
    <section id="task-runs" className="px-4 py-3">
      <RunsSectionHeader count={attempts.length} />

      <div className="rounded-sm bg-muted p-2.5">
        <div className="grid items-start gap-3 xl:grid-cols-[260px_minmax(0,1fr)]">
          <div className="self-start rounded-sm bg-background/45 p-1">
            <div className="max-h-[340px] overflow-y-auto pr-1">
              {orderedAttempts.map((attempt) => {
                const selected = selectedAttempt?.runId === attempt.runId;
                const label = labelFor(attempt.kind);
                const disabled = attempt.status === "missing";

                return (
                  <button
                    key={`${attempt.kind}-${attempt.runId}`}
                    type="button"
                    aria-label={`${label} ${attempt.runId} ${attempt.chainName || ""}`}
                    disabled={disabled}
                    onClick={() => setSelectedRunId(attempt.runId)}
                    className={cn(
                      "mb-1 w-full rounded-sm px-2 py-1.5 text-left transition-colors disabled:cursor-not-allowed",
                      selected ? "bg-sky-500/10 text-sky-200" : "text-foreground/55 hover:bg-muted hover:text-foreground/75",
                      disabled && "opacity-75",
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <div className={cn("mt-0.5 text-foreground/35", selected && "text-sky-300")}>{iconFor(attempt.kind)}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate text-xs font-semibold">{attempt.chainName || label}</span>
                          {attempt.isCurrent ? (
                            <span className="shrink-0 rounded-sm bg-emerald-500/10 px-1 py-0.5 text-[9px] font-mono text-emerald-300">current</span>
                          ) : null}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <span className={cn("rounded-sm px-1 py-0.5 text-[9px] font-mono", statusClass(attempt.status))}>
                            {attempt.status}
                          </span>
                          <span className="rounded-sm bg-background/60 px-1 py-0.5 text-[9px] font-mono text-foreground/35">
                            {attempt.category === "system" ? "system" : "task"}
                          </span>
                          {attempt.isLatestForKind ? (
                            <span className="rounded-sm bg-background/60 px-1 py-0.5 text-[9px] font-mono text-foreground/35">latest</span>
                          ) : null}
                        </div>
                        <div className="mt-1 flex min-w-0 items-center gap-1.5 font-mono text-[10px] text-foreground/35">
                          <span className="truncate">{shortId(attempt.runId)}</span>
                          <span className="shrink-0 text-foreground/20">/</span>
                          <span className="truncate text-foreground/30">
                            {attempt.staleReason || formatDate(attempt.startedAt)}
                          </span>
                        </div>
                      </div>
                      {attempt.status === "missing" ? (
                        <Warning className="mt-0.5 h-3 w-3 shrink-0 text-amber-300" />
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {selectedRunId ? (
            <RunDetailPanel runId={selectedRunId} embedded />
          ) : (
            <div className="rounded-sm bg-background/45 p-3 text-xs text-foreground/40">
              select a chain attempt to preview its run
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
