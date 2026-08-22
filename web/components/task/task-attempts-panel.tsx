"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ClockFilled as Clock,
  DocumentTextFilled as Document,
  FlashFilled as Flash,
  JudgeFilled as Judge,
  Link2Filled as Link2,
  RouteSquareFilled as Route,
  Warning2Filled as Warning,
} from "@aliimam/icons";
import { RunDetailPanel } from "@/components/run/run-detail-panel";
import { unwrapApiData, getApiErrorMessage } from "@/lib/api/api-client";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { cn } from "@/lib/utils";
import type { Task } from "@/lib/tasks/task-types";
import type {
  TaskAttempt,
  TaskAttemptKind,
} from "@/lib/tasks/task-attempt-types";
import { TaskChainSection } from "./task-chain-section";
import { TaskRunStoryPanels } from "./task-run-story-panels";

type AttemptsResponse = {
  taskId: string;
  currentExecutionRunId?: string;
  attempts: TaskAttempt[];
};

// The rail is the table of contents for a task's whole execution story, not
// just its runs: the runs that produced the chain, the chain itself, the
// execution run, the outcome summary, and the decision that summary forced.
// Selecting any item swaps the viewer on the right. Kind is carried by the
// row tint and icon; selection stays neutral so the two never conflate.
type PanelItem =
  | { key: string; kind: "run"; attempt: TaskAttempt }
  | { key: string; kind: "chain"; chainName: string; status: string }
  | { key: string; kind: "summary"; attempt: TaskAttempt }
  | { key: string; kind: "decision"; verdict: string; reason?: string; subtaskId?: string };

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

function iconFor(item: PanelItem) {
  if (item.kind === "chain") return <Link2 className="h-3 w-3" />;
  if (item.kind === "summary") return <Document className="h-3 w-3" />;
  if (item.kind === "decision") return <Judge className="h-3 w-3" />;
  const kind = item.attempt.kind;
  if (kind === "execution") return <Route className="h-3 w-3" />;
  if (kind === "outcome_summary") return <Document className="h-3 w-3" />;
  if (kind === "chain_generation") return <Flash className="h-3 w-3" />;
  return <Clock className="h-3 w-3" />;
}

function tintFor(item: PanelItem) {
  switch (item.kind) {
    case "chain":
      return "bg-blue-500/[0.07]";
    case "summary":
      return "bg-emerald-500/[0.07]";
    case "decision":
      return "bg-blue-500/10";
    default:
      return "";
  }
}

function titleFor(item: PanelItem) {
  if (item.kind === "chain") return item.chainName;
  if (item.kind === "summary") return "Summary";
  if (item.kind === "decision") return "Decision";
  return item.attempt.chainName || labelFor(item.attempt.kind);
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
        <span className="text-xs font-medium text-foreground/40">Execution</span>
        <div className="mt-0.5 text-[10px] text-foreground/30">
          Chain, runs, outcome, and decision
        </div>
      </div>
      {typeof count === "number" ? (
        <span className="rounded-full border border-border/60 bg-card px-2 py-0.5 text-[10px] font-mono text-foreground/45">
          {count} item{count === 1 ? "" : "s"}
        </span>
      ) : null}
    </div>
  );
}

function DecisionViewer({
  verdict,
  reason,
  subtaskId,
  onOpenDecisionSubtask,
}: {
  verdict: string;
  reason?: string;
  subtaskId?: string;
  onOpenDecisionSubtask?: (id: string) => void;
}) {
  const tone =
    verdict === "decision"
      ? { bg: "bg-blue-500/10", icon: "text-blue-400", text: "text-blue-300" }
      : verdict === "close"
        ? { bg: "bg-green-500/10", icon: "text-green-400", text: "text-green-300" }
        : { bg: "bg-amber-500/10", icon: "text-amber-400", text: "text-amber-300" };

  return (
    <div className="px-4 py-3">
      <div className="mb-2">
        <span className="text-xs font-medium text-foreground/40">Decision</span>
        <div className="mt-0.5 text-[10px] text-foreground/30">
          Completion audit verdict for this task
        </div>
      </div>
      <div className={cn("rounded-xl p-3", tone.bg)}>
        <div className="flex items-center gap-1.5">
          <Judge className={cn("h-3.5 w-3.5 shrink-0", tone.icon)} />
          <p className={cn("text-xs font-medium", tone.text)}>
            completion audit · {verdict}
          </p>
        </div>
        {reason ? (
          <p className="mt-1 text-[11px] text-foreground/55">{reason}</p>
        ) : null}
        {subtaskId && onOpenDecisionSubtask ? (
          <button
            type="button"
            onClick={() => onOpenDecisionSubtask(subtaskId)}
            className="mt-2 rounded-sm bg-background/50 px-2 py-1 text-[10px] font-mono text-foreground/60 hover:text-foreground"
          >
            → view decision subtask
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function TaskAttemptsPanel({
  task,
  onRefreshTask,
  onAssignChain,
  onRemoveChain,
  onMetadataUpdate,
  onClearMetadata,
  workspacePath,
  onOpenDecisionSubtask,
}: {
  task: Task;
  onRefreshTask?: () => Promise<void>;
  onAssignChain: (chainId: string, chainName: string) => Promise<void>;
  onRemoveChain: () => Promise<void>;
  onMetadataUpdate?: (metadata: Record<string, unknown>) => void;
  onClearMetadata?: () => void;
  workspacePath?: string;
  onOpenDecisionSubtask?: (id: string) => void;
}) {
  const taskId = task.id;
  const { fetchWithNamespace } = useNamespaceFetch();
  const [data, setData] = useState<AttemptsResponse | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | undefined>();
  const [error, setError] = useState<{
    taskId: string;
    message: string;
  } | null>(null);

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

  const binding = task.chainBinding;
  const auditVerdict =
    typeof task.metadata?.last_audit_verdict === "string"
      ? (task.metadata.last_audit_verdict as string)
      : undefined;
  const reopenedReason =
    typeof task.metadata?.reopened_reason === "string"
      ? (task.metadata.reopened_reason as string)
      : undefined;
  const decisionSubtaskId =
    typeof task.metadata?.decision_subtask_id === "string"
      ? (task.metadata.decision_subtask_id as string)
      : undefined;

  // The join: run attempts (API) + the bound chain (task.chainBinding) + the
  // audit verdict (task.metadata) collapse into one ordered rail.
  const items = useMemo<PanelItem[]>(() => {
    const list: PanelItem[] = [];

    // The chain slot is always present, bound or not — it is the task's plan,
    // and when unbound it carries the assign-a-chain affordance that used to
    // live in the standalone Chain section.
    const chainItem: PanelItem = {
      key: "chain",
      kind: "chain",
      chainName: binding?.chain_name || binding?.chain_id || "No chain",
      // Only surface generation status while a chain is actually being made.
      // Once one is bound the chain is usable, and a stale "failed" from an
      // earlier generation attempt would label a working chain as broken.
      status: !binding
        ? "unassigned"
        : binding.generation_status === "running"
          ? "running"
          : "assigned",
    };

    // Runs keep the API's order (chronological, and it already pairs each
    // execution with the summary it produced). The chain is inserted just
    // ahead of the first execution — after the runs that produced it — rather
    // than sorting the whole rail by kind, which would ungroup those pairs.
    let chainInserted = false;
    attempts.forEach((attempt) => {
      if (
        !chainInserted &&
        (attempt.kind === "execution" || attempt.kind === "outcome_summary")
      ) {
        list.push(chainItem);
        chainInserted = true;
      }
      list.push(
        attempt.kind === "outcome_summary"
          ? { key: `summary:${attempt.runId}`, kind: "summary", attempt }
          : { key: `run:${attempt.runId}`, kind: "run", attempt },
      );
    });
    if (!chainInserted) list.push(chainItem);

    if (auditVerdict) {
      list.push({
        key: "decision",
        kind: "decision",
        verdict: auditVerdict,
        reason: reopenedReason,
        subtaskId: decisionSubtaskId,
      });
    }

    return list;
  }, [attempts, binding, auditVerdict, reopenedReason, decisionSubtaskId]);

  // Fall back to the chain (the plan) when nothing is picked or a manual
  // selection's item disappeared between polls, so the panel always opens on
  // something useful instead of an empty viewer.
  const activeKey =
    selectedKey && items.some((item) => item.key === selectedKey)
      ? selectedKey
      : items.some((item) => item.key === "chain")
        ? "chain"
        : items[0]?.key;

  const selected = useMemo(
    () => items.find((item) => item.key === activeKey),
    [items, activeKey],
  );

  // Each kind's viewer is a different height. Without this, picking a short
  // item (a decision) right after a tall one (a summary) leaves the pane
  // scrolled past the new content and it reads as empty.
  const viewerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (viewerRef.current) viewerRef.current.scrollTop = 0;
  }, [activeKey]);

  if (loading && !data) {
    return (
      <section id="task-runs" className="px-4 py-3">
        <RunsSectionHeader />
        <div className="rounded-xl border border-border/60 bg-muted p-2">
          <div className="rounded-lg bg-card p-3 text-xs text-foreground/35">
            Loading execution...
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

  if (!items.length) {
    return null;
  }

  return (
    <section id="task-runs" className="px-4 py-3">
      <RunsSectionHeader count={items.length} />

      <div className="grid overflow-hidden rounded-xl border border-border/60 bg-muted xl:h-[min(560px,70vh)] xl:grid-cols-[280px_minmax(0,1fr)]">
        <div className="flex min-h-0 min-w-0 flex-col overflow-y-auto bg-card p-2">
          {/* minmax(0,1fr): without it the implicit column is auto-sized to
              max-content, so long run ids + timestamps widen the rail past its
              280px track and get clipped instead of truncating. */}
          <div className="grid grid-cols-[minmax(0,1fr)] gap-1">
            {items.map((item) => {
              const isSelected = activeKey === item.key;
              const attempt = item.kind === "run" || item.kind === "summary"
                ? item.attempt
                : undefined;
              const disabled = attempt?.status === "missing";
              const statusText =
                item.kind === "chain"
                  ? item.status
                  : item.kind === "decision"
                    ? item.verdict
                    : attempt?.status || "unknown";

              return (
                <button
                  key={item.key}
                  type="button"
                  aria-label={`${titleFor(item)} ${attempt?.runId || item.kind}`}
                  disabled={disabled}
                  onClick={() => setSelectedKey(item.key)}
                  className={cn(
                    "w-full min-w-0 rounded-lg px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed",
                    isSelected
                      ? "bg-accent text-foreground"
                      : cn(
                        tintFor(item),
                        "text-foreground/55 hover:bg-muted hover:text-foreground/75",
                      ),
                    disabled && "opacity-75",
                  )}
                >
                  <div className="flex items-start gap-2">
                    <div
                      className={cn(
                        "mt-0.5 text-foreground/35",
                        isSelected && "text-foreground/65",
                      )}
                    >
                      {iconFor(item)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-xs font-semibold">
                          {titleFor(item)}
                        </span>
                        {attempt?.isCurrent ? (
                          <span className="shrink-0 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-mono text-emerald-300">
                            current
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span
                          className={cn(
                            "rounded-full px-1.5 py-0.5 text-[9px] font-mono",
                            statusClass(statusText),
                          )}
                        >
                          {statusText}
                        </span>
                        {attempt ? (
                          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-mono text-foreground/35">
                            {attempt.category === "system" ? "system" : "task"}
                          </span>
                        ) : item.kind !== statusText ? (
                          // skip the kind badge when it would just repeat the
                          // status (a decision whose verdict is "decision")
                          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-mono text-foreground/35">
                            {item.kind}
                          </span>
                        ) : null}
                        {attempt?.isLatestForKind ? (
                          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-mono text-foreground/35">
                            latest
                          </span>
                        ) : null}
                      </div>
                      {attempt ? (
                        <div className="mt-1 flex min-w-0 items-center gap-1.5 font-mono text-[10px] text-foreground/35">
                          <span className="truncate">
                            {shortId(attempt.runId)}
                          </span>
                          <span className="shrink-0 text-foreground/20">/</span>
                          <span className="truncate text-foreground/30">
                            {attempt.staleReason || formatDate(attempt.startedAt)}
                          </span>
                        </div>
                      ) : null}
                    </div>
                    {attempt?.status === "missing" ? (
                      <Warning className="mt-0.5 h-3 w-3 shrink-0 text-amber-300" />
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div
          ref={viewerRef}
          className="min-w-0 min-h-0 overflow-y-auto bg-background p-2"
        >
          {!selected ? (
            <div className="flex min-h-full items-center justify-center rounded-lg border border-dashed border-border/60 bg-card p-4 text-xs text-foreground/40">
              Select an item to open it.
            </div>
          ) : selected.kind === "run" ? (
            <RunDetailPanel runId={selected.attempt.runId} embedded />
          ) : selected.kind === "chain" ? (
            <TaskChainSection
              task={task}
              onAssignChain={onAssignChain}
              onRemoveChain={onRemoveChain}
              onMetadataUpdate={onMetadataUpdate}
              onClearMetadata={onClearMetadata}
              workspacePath={workspacePath}
            />
          ) : selected.kind === "summary" ? (
            <TaskRunStoryPanels task={task} onRefreshTask={onRefreshTask} />
          ) : (
            <DecisionViewer
              verdict={selected.verdict}
              reason={selected.reason}
              subtaskId={selected.subtaskId}
              onOpenDecisionSubtask={onOpenDecisionSubtask}
            />
          )}
        </div>
      </div>
    </section>
  );
}
