"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import type {
  TaskAttempt,
  TaskAttemptKind,
} from "@/lib/tasks/task-attempt-types";

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
      return "bg-amber-500/10 text-amber-300";
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
        <span className="rounded-full border border-border/60 bg-card px-2 py-0.5 text-[10px] font-mono text-foreground/45">
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
  const [error, setError] = useState<{
    taskId: string;
    message: string;
  } | null>(null);
  // true after the user picks a run themselves — background refreshes retain
  // that choice only while its attempt still exists
  const manualSelectionRef = useRef(false);

  useEffect(() => {
    manualSelectionRef.current = false;
  }, [taskId]);

  useEffect(() => {
    let cancelled = false;

    const load = () => {
    fetchWithNamespace(`/api/tasks/${encodeURIComponent(taskId)}/attempts`)
      .then(async (response) => {
        const raw = await response.json();
          if (!response.ok)
            throw new Error(getApiErrorMessage(raw, "Failed to load runs"));
        const nextData = unwrapApiData<AttemptsResponse>(raw);
        if (cancelled) return;
        setData(nextData);
        const attempts = nextData.attempts || [];
          setSelectedRunId((prev) => {
            const prevAttempt = prev
              ? attempts.find((attempt) => attempt.runId === prev)
              : undefined;
            if (
              manualSelectionRef.current &&
              prevAttempt &&
              prevAttempt.status !== "missing"
            ) {
              return prev;
            }
            return undefined;
          });
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) {
          setError({
            taskId,
              message:
                err instanceof Error ? err.message : "Failed to load runs",
          });
        }
      });
    };

    load();
    // background poll: new pipeline runs and status changes appear without a
    // page reload (the embedded run detail already polls its own status)
    const interval = setInterval(load, 10000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [fetchWithNamespace, taskId]);

  const activeData = data?.taskId === taskId ? data : null;
  const activeError = error?.taskId === taskId ? error.message : null;
  const loading = !activeData && !activeError;
  const attempts = useMemo(
    () => activeData?.attempts || [],
    [activeData?.attempts],
  );
  const selectedAttempt = useMemo(
    () => attempts.find((attempt) => attempt.runId === selectedRunId),
    [attempts, selectedRunId],
  );

  if (loading && !data) {
    return (
      <section id="task-runs" className="px-4 py-3">
        <RunsSectionHeader />
        <div className="rounded-xl border border-border/60 bg-muted p-2">
          <div className="rounded-lg bg-card p-3 text-xs text-foreground/35">
            Loading runs...
          </div>
        </div>
      </section>
    );
  }

  // only surface an error when nothing is loaded — a transient failed poll
  // keeps showing the last good data (the next poll clears the error)
  if (activeError && !activeData) {
    return (
      <section id="task-runs" className="px-4 py-3">
        <RunsSectionHeader />
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300">
          {activeError}
        </div>
      </section>
    );
  }

  if (!attempts.length) {
    return null;
  }

  return (
    <section id="task-runs" className="px-4 py-3">
      <RunsSectionHeader count={attempts.length} />

      <div className="grid min-h-[720px] overflow-hidden rounded-xl border border-border/60 bg-muted xl:grid-cols-[280px_minmax(0,1fr)]">
        <div className="flex min-h-full flex-col bg-card p-2">
          <div className="grid gap-1">
              {attempts.map((attempt) => {
                const selected = selectedAttempt?.runId === attempt.runId;
                const label = labelFor(attempt.kind);
                const disabled = attempt.status === "missing";

                return (
                  <button
                    key={`${attempt.kind}-${attempt.runId}`}
                    type="button"
                    aria-label={`${label} ${attempt.runId} ${attempt.chainName || ""}`}
                    disabled={disabled}
                  onClick={() => {
                    manualSelectionRef.current = true;
                    setSelectedRunId(attempt.runId);
                  }}
                    className={cn(
                    "w-full rounded-lg border-s-2 border-transparent px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed",
                    selected
                      ? "border-s-sky-300/50 bg-accent text-foreground"
                      : "text-foreground/55 hover:bg-muted hover:text-foreground/75",
                      disabled && "opacity-75",
                    )}
                  >
                    <div className="flex items-start gap-2">
                    <div
                      className={cn(
                        "mt-0.5 text-foreground/35",
                        selected && "text-foreground/65",
                      )}
                    >
                      {iconFor(attempt.kind)}
                    </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-xs font-semibold">
                          {attempt.chainName || label}
                        </span>
                          {attempt.isCurrent ? (
                          <span className="shrink-0 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-mono text-emerald-300">
                            current
                          </span>
                          ) : null}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span
                          className={cn(
                            "rounded-full px-1.5 py-0.5 text-[9px] font-mono",
                            statusClass(attempt.status),
                          )}
                        >
                            {attempt.status}
                          </span>
                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-mono text-foreground/35">
                            {attempt.category === "system" ? "system" : "task"}
                          </span>
                          {attempt.isLatestForKind ? (
                          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-mono text-foreground/35">
                            latest
                          </span>
                          ) : null}
                        </div>
                        <div className="mt-1 flex min-w-0 items-center gap-1.5 font-mono text-[10px] text-foreground/35">
                        <span className="truncate">
                          {shortId(attempt.runId)}
                        </span>
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

        <div className="min-w-0 bg-background p-2">
          {selectedRunId ? (
            <RunDetailPanel runId={selectedRunId} embedded />
          ) : (
            <div className="flex min-h-full items-center justify-center rounded-lg border border-dashed border-border/60 bg-card p-4 text-xs text-foreground/40">
              Select a run to open its detail.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
