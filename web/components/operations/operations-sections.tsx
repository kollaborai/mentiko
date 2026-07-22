"use client";

// Operations Timeline sections — dense, flat, tokens-only presentation of the
// server read model (/api/operations/timeline). Every number and label here is
// passed through from the read model, which derives it from persisted state;
// nothing in this file invents status.

import { useState } from "react";
import Link from "next/link";
import {
  ArrowDownFilled,
  DangerFilled,
  JudgeFilled,
  PlayFilled,
  TickCircleFilled,
} from "@aliimam/icons";
import { TimeAgo } from "@/components/shared/time-ago";
import { statusPill } from "@/lib/ui/status-colors";
import { cn } from "@/lib/utils";
import type {
  OperationsView,
  OpsAccomplishment,
  OpsAttentionItem,
  OpsHumanGate,
  OpsLoopState,
  OpsRunningItem,
  OpsTaskState,
  OpsUpNextItem,
} from "@/lib/operations/operations-read-model";
import type { TaskOpReason } from "@/lib/operations/operations-classify";

export const OVERALL_PILL: Record<OperationsView["overall"], string> = {
  running: "bg-amber-500/15 text-amber-400",
  idle: "bg-foreground/5 text-foreground/50",
  degraded: "bg-orange-500/15 text-orange-400",
  blocked: "bg-red-500/15 text-red-400",
  unhealthy: "bg-red-500/20 text-red-400",
};

export function SectionHeading({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-foreground/40">
      {children}
      {count !== undefined && (
        <span className="rounded-full bg-foreground/5 px-1.5 py-0.5 text-[10px] tabular-nums">{count}</span>
      )}
    </h2>
  );
}

/**
 * Cap long lists so the overview stays scannable; the full set stays one
 * click away. Count badges always show the real total — never the visible cap.
 */
function useShowAll<T>(items: readonly T[], cap: number): {
  visible: readonly T[];
  toggle: React.ReactNode;
} {
  const [showAll, setShowAll] = useState(false);
  if (items.length <= cap) return { visible: items, toggle: null };
  return {
    visible: showAll ? items : items.slice(0, cap),
    toggle: (
      <button
        type="button"
        onClick={() => setShowAll((value) => !value)}
        className="text-[10px] text-foreground/35 hover:text-foreground/70 transition-colors"
      >
        {showAll ? "Show fewer" : `Show all ${items.length}`}
      </button>
    ),
  };
}

function LoopPill({ name, loop }: { name: string; loop: OpsLoopState }) {
  const bad = loop.status === "stopped" || loop.stale || !!loop.lastError;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px]",
        bad ? "bg-red-500/10 text-red-400" : "bg-emerald-500/10 text-emerald-400/80",
      )}
      title={[
        `${name}: ${loop.status}${loop.stale ? " (stale)" : ""}`,
        loop.lastCheck ? `last check ${loop.lastCheck}` : "no check recorded",
        loop.lastError ? `last error: ${loop.lastError}` : "",
      ].filter(Boolean).join("\n")}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", bad ? "bg-red-400" : "bg-emerald-400")} />
      {name}
      {loop.stale ? " · stale" : loop.status === "stopped" ? " · stopped" : ""}
    </span>
  );
}

/** 1. System indicator — verdict, loops, and when it was computed. */
export function SystemSection({ view }: { view: OperationsView }) {
  const { system, counts } = view;
  return (
    <section className="rounded-md bg-card p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-[0.14em]", OVERALL_PILL[view.overall])}>
          {view.overall}
        </span>
        <span className="text-xs text-foreground/60">{view.overallDetail}</span>
        <span className="ml-auto text-[10px] text-foreground/30" title={view.generatedAt}>
          computed <TimeAgo date={view.generatedAt} format="short" className="!text-[10px] text-foreground/30" />
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <LoopPill name="worker" loop={system.worker} />
        <LoopPill name="auto-run" loop={system.autoRun} />
        <LoopPill name="watchdog" loop={system.watchdog} />
        <LoopPill name="decision reconciler" loop={system.decisionReconciler} />
        <LoopPill name="chain watcher" loop={system.chainWatcher} />
      </div>
      <div className="flex flex-wrap gap-3 text-[11px] text-foreground/50">
        <span>{counts.runsActive}/{counts.maxConcurrentRuns} run slots in use</span>
        <span>{counts.tasksOpen} open · {counts.tasksInProgress} in progress</span>
        <span>{counts.ready} ready</span>
        <span>{counts.waiting} waiting</span>
        {system.health.failing.length > 0 && (
          <span className="text-red-400">failing checks: {system.health.failing.join(", ")}</span>
        )}
      </div>
    </section>
  );
}

/** 2. Attention — errors, stale state, gates, exhausted retries, blocking impact. */
export function AttentionSection({ items }: { items: OpsAttentionItem[] }) {
  const { visible, toggle } = useShowAll(items, 10);
  return (
    <section className="rounded-md bg-card p-3 space-y-2">
      <SectionHeading count={items.length}>Attention</SectionHeading>
      {items.length === 0 ? (
        <p className="text-[11px] text-foreground/35">Nothing needs attention.</p>
      ) : (
        <ul className="space-y-1.5">
          {visible.map((item, index) => (
            <li key={`${item.reason}-${item.taskId ?? item.message}-${index}`} className="flex items-start gap-2">
              <DangerFilled className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", item.severity === "critical" ? "text-red-400" : "text-orange-400")} />
              <div className="min-w-0 text-[11px] leading-4">
                <ItemLink actionUrl={item.actionUrl} className="font-medium text-foreground/80 hover:text-foreground">
                  {item.message}
                </ItemLink>
                {item.detail && <span className="text-foreground/45"> — {item.detail}</span>}
                {item.blockedDownstreamTaskIds.length > 0 && (
                  <span className="text-amber-400/80">
                    {" "}· blocking {item.blockedDownstreamTaskIds.length} downstream ({item.blockedDownstreamTaskIds.slice(0, 5).join(", ")}{item.blockedDownstreamTaskIds.length > 5 ? "…" : ""})
                  </span>
                )}
                <span className="text-foreground/25"> · {item.source}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {toggle}
    </section>
  );
}

function ItemLink({
  actionUrl,
  className,
  children,
}: {
  actionUrl?: string;
  className?: string;
  children: React.ReactNode;
}) {
  if (!actionUrl) return <span className={className}>{children}</span>;
  return <Link href={actionUrl} className={cn(className, "underline-offset-2 hover:underline")}>{children}</Link>;
}

function elapsed(started?: string): string | null {
  if (!started) return null;
  const ms = Date.now() - Date.parse(started);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** 3. Running now — live run claims with agent progress and elapsed time. */
export function RunningSection({ items }: { items: OpsRunningItem[] }) {
  return (
    <section className="rounded-md bg-card p-3 space-y-2">
      <SectionHeading count={items.length}>Running Now</SectionHeading>
      {items.length === 0 ? (
        <p className="text-[11px] text-foreground/35">No runs active.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li key={item.runId} className="flex items-start gap-2 text-[11px] leading-4">
              <PlayFilled className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-400" />
              <div className="min-w-0">
                <Link href={item.actionUrl} className="font-medium text-foreground/80 hover:text-foreground hover:underline underline-offset-2">
                  {item.chainName ?? item.runId}
                </Link>
                {item.kind !== "execution" && (
                  <span className="ml-1.5 rounded-full bg-purple-500/10 px-1.5 py-0.5 text-[10px] text-purple-300">
                    {item.kind.replace(/_/g, " ")}
                  </span>
                )}
                <div className="text-foreground/45">
                  {item.taskId && <span className="font-mono">{item.taskId}</span>}
                  {item.taskTitle && <span> {item.taskTitle}</span>}
                  {/* execution goals are user-authored; system-run "goals" are
                      generated prompts — noise, not information */}
                  {!item.taskId && item.kind === "execution" && item.goal && <span>{item.goal}</span>}
                </div>
                <div className="text-[10px] text-foreground/35">
                  {item.agentsComplete}/{item.agentsTotal} agents complete
                  {item.agentsActive > 0 && ` · ${item.agentsActive} active`}
                  {elapsed(item.started) && ` · ${elapsed(item.started)} elapsed`}
                  {` · ${item.status}`}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** 4. Expected next — the dispatch order plus dependency lookahead, with reasons. */
export function UpNextSection({ items }: { items: OpsUpNextItem[] }) {
  return (
    <section className="rounded-md bg-card p-3 space-y-2">
      <SectionHeading count={items.length}>Expected Next</SectionHeading>
      <p className="text-[10px] text-foreground/30">
        Expected order from the live admission gate — dispatch races can reorder it.
      </p>
      {items.length === 0 ? (
        <p className="text-[11px] text-foreground/35">Nothing is queued.</p>
      ) : (
        <ol className="space-y-1.5">
          {items.map((item) => (
            <li key={item.taskId} className="flex items-start gap-2 text-[11px] leading-4">
              <span className="mt-0.5 w-5 shrink-0 text-right font-mono text-[10px] text-foreground/30">{item.position}.</span>
              <div className="min-w-0">
                <Link href={item.actionUrl} className="font-medium text-foreground/80 hover:text-foreground hover:underline underline-offset-2">
                  <span className="font-mono text-foreground/50">{item.taskId}</span> {item.title}
                </Link>
                <span className={cn("ml-1.5 rounded-full px-1.5 py-0.5 text-[10px]", statusPill(item.reason === "ready" ? "complete" : "pending"))}>
                  {item.reason === "ready" ? "ready" : item.reason === "queued_capacity" ? "queued" : "after deps"}
                </span>
                <div className="text-foreground/45">{item.detail}</div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

const WAITING_GROUPS: Array<{ label: string; reasons: TaskOpReason[] }> = [
  { label: "Dependencies", reasons: ["blocked_dependency", "blocked_failed_dependency"] },
  { label: "Capacity", reasons: ["queued_capacity"] },
  { label: "Automation Paused", reasons: ["paused_retries_exhausted", "paused_manual"] },
  { label: "Outcome Audit", reasons: ["outcome_audit_pending"] },
  { label: "Recommendation / Generation", reasons: ["awaiting_recommendation", "awaiting_generation", "awaiting_execution"] },
  { label: "Human Decision", reasons: ["waiting_human_decision"] },
];

function WaitingGroup({ label, states }: { label: string; states: OpsTaskState[] }) {
  const { visible, toggle } = useShowAll(states, 8);
  return (
    <div className="space-y-1">
      <h3 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground/30">
        {label}
        <span className="tabular-nums text-foreground/25">{states.length}</span>
      </h3>
      <ul className="space-y-1">
        {visible.map((state) => (
          <li key={state.taskId} className="text-[11px] leading-4">
            <Link href={state.actionUrl} className="font-mono text-foreground/50 hover:text-foreground hover:underline underline-offset-2">
              {state.taskId}
            </Link>{" "}
            <span className="text-foreground/70">{state.title}</span>
            <span className="text-foreground/40"> — {state.detail}</span>
            {state.causalPath.length > 1 && (
              <span className="text-foreground/30"> · root cause {state.causalPath[0]}</span>
            )}
            {state.hasIndependentBlockers && (
              <span className="text-foreground/30"> · multiple independent blockers</span>
            )}
          </li>
        ))}
      </ul>
      {toggle}
    </div>
  );
}

/** 5. Waiting — grouped by what each task is actually waiting on. */
export function WaitingSection({ states }: { states: OpsTaskState[] }) {
  const groups = WAITING_GROUPS
    .map((group) => ({
      ...group,
      states: states.filter((state) => group.reasons.includes(state.reason)),
    }))
    .filter((group) => group.states.length > 0);
  return (
    <section className="rounded-md bg-card p-3 space-y-2">
      <SectionHeading count={states.length}>Waiting</SectionHeading>
      {groups.length === 0 ? (
        <p className="text-[11px] text-foreground/35">Nothing is waiting.</p>
      ) : (
        groups.map((group) => (
          <WaitingGroup key={group.label} label={group.label} states={group.states} />
        ))
      )}
    </section>
  );
}

/** 6. Human gates — decisions and run reviews waiting on a person. */
export function GatesSection({ gates }: { gates: OpsHumanGate[] }) {
  const { visible, toggle } = useShowAll(gates, 10);
  return (
    <section className="rounded-md bg-card p-3 space-y-2">
      <SectionHeading count={gates.length}>Human Gates</SectionHeading>
      {gates.length === 0 ? (
        <p className="text-[11px] text-foreground/35">No decisions or reviews are waiting on you.</p>
      ) : (
        <ul className="space-y-1.5">
          {visible.map((gate, index) => (
            // Composite key: several review tasks can point at one decision id.
            <li key={`${gate.kind}:${gate.taskId ?? ""}:${gate.decisionId ?? index}`} className="flex items-start gap-2 text-[11px] leading-4">
              <JudgeFilled className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-400" />
              <div className="min-w-0">
                <Link href={gate.actionUrl} className="font-medium text-foreground/80 hover:text-foreground hover:underline underline-offset-2">
                  {gate.title}
                </Link>
                <div className="text-foreground/45">
                  {gate.detail}
                  {gate.decisionId && <span className="font-mono text-foreground/30"> · {gate.decisionId}</span>}
                  {gate.taskId && <span className="font-mono text-foreground/30"> · {gate.taskId}</span>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {toggle}
    </section>
  );
}

/** 7. Recent accomplishments — audited completions with evidence and artifacts. */
export function AccomplishmentsSection({ items }: { items: OpsAccomplishment[] }) {
  return (
    <section className="rounded-md bg-card p-3 space-y-2">
      <SectionHeading count={items.length}>Recent Accomplishments</SectionHeading>
      {items.length === 0 ? (
        <p className="text-[11px] text-foreground/35">
          No audited completions yet — accomplishments appear once a task closes with a passing completion audit.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {items.map((item) => (
            <li key={item.taskId} className="flex items-start gap-2 text-[11px] leading-4">
              <TickCircleFilled className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
              <div className="min-w-0 space-y-0.5">
                <div>
                  <Link href={item.actionUrl} className="font-medium text-foreground/80 hover:text-foreground hover:underline underline-offset-2">
                    <span className="font-mono text-foreground/50">{item.taskId}</span> {item.headline ?? item.title}
                  </Link>
                  {item.closedAt && (
                    <span className="ml-1.5 text-[10px] text-foreground/30">
                      <TimeAgo date={item.closedAt} format="short" className="!text-[10px] text-foreground/30" />
                    </span>
                  )}
                </div>
                {item.narrative && <p className="text-foreground/50">{item.narrative}</p>}
                {item.evidence.length > 0 && (
                  <p className="text-foreground/40">
                    <span className="text-foreground/30">evidence:</span> {item.evidence.slice(0, 3).join(" · ")}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-foreground/35">
                  {item.auditVerdict && (
                    <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-emerald-400/80">
                      audit: {item.auditVerdict}
                    </span>
                  )}
                  {item.sourceRunId && (
                    <Link href={`/runs?runId=${encodeURIComponent(item.sourceRunId)}`} className="font-mono hover:text-foreground">
                      {item.sourceRunId}
                    </Link>
                  )}
                  {item.artifactCount > 0 && (
                    <span title={item.artifacts.map((a) => a.path).join("\n")}>
                      {item.artifactCount} artifact{item.artifactCount === 1 ? "" : "s"}
                      {item.artifacts.length > 0 && `: ${item.artifacts.map((a) => a.name).slice(0, 3).join(", ")}${item.artifactCount > 3 ? "…" : ""}`}
                    </span>
                  )}
                  {item.unlockedTaskIds.length > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-amber-400/80">
                      <ArrowDownFilled className="h-2.5 w-2.5" />
                      unlocked {item.unlockedTaskIds.join(", ")}
                    </span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
