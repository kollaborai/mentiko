"use client";

/**
 * OnboardingRunMonitor — attach a chain run to the screen.
 *
 * Marco: "if a chain is running we need to attach the run to the screen so
 * the user can see visually that it is running." Polls the real run record
 * (the same GET /api/runs/{id} the full run page reads) every 2s until a
 * terminal status, and renders live: status pill, elapsed time, per-agent
 * status + current activity, a bounded output tail, and a terminal summary.
 *
 * Buttons are never disabled/greyed while a request is in flight — they stay
 * clickable with aria-busy + a spinner, guarded against duplicate submits.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import {
  RotateFilled,
  TickCircleFilled,
  CloseCircleFilled,
  Warning2Filled,
  ClockFilled,
  StopCircleFilled,
  ArrowRight2Filled,
} from "@aliimam/icons";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { cn, formatDuration } from "@/lib/utils";

const POLL_MS = 2000;
const OUTPUT_TAIL_LINES = 30;

const TERMINAL_RUN_STATUSES = new Set<string>([
  "completed", "failed", "stopped", "cancelled", "blocked", "stalled",
]);

const RUN_STATUS_LABEL: Record<string, string> = {
  pending: "Waiting",
  running: "Running",
  blocked: "Blocked",
  failed: "Failed",
  stopped: "Cancelled",
  completed: "Completed",
  cancelled: "Cancelled",
  stalled: "Timed Out",
};

interface MonitorStatusReason {
  actor: string;
  reason: string;
}

interface MonitorAgent {
  id: string;
  name: string;
  status: string;
  session?: string;
  lastMessage?: string;
  durableOutput?: string | null;
  statusReason?: MonitorStatusReason;
}

interface MonitorRun {
  id: string;
  status: string;
  started: string;
  completed?: string;
  status_message?: string;
  statusReason?: MonitorStatusReason;
  agents: MonitorAgent[];
}

export interface OnboardingRunMonitorProps {
  runId: string;
  title?: string;
  compact?: boolean;
  onTerminal?: (result: { status: string; runId: string }) => void;
}

function tailLines(text: string, count: number): string {
  const lines = text.split("\n");
  return lines.slice(Math.max(0, lines.length - count)).join("\n").trim();
}

export interface AnswerBlock {
  type: "heading" | "paragraph";
  text: string;
}

/**
 * Minimal, dependency-free markdown-lite formatter — not a renderer, just
 * enough that a durable summary.md answer reads as prose instead of literal
 * "# Heading" / "`code`" syntax: drop the leading title heading(s), split
 * the rest into heading/paragraph blocks, strip backticks. blocks[0] (a
 * paragraph, since leading headings are dropped) is the one-line summary.
 * Exported only for its own focused unit test.
 */
export function formatAnswerBlocks(raw: string): AnswerBlock[] {
  const lines = raw.replace(/`/g, "").split("\n").map((line) => line.trim());
  let start = 0;
  while (start < lines.length && (lines[start] === "" || /^#{1,6}\s/.test(lines[start]))) start += 1;

  const blocks: AnswerBlock[] = [];
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", text: paragraph.join(" ").trim() });
    paragraph = [];
  };
  for (const line of lines.slice(start)) {
    const heading = line.match(/^#{1,6}\s+(.*)/);
    if (heading) {
      flushParagraph();
      if (heading[1].trim()) blocks.push({ type: "heading", text: heading[1].trim() });
    } else if (line === "") {
      flushParagraph();
    } else {
      paragraph.push(line);
    }
  }
  flushParagraph();
  return blocks.filter((block) => block.text);
}

function agentStatusVisual(status: string): { Icon: typeof TickCircleFilled; className: string; spin?: boolean } {
  switch (status) {
    case "complete":
      return { Icon: TickCircleFilled, className: "text-green-400" };
    case "running":
    case "startup_recovery":
      return { Icon: RotateFilled, className: "text-amber-400", spin: true };
    case "blocked":
      return { Icon: Warning2Filled, className: "text-amber-400" };
    case "failed":
    case "error":
      return { Icon: CloseCircleFilled, className: "text-red-400" };
    case "cancelled":
    case "stopped":
      return { Icon: StopCircleFilled, className: "text-foreground/30" };
    default:
      return { Icon: ClockFilled, className: "text-foreground/30" };
  }
}

function statusTextClass(status: string): string {
  if (status === "running" || status === "pending") return "text-amber-400";
  if (status === "completed") return "text-green-400";
  if (status === "failed") return "text-red-400";
  return "text-foreground/50";
}

/** A single, consistently-amber pulsing dot — the one "live" accent (StatusIndicator pairs its ping color to state, which fights a single accent color here). */
function LiveDot({ active }: { active: boolean }) {
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0">
      {active && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
      )}
      <span className={cn("relative inline-flex h-2 w-2 rounded-full", active ? "bg-amber-400" : "bg-foreground/30")} />
    </span>
  );
}

/** The one-line summary for a durable answer: the first paragraph, heading/backtick-free. */
function answerSummary(text: string): string {
  return formatAnswerBlocks(text).find((block) => block.type === "paragraph")?.text ?? "";
}

function agentActivity(agent: MonitorAgent): string {
  // A complete agent's lastMessage is whatever the last LIVE status line was
  // before it finished (e.g. "queued: waiting for an active agent slot") —
  // never update, so once terminal-success it's stale, not current. Prefer
  // the agent's real output instead of parroting a pre-start message.
  if (agent.status === "complete") return agent.durableOutput ? answerSummary(agent.durableOutput) : "";
  if (agent.lastMessage) return agent.lastMessage;
  if (agent.durableOutput) return answerSummary(agent.durableOutput);
  if (agent.statusReason?.reason) return agent.statusReason.reason;
  return "";
}

export function OnboardingRunMonitor({ runId, title, compact = false, onTerminal }: OnboardingRunMonitorProps): JSX.Element {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [run, setRun] = useState<MonitorRun | null>(null);
  const [outputTail, setOutputTail] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [cancelBusy, setCancelBusy] = useState(false);
  const [finalAnswer, setFinalAnswer] = useState<string | null>(null);
  const cancelGuardRef = useRef(false);
  const terminalFiredRef = useRef(false);
  const finalAnswerFetchedRef = useRef(false);

  const fetchOutputTail = useCallback(async () => {
    try {
      const res = await fetchWithNamespace(`/api/runs/${encodeURIComponent(runId)}/output`);
      if (!res.ok) return;
      const text = await res.text();
      setOutputTail(tailLines(text, OUTPUT_TAIL_LINES));
    } catch {
      /* transient — the next poll tick tries again */
    }
  }, [fetchWithNamespace, runId]);

  // Show the run's actual bounded answer, not a placeholder. First
  // non-empty wins: a completed agent's durableOutput (already read
  // server-side from artifacts/{agentId}-output.txt or -summary.md), then
  // the run's raw output.log tail, then a direct read of the completed
  // agent's own summary.md via the artifacts endpoint (belt and braces —
  // durableOutput already covers this file, but this is a second path to
  // it in case that computation ever comes back empty).
  const resolveFinalAnswer = useCallback(async (finishedRun: MonitorRun) => {
    const fromAgent = finishedRun.agents.find((agent) => agent.status === "complete" && agent.durableOutput?.trim());
    if (fromAgent?.durableOutput) {
      setFinalAnswer(fromAgent.durableOutput.trim());
      return;
    }
    try {
      const res = await fetchWithNamespace(`/api/runs/${encodeURIComponent(runId)}/output`);
      if (res.ok) {
        const text = tailLines(await res.text(), OUTPUT_TAIL_LINES);
        if (text.trim()) {
          setFinalAnswer(text.trim());
          return;
        }
      }
    } catch {
      /* fall through to the artifacts fallback */
    }
    const completeAgent = finishedRun.agents.find((agent) => agent.status === "complete");
    if (completeAgent) {
      try {
        const res = await fetchWithNamespace(
          `/api/runs/${encodeURIComponent(runId)}/artifacts?path=${encodeURIComponent(`${completeAgent.id}-summary.md`)}`,
        );
        if (res.ok) {
          const payload = (await res.json()) as { content?: string };
          if (payload.content?.trim()) {
            setFinalAnswer(payload.content.trim());
            return;
          }
        }
      } catch {
        /* fall through to the final placeholder */
      }
    }
    setFinalAnswer("Completed. No text output was captured.");
  }, [fetchWithNamespace, runId]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const res = await fetchWithNamespace(`/api/runs/${encodeURIComponent(runId)}`);
        if (cancelled) return;
        if (res.status === 404) {
          setNotFound(true);
          return;
        }
        if (!res.ok) {
          timer = setTimeout(poll, POLL_MS);
          return;
        }
        const payload = (await res.json()) as { run?: MonitorRun };
        if (cancelled) return;
        if (!payload.run) {
          timer = setTimeout(poll, POLL_MS);
          return;
        }
        setRun(payload.run);
        setNotFound(false);
        const isTerminal = TERMINAL_RUN_STATUSES.has(payload.run.status);
        const hasDurableOutput = payload.run.agents?.some((agent) => Boolean(agent.durableOutput));
        if (!isTerminal && !hasDurableOutput) void fetchOutputTail();
        if (isTerminal) {
          if (!terminalFiredRef.current) {
            terminalFiredRef.current = true;
            onTerminal?.({ status: payload.run.status, runId: payload.run.id });
          }
          if (payload.run.status === "completed" && !finalAnswerFetchedRef.current) {
            finalAnswerFetchedRef.current = true;
            void resolveFinalAnswer(payload.run);
          }
          return; // reached a terminal status: stop polling
        }
        timer = setTimeout(poll, POLL_MS);
      } catch {
        if (!cancelled) timer = setTimeout(poll, POLL_MS);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // fetchOutputTail/onTerminal are stable enough in practice; re-running the
    // poll loop on every render would fight its own in-flight timers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const handleCancel = useCallback(async () => {
    if (cancelGuardRef.current) return;
    cancelGuardRef.current = true;
    setCancelBusy(true);
    try {
      const res = await fetchWithNamespace(`/api/runs/${encodeURIComponent(runId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      if (res.ok) {
        const payload = (await res.json()) as { run?: MonitorRun };
        if (payload.run) setRun(payload.run);
      }
    } catch {
      /* the next poll tick reconciles real state either way */
    } finally {
      cancelGuardRef.current = false;
      setCancelBusy(false);
    }
  }, [fetchWithNamespace, runId]);

  if (notFound) {
    return (
      <div className="rounded-lg border border-border/60 bg-card/20 p-3 text-xs text-foreground/50">
        Run not found.
      </div>
    );
  }

  if (!run) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/20 p-3 text-xs text-foreground/50">
        <RotateFilled className="h-3.5 w-3.5 animate-spin text-amber-400" />
        Loading run…
      </div>
    );
  }

  const isTerminal = TERMINAL_RUN_STATUSES.has(run.status);
  const isLive = run.status === "running" || run.status === "pending";
  const endMs = run.completed ? Date.parse(run.completed) : now;
  const elapsedMs = Math.max(0, endMs - Date.parse(run.started));
  const activeAgent = run.agents.find((agent) => agent.status === "running") ?? run.agents[run.agents.length - 1];
  const label = RUN_STATUS_LABEL[run.status] ?? run.status;

  if (compact) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2, ease: "easeOut", delay: 0.08 }}
        className="flex items-center gap-3 rounded-lg border border-border/60 bg-card/20 px-3 py-2"
      >
        <LiveDot active={isLive} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-foreground/80">
            {title ? `${title} · ` : ""}
            <span className={statusTextClass(run.status)}>{label}</span>
          </p>
          {activeAgent && (
            <p className="truncate text-[11px] text-foreground/50">
              {activeAgent.name}
              {agentActivity(activeAgent) ? ` — ${agentActivity(activeAgent)}` : ""}
            </p>
          )}
        </div>
        <span className="shrink-0 text-[11px] tabular-nums text-foreground/40">{formatDuration(elapsedMs)}</span>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut", delay: 0.08 }}
      className="space-y-3 rounded-lg border border-border/60 bg-card/20 p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground/80">{title || "Run"}</p>
        <div className="flex items-center gap-2">
          <LiveDot active={isLive} />
          <span className={cn("text-xs font-medium", statusTextClass(run.status))}>{label}</span>
          <span className="text-[11px] tabular-nums text-foreground/40">{formatDuration(elapsedMs)}</span>
        </div>
      </div>

      {run.agents.length > 0 && (
        <div className="divide-y divide-border/40">
          {run.agents.map((agent) => {
            const visual = agentStatusVisual(agent.status);
            const activity = agentActivity(agent);
            return (
              <div key={agent.id} className="flex items-start gap-2 py-1.5 first:pt-0 last:pb-0">
                <visual.Icon className={cn("mt-0.5 h-4 w-4 shrink-0", visual.className, visual.spin && "animate-spin")} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground/70">{agent.name}</p>
                  {activity && <p className="truncate text-[11px] text-foreground/50">{activity}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {outputTail && (
        <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted/30 p-2 text-[10px] font-mono leading-relaxed text-foreground/60">
          {outputTail}
        </pre>
      )}

      {isTerminal && (
        <div className="rounded-md bg-muted/20 px-3 py-2 text-xs text-foreground/60">
          {run.status !== "completed" ? (
            run.statusReason?.reason || run.status_message || `Run ${label.toLowerCase()}.`
          ) : finalAnswer === null ? (
            "Loading result…"
          ) : (
            <div className="space-y-1.5">
              {formatAnswerBlocks(finalAnswer).map((block, index) =>
                block.type === "heading" ? (
                  <p key={index} className="text-[10px] font-semibold uppercase tracking-wide text-foreground/50">
                    {block.text}
                  </p>
                ) : (
                  <p key={index} className="whitespace-pre-wrap text-foreground/60">{block.text}</p>
                ),
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-3">
        <Link
          href={`/runs/${encodeURIComponent(runId)}`}
          className="inline-flex items-center gap-1 text-xs text-foreground/50 transition-colors hover:text-foreground"
        >
          Open Full Run
          <ArrowRight2Filled className="h-3 w-3" />
        </Link>
        {!isTerminal && (
          <button
            type="button"
            onClick={handleCancel}
            aria-busy={cancelBusy}
            className="ml-auto inline-flex items-center gap-1.5 text-xs text-foreground/50 transition-colors hover:text-red-400"
          >
            {cancelBusy && <RotateFilled className="h-3 w-3 animate-spin" />}
            Cancel
          </button>
        )}
      </div>
    </motion.div>
  );
}
