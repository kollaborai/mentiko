"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChartFilled as Chart,
  ClockFilled as Clock,
  DatabaseSearch,
  DocumentTextFilled as Document,
  FlashFilled as Flash,
  LinkFilled as LinkIcon,
  Refresh2Filled as Refresh,
  RouteSquareFilled as Route,
  TickCircleFilled as Check,
  Warning2Filled as Warning,
} from "@aliimam/icons";
import type { Task } from "@/lib/tasks/task-types";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { unwrapAgentJsonOutput } from "@/lib/tasks/agent-json-output";
import { cn } from "@/lib/utils";

type RunSummaryAgent = {
  id?: string;
  name?: string;
  status?: string;
};

type RunSummary = {
  run_id?: string;
  chain?: string;
  status?: string;
  outcome?: string;
  decision_required?: boolean;
  recommendation?: string;
  summary?: string;
  findings?: string[];
  risks?: string[];
  next_actions?: string[];
  agents?: RunSummaryAgent[];
  artifacts_count?: number;
};

type AiOutcomeSummary = {
  headline?: string;
  narrative?: string;
  outcome?: string;
  confidence?: string;
  decision_required?: boolean;
  what_happened?: string[];
  evidence?: string[];
  improvement_signals?: string[];
  next_actions?: string[];
};

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function runSummary(value: unknown): RunSummary | undefined {
  const record = recordValue(value);
  if (!record) return undefined;
  const agents = Array.isArray(record.agents)
    ? record.agents
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
        .map((agent) => ({
          id: stringValue(agent.id),
          name: stringValue(agent.name),
          status: stringValue(agent.status),
        }))
    : undefined;

  return {
    run_id: stringValue(record.run_id),
    chain: stringValue(record.chain),
    status: stringValue(record.status),
    outcome: stringValue(record.outcome),
    decision_required: typeof record.decision_required === "boolean" ? record.decision_required : undefined,
    recommendation: stringValue(record.recommendation),
    summary: stringValue(record.summary),
    findings: stringArray(record.findings),
    risks: stringArray(record.risks),
    next_actions: stringArray(record.next_actions),
    agents,
    artifacts_count: typeof record.artifacts_count === "number" ? record.artifacts_count : undefined,
  };
}

function aiOutcomeSummary(value: unknown): AiOutcomeSummary | undefined {
  // Tolerate legacy rows stored as the raw { output: "<json string>" } job
  // envelope by unwrapping to the auditor's payload before reading fields.
  const record = unwrapAgentJsonOutput(value);
  if (!record) return undefined;
  return {
    headline: stringValue(record.headline),
    narrative: stringValue(record.narrative),
    outcome: stringValue(record.outcome),
    confidence: stringValue(record.confidence),
    decision_required: typeof record.decision_required === "boolean" ? record.decision_required : undefined,
    what_happened: stringArray(record.what_happened),
    evidence: stringArray(record.evidence),
    improvement_signals: stringArray(record.improvement_signals),
    next_actions: stringArray(record.next_actions),
  };
}

function isTerminalRunStatus(status?: string) {
  return status === "completed" || status === "complete" || status === "failed" || status === "stopped";
}

function toneFor(outcome?: string, decisionRequired?: boolean) {
  if (decisionRequired) return "text-amber-300 bg-amber-500/10";
  if (outcome === "failed" || outcome === "error") return "text-red-300 bg-red-500/10";
  if (outcome === "complete" || outcome === "completed" || outcome === "pass") return "text-emerald-300 bg-emerald-500/10";
  return "text-sky-300 bg-sky-500/10";
}

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "good" | "warn" | "info" | "bad" }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-sm px-1.5 text-[10px] font-mono",
        tone === "good" && "bg-emerald-500/10 text-emerald-300",
        tone === "warn" && "bg-amber-500/10 text-amber-300",
        tone === "info" && "bg-sky-500/10 text-sky-300",
        tone === "bad" && "bg-red-500/10 text-red-300",
        tone === "neutral" && "bg-muted text-foreground/50",
      )}
    >
      {children}
    </span>
  );
}

function Widget({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
}) {
  return (
    <div className="rounded-sm bg-background/50 p-2">
      <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase text-foreground/30">
        {icon}
        {label}
      </div>
      <div className="mt-1 truncate text-xs font-semibold text-foreground/80">{value}</div>
      {detail ? <div className="mt-0.5 truncate text-[10px] text-foreground/35">{detail}</div> : null}
    </div>
  );
}

function RunLink({ runId, children }: { runId?: string; children: React.ReactNode }) {
  if (!runId) return <span>{children}</span>;
  return (
    <a
      href={`/runs?runId=${encodeURIComponent(runId)}`}
      className="inline-flex min-w-0 items-center gap-1 text-sky-300 hover:text-sky-200"
    >
      <span className="truncate">{children}</span>
      <LinkIcon className="h-3 w-3 shrink-0" />
    </a>
  );
}

function shortId(value?: string) {
  if (!value) return "-";
  if (value.length <= 18) return value;
  return `${value.slice(0, 10)}...${value.slice(-5)}`;
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function SummarySectionHeader({
  outcome,
  outcomeTone,
  status,
}: {
  outcome: string;
  outcomeTone: "neutral" | "good" | "warn" | "info" | "bad";
  status?: string;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-foreground/40">Summary</span>
        <Badge tone={outcomeTone}>{outcome}</Badge>
        {status ? (
          <Badge tone={status === "ready" ? "good" : status === "failed" ? "bad" : "info"}>
            {status === "running" ? "summarizing" : status}
          </Badge>
        ) : null}
      </div>
    </div>
  );
}

export function TaskRunStoryPanels({
  task,
  onRefreshTask,
}: {
  task: Task;
  onRefreshTask?: () => Promise<void>;
}) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const metadata = task.metadata || {};
  const summary = runSummary(metadata.last_run_summary);
  const binding = task.chainBinding;
  const lastRunId = binding?.last_run_id || summary?.run_id;
  const outcome = binding?.last_run_outcome || summary?.outcome || binding?.last_run_status || "unknown";
  const decisionRequired = binding?.last_run_decision_required ?? summary?.decision_required;
  const summarySourceRunId = stringValue(metadata.task_outcome_summary_source_run_id);
  const matchingAiSummary = summarySourceRunId === lastRunId
    ? aiOutcomeSummary(metadata.task_outcome_summary)
    : undefined;
  const summaryStatus = stringValue(metadata.task_outcome_summary_status);
  const summaryError = stringValue(metadata.task_outcome_summary_error);
  const summaryJobRunId = stringValue(metadata.task_outcome_summary_run_id);
  const [localStatus, setLocalStatus] = useState<string | undefined>();
  const startedForRun = useRef<string | undefined>(undefined);

  const narrative = matchingAiSummary?.narrative || summary?.summary || binding?.last_run_error || "run finished without a summary";
  const headline = matchingAiSummary?.headline || (outcome === "complete" ? "Task completed" : "Task outcome needs review");
  const confidence = matchingAiSummary?.confidence || (summary ? "medium" : "low");
  const findings = matchingAiSummary?.what_happened?.length
    ? matchingAiSummary.what_happened
    : summary?.findings || [];
  const evidence = matchingAiSummary?.evidence?.length
    ? matchingAiSummary.evidence
    : summary?.findings || [];
  const improvementSignals = matchingAiSummary?.improvement_signals?.length
    ? matchingAiSummary.improvement_signals
    : summary?.risks?.length
      ? summary.risks
      : ["No orchestration issue detected."];
  const nextActions = matchingAiSummary?.next_actions?.length
    ? matchingAiSummary.next_actions
    : summary?.next_actions || [];
  const agents = summary?.agents?.length ? summary.agents : [];
  const artifactDir = lastRunId
    ? `~/.mentiko/namespaces/default/runs/${lastRunId}/artifacts`
    : "run artifacts";

  const recommendationRunId = stringValue(metadata.recommendation_run_id);
  const generatedChainRunId = stringValue(metadata.generated_chain_run_id);
  const timeline = [
    { label: "task", value: task.id, detail: task.title },
    { label: "recommend", value: recommendationRunId, detail: "chain recommendation" },
    { label: "generate", value: generatedChainRunId, detail: "chain generation" },
    { label: "execute", value: lastRunId, detail: binding?.chain_name || summary?.chain || "execution chain" },
  ].filter((item) => item.value);

  useEffect(() => {
    if (!lastRunId || matchingAiSummary) return;
    if (!isTerminalRunStatus(binding?.last_run_status || summary?.status)) return;
    if (summaryStatus === "running" || localStatus === "running") return;
    if (summaryStatus === "failed") return;
    if (startedForRun.current === lastRunId) return;

    startedForRun.current = lastRunId;
    fetchWithNamespace(`/api/tasks/${encodeURIComponent(task.id)}/outcome-summary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
      .then(async (response) => {
        if (!response.ok) {
          setLocalStatus("failed");
          return;
        }
        setLocalStatus("running");
        await onRefreshTask?.();
        window.setTimeout(() => void onRefreshTask?.(), 2500);
      })
      .catch(() => setLocalStatus("failed"));
  }, [
    binding?.last_run_status,
    fetchWithNamespace,
    lastRunId,
    localStatus,
    matchingAiSummary,
    onRefreshTask,
    summary?.status,
    summaryStatus,
    task.id,
  ]);

  if (!summary && !lastRunId) return null;

  const staleStoredRunningStatus = summaryStatus === "running" && !!summary;
  const visibleSummaryStatus = matchingAiSummary
    ? "ready"
    : localStatus || (staleStoredRunningStatus ? undefined : summaryStatus) || (summary ? undefined : "queued");
  const outcomeTone = outcome === "failed" || outcome === "error" ? "bad" : decisionRequired ? "warn" : "good";

  return (
    <section className="px-4 py-3">
      <SummarySectionHeader
        outcome={outcome}
        outcomeTone={outcomeTone}
        status={visibleSummaryStatus}
      />

      <div className="rounded-sm bg-muted p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-foreground/85">{headline}</h3>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-foreground/60">{narrative}</p>
            {summaryError ? <p className="mt-1 text-[10px] text-red-300">{summaryError}</p> : null}
          </div>
          <div className={cn("rounded-sm px-2.5 py-2 text-right", toneFor(outcome, decisionRequired))}>
            <div className="text-[10px] font-mono uppercase opacity-70">decision</div>
            <div className="text-sm font-semibold">{decisionRequired ? "review" : "move forward"}</div>
          </div>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          <Widget icon={<Check className="h-3 w-3" />} label="confidence" value={confidence} detail={matchingAiSummary ? "ai summary" : "structured fallback"} />
          <Widget icon={<Document className="h-3 w-3" />} label="artifacts" value={summary?.artifacts_count ?? "-"} detail="run evidence" />
          <Widget icon={<Route className="h-3 w-3" />} label="execution" value={<RunLink runId={lastRunId}>{shortId(lastRunId)}</RunLink>} detail={binding?.chain_name || summary?.chain || "chain"} />
          <Widget icon={<Flash className="h-3 w-3" />} label="agents" value={agents.length || "-"} detail={agents[0]?.name || "agent report"} />
          <Widget icon={<Clock className="h-3 w-3" />} label="closed" value={task.closedAt ? "yes" : "no"} detail={formatDate(task.closedAt)} />
        </div>

        <div className="mt-3 grid gap-2 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-sm bg-background/45 p-2.5">
            <div className="mb-2 flex items-center gap-1.5 text-[10px] font-mono uppercase text-foreground/30">
              <Route className="h-3 w-3" />
              execution journey
            </div>
            <div className="grid gap-1.5">
              {timeline.map((item, index) => (
                <div key={`${item.label}-${item.value}`} className="grid grid-cols-[20px_82px_1fr] items-start gap-2 text-xs">
                  <span className="flex h-5 w-5 items-center justify-center rounded-sm bg-muted text-[10px] text-foreground/40">{index + 1}</span>
                  <span className="font-mono text-[10px] text-foreground/35">{item.label}</span>
                  <span className="min-w-0 text-foreground/65">
                    {item.label === "execute" ? <RunLink runId={item.value}>{item.detail}</RunLink> : item.detail}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-sm bg-background/45 p-2.5">
            <div className="mb-2 flex items-center gap-1.5 text-[10px] font-mono uppercase text-foreground/30">
              <DatabaseSearch className="h-3 w-3" />
              proof
            </div>
            <div className="break-all font-mono text-[10px] text-foreground/45">{artifactDir}</div>
            <div className="mt-2 space-y-1.5">
              {evidence.slice(0, 3).map((item) => (
                <div key={item} className="flex gap-1.5 text-xs text-foreground/65">
                  <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-300" />
                  <span>{item}</span>
                </div>
              ))}
              {!evidence.length ? <div className="text-xs text-foreground/40">no evidence extracted yet</div> : null}
            </div>
          </div>
        </div>

        <div className="mt-2 grid gap-2 xl:grid-cols-3">
          <div className="rounded-sm bg-background/45 p-2.5">
            <div className="mb-2 flex items-center gap-1.5 text-[10px] font-mono uppercase text-foreground/30">
              <Chart className="h-3 w-3" />
              what happened
            </div>
            <div className="space-y-1.5">
              {findings.slice(0, 3).map((item) => (
                <div key={item} className="text-xs text-foreground/65">{item}</div>
              ))}
              {!findings.length ? <div className="text-xs text-foreground/40">no findings extracted yet</div> : null}
            </div>
          </div>

          <div className="rounded-sm bg-background/45 p-2.5">
            <div className="mb-2 flex items-center gap-1.5 text-[10px] font-mono uppercase text-foreground/30">
              <Warning className="h-3 w-3" />
              improvement signals
            </div>
            <div className="space-y-1.5">
              {improvementSignals.slice(0, 3).map((item) => (
                <div key={item} className="text-xs text-foreground/65">{item}</div>
              ))}
            </div>
          </div>

          <div className="rounded-sm bg-background/45 p-2.5">
            <div className="mb-2 flex items-center gap-1.5 text-[10px] font-mono uppercase text-foreground/30">
              <Refresh className="h-3 w-3" />
              receipt
            </div>
            <dl className="grid grid-cols-[82px_1fr] gap-x-2 gap-y-1 text-[10px]">
              <dt className="text-foreground/35">run</dt>
              <dd className="truncate font-mono text-foreground/65"><RunLink runId={lastRunId}>{lastRunId || "-"}</RunLink></dd>
              <dt className="text-foreground/35">summary run</dt>
              <dd className="truncate font-mono text-foreground/65"><RunLink runId={summaryJobRunId}>{summaryJobRunId || "-"}</RunLink></dd>
              <dt className="text-foreground/35">status</dt>
              <dd className="text-foreground/65">{summary?.status || binding?.last_run_status || "-"}</dd>
              <dt className="text-foreground/35">chain</dt>
              <dd className="truncate text-foreground/65">{binding?.chain_name || summary?.chain || "-"}</dd>
            </dl>
            {nextActions.length ? <div className="mt-2 text-xs text-foreground/60">{nextActions[0]}</div> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
