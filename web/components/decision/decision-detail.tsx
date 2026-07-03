"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  TrashFilled,
  SendFilled,
  RefreshFilled,
  BookFilled,
  NextFilled,
  TaskSquareFilled,
} from "@aliimam/icons";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { unwrapApiData } from "@/lib/api/api-client";
import type { Decision } from "@/lib/decisions/decision-types";
import { Button } from "@/components/ui/button";
import { RaisedButton } from "@/components/ui/raised-button";
import { BackButton } from "@/components/ui/back-button";
import { WorkflowSidebarSegmentedControl } from "@/components/ui/workflow-sidebar";
import { GuidedFlowShell } from "@/components/guided-flow/guided-flow-shell";
import { BriefingCarousel } from "./briefing-carousel";
import { VerdictCard } from "./verdict-card";
import { OverviewTab } from "./overview-tab";
import { OptionsTab } from "./options-tab";
import { ContextTab } from "./context-tab";
import { HistoryTab } from "./history-tab";
import { ApprovalBar } from "./approval-bar";
import {
  statusBadge,
  priorityBadge,
  confidenceTone,
  inferBlastRadius,
  formatDate,
  DetailSecondaryButton,
} from "./decision-shared";
import { cn } from "@/lib/utils";

interface DecisionDetailProps {
  decisionId: string;
  workspacePath?: string;
  onBack?: () => void;
  onUpdate?: () => void;
  onDelete?: () => void;
  onOpenTask?: (taskId: string) => void;
}

type DetailTab = "overview" | "options" | "context" | "history";

/** Append workspace query param to a URL path if workspace is available */
function wsUrl(path: string, workspacePath?: string): string {
  if (!workspacePath) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}workspace=${encodeURIComponent(workspacePath)}`;
}

function runHref(runId: string): string {
  return `/runs?runId=${encodeURIComponent(runId)}`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function DecisionDetail({
  decisionId,
  workspacePath,
  onBack,
  onUpdate,
  onDelete,
  onOpenTask,
}: DecisionDetailProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [decision, setDecisionRaw] = useState<Decision | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [resolving, setResolving] = useState(false);
  const [researching, setResearching] = useState(false);
  const [showSteering, setShowSteering] = useState(false);
  const [steeringPrompt, setSteeringPrompt] = useState("");
  const [retroLoading, setRetroLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [viewMode, setViewMode] = useState<"dashboard" | "guided" | "briefing">("dashboard");

  // backfill missing option letters (A, B, C...) for older decisions
  const setDecision = useCallback((d: Decision | null) => {
    if (d?.options) {
      d = {
        ...d,
        options: d.options.map((opt, i) => ({
          ...opt,
          letter: opt.letter || String.fromCharCode(65 + i),
        })),
      };
    }
    setDecisionRaw(d);
  }, []);

  const fetchDecision = useCallback(async () => {
    try {
      const res = await fetchWithNamespace(wsUrl(`/api/decisions/${decisionId}`, workspacePath));
      if (res.ok) {
        const raw = await res.json();
        const data = unwrapApiData<{ decision?: Decision }>(raw);
        setDecision(data.decision ?? null);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [decisionId, workspacePath, fetchWithNamespace, setDecision]);

  const pollDecisionUntil = useCallback(async (
    predicate: (candidate: Decision) => boolean,
    maxAttempts = 120,
  ): Promise<Decision | null> => {
    for (let i = 0; i < maxAttempts; i++) {
      await wait(2000);
      const res = await fetchWithNamespace(wsUrl(`/api/decisions/${decisionId}`, workspacePath));
      if (!res.ok) continue;
      const raw = await res.json();
      const data = unwrapApiData<{ decision?: Decision }>(raw);
      if (!data.decision) continue;
      setDecision(data.decision);
      if (predicate(data.decision)) return data.decision;
    }
    return null;
  }, [decisionId, workspacePath, fetchWithNamespace, setDecision]);

  useEffect(() => {
    setLoading(true);
    setSelectedOptionId(null);
    setNotes("");
    setShowSteering(false);
    setSteeringPrompt("");
    setActiveTab("overview");
    fetchDecision();
  }, [fetchDecision]);

  // resolve initial viewMode from decision state
  // new pending/briefed decisions default to guided unless explicitly set to classic
  useEffect(() => {
    if (!decision) return;
    if (decision.status === "briefed") {
      // briefed = research done, show the brief carousel first
      setViewMode("briefing");
    } else if (decision.status !== "pending") {
      setViewMode("dashboard");
    } else if (decision.mode === "classic") {
      setViewMode("dashboard");
    } else {
      // pending + no mode or mode=guided -> guided
      setViewMode("guided");
    }
  }, [decision?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (
      (decision?.status === "pending" || decision?.status === "briefed") &&
      !selectedOptionId &&
      decision?.recommendation?.choiceId
    ) {
      setSelectedOptionId(decision.recommendation.choiceId);
    }
  }, [decision, selectedOptionId]);

  const resumeResearchRef = useRef(false);
  useEffect(() => {
    if (decision?.status === "researching" && decision.researchRunId && !resumeResearchRef.current) {
      resumeResearchRef.current = true;
      (async () => {
        setResearching(true);
        const runId = decision.researchRunId;
        try {
          const updated = await pollDecisionUntil((candidate) =>
            candidate.researchRunId === runId && candidate.status !== "researching"
          );
          if (updated?.status === "briefed") setViewMode("briefing");
        } catch {
          // ignore
        } finally {
          setResearching(false);
          fetchDecision();
        }
      })();
      return;
    }

    if (decision?.activeJobId && !resumeResearchRef.current) {
      resumeResearchRef.current = true;
      (async () => {
        setResearching(true);
        const jobId = decision.activeJobId;
        try {
          for (let i = 0; i < 120; i++) {
            await wait(2000);
            const poll = await fetchWithNamespace(`/api/jobs/${jobId}`);
            const pollRaw = await poll.json();
            const job = unwrapApiData<{ status: string }>(pollRaw);
            if (job.status === "complete") {
              const apply = await fetchWithNamespace(wsUrl(`/api/decisions/${decisionId}/research`, workspacePath), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ jobId }),
              });
              const applyRaw = await apply.json();
              const data = unwrapApiData<{ decision?: Decision }>(applyRaw);
              if (data.decision) {
                setDecision(data.decision);
                setViewMode("briefing");
              }
              return;
            }
            if (job.status === "failed") return;
          }
        } catch {
          // ignore
        } finally {
          setResearching(false);
          fetchDecision();
        }
      })();
    }
  }, [decision?.activeJobId, decision?.researchRunId, decision?.status, pollDecisionUntil, decisionId, workspacePath, fetchWithNamespace, fetchDecision, setDecision]);

  const resumeRetroRef = useRef(false);
  useEffect(() => {
    if (decision?.retroJobId && !resumeRetroRef.current) {
      resumeRetroRef.current = true;
      (async () => {
        setRetroLoading(true);
        const jobId = decision.retroJobId;
        try {
          for (let i = 0; i < 120; i++) {
            await wait(2000);
            const poll = await fetchWithNamespace(`/api/jobs/${jobId}`);
            const pollRaw = await poll.json();
            const job = unwrapApiData<{ status: string }>(pollRaw);
            if (job.status === "complete") {
              const apply = await fetchWithNamespace(wsUrl(`/api/decisions/${decisionId}/retrospective`, workspacePath), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ jobId }),
              });
              const applyRaw = await apply.json();
              const data = unwrapApiData<{ decision?: Decision }>(applyRaw);
              if (data.decision) setDecision(data.decision);
              return;
            }
            if (job.status === "failed") return;
          }
        } catch {
          // ignore
        } finally {
          setRetroLoading(false);
          fetchDecision();
        }
      })();
    }
  }, [decision?.retroJobId, decisionId, workspacePath, fetchWithNamespace, fetchDecision, setDecision]);

  // reset resume refs on decision switch
  useEffect(() => {
    resumeResearchRef.current = false;
    resumeRetroRef.current = false;
  }, [decisionId]);

  const triggerResearch = useCallback(
    async (steering?: string) => {
      setResearching(true);
      setShowSteering(false);
      try {
        const res = await fetchWithNamespace(wsUrl(`/api/decisions/${decisionId}/research`, workspacePath), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(steering ? { steering } : {}),
        });
        if (!res.ok) return;
        const resRaw = await res.json();
        const data = unwrapApiData<{ jobId?: string; runId?: string; decision?: Decision }>(resRaw);
        if (data.decision) setDecision(data.decision);

        if (data.runId) {
          const updated = await pollDecisionUntil((candidate) =>
            candidate.researchRunId === data.runId && candidate.status !== "researching"
          );
          if (updated?.status === "briefed") setViewMode("briefing");
          return;
        }

        const jobId = data.jobId;
        if (!jobId) return;

        for (let i = 0; i < 120; i++) {
          await wait(2000);
          const poll = await fetchWithNamespace(`/api/jobs/${jobId}`);
          const pollRaw = await poll.json();
          const job = unwrapApiData<{ status: string }>(pollRaw);
          if (job.status === "complete") {
            const apply = await fetchWithNamespace(wsUrl(`/api/decisions/${decisionId}/research`, workspacePath), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ jobId }),
            });
            const applyRaw = await apply.json();
            const data = unwrapApiData<{ decision?: Decision }>(applyRaw);
            if (data.decision) {
              setDecision(data.decision);
              setViewMode("briefing");
            }
            return;
          }
          if (job.status === "failed") return;
        }
      } catch {
        // ignore
      } finally {
        setResearching(false);
        setSteeringPrompt("");
        fetchDecision();
      }
    },
    [decisionId, workspacePath, fetchWithNamespace, fetchDecision, pollDecisionUntil, setDecision]
  );

  const autoResearchFiredRef = useRef(false);
  useEffect(() => {
    autoResearchFiredRef.current = false;
  }, [decisionId]);

  useEffect(() => {
    if (
      decision &&
      decision.status === "intake" &&
      !decision.brief &&
      decision.options.length === 0 &&
      !researching &&
      !autoResearchFiredRef.current
    ) {
      autoResearchFiredRef.current = true;
      triggerResearch();
    }
  }, [decision, researching, triggerResearch]);

  const handleResolve = useCallback(async () => {
    if (!selectedOptionId || resolving) return;
    setResolving(true);
    try {
      // auto-generate execution plan if one doesn't exist yet
      const hasPlan = decision?.guidedFlow?.round3?.plan;
      if (!hasPlan) {
        const planRes = await fetchWithNamespace(
          wsUrl(`/api/decisions/${decisionId}/guided/plan`, workspacePath),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ selectedOptionId }),
          }
        );
        if (planRes.ok) {
          const planRaw = await planRes.json();
          const planData = unwrapApiData<{ jobId?: string; runId?: string; decision?: Decision }>(planRaw);
          if (planData.decision) setDecision(planData.decision);

          if (planData.runId) {
            await pollDecisionUntil((candidate) =>
              candidate.guidedFlow?.round3?.generationRunId === planData.runId &&
              !!candidate.guidedFlow?.round3?.plan
            );
          } else if (planData.jobId) {
            // legacy job fallback
            for (let i = 0; i < 120; i++) {
              await wait(2000);
              const poll = await fetchWithNamespace(`/api/jobs/${planData.jobId}`);
              const pollRaw = await poll.json();
              const job = unwrapApiData<{ status: string }>(pollRaw);
              if (job.status === "complete") {
                const apply = await fetchWithNamespace(
                  wsUrl(`/api/decisions/${decisionId}/guided/plan`, workspacePath),
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ jobId: planData.jobId }),
                  }
                );
                const applyRaw = await apply.json();
                const result = unwrapApiData<{ decision?: Decision }>(applyRaw);
                if (result.decision) setDecision(result.decision);
                break;
              }
              if (job.status === "failed") break;
            }
          }
        }
      }

      const res = await fetchWithNamespace(wsUrl(`/api/decisions/${decisionId}/resolve`, workspacePath), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedOptionId, notes: notes || undefined }),
      });
      if (res.ok) {
        const resRaw = await res.json();
        const data = unwrapApiData<{ decision?: Decision }>(resRaw);
        setDecision(data.decision ?? null);
        onUpdate?.();
      }
    } catch {
      // ignore
    } finally {
      setResolving(false);
    }
  }, [decisionId, workspacePath, decision, selectedOptionId, notes, resolving, fetchWithNamespace, onUpdate, pollDecisionUntil, setDecision]);

  const handleSkip = useCallback(async () => {
    try {
      await fetchWithNamespace(wsUrl(`/api/decisions/${decisionId}`, workspacePath), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "skipped" }),
      });
      fetchDecision();
      onUpdate?.();
    } catch {
      // ignore
    }
  }, [decisionId, workspacePath, fetchWithNamespace, fetchDecision, onUpdate]);

  const handleDelete = useCallback(async () => {
    try {
      await fetchWithNamespace(wsUrl(`/api/decisions/${decisionId}`, workspacePath), {
        method: "DELETE",
      });
      onDelete?.();
      onUpdate?.();
    } catch {
      // ignore
    }
  }, [decisionId, workspacePath, fetchWithNamespace, onDelete, onUpdate]);

  const triggerRetrospective = useCallback(async () => {
    setRetroLoading(true);
    try {
      const res = await fetchWithNamespace(wsUrl(`/api/decisions/${decisionId}/retrospective`, workspacePath), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) return;
      const resRaw = await res.json();
      const { jobId } = unwrapApiData<{ jobId: string }>(resRaw);

      for (let i = 0; i < 120; i++) {
        await wait(2000);
        const poll = await fetchWithNamespace(`/api/jobs/${jobId}`);
        const pollRaw = await poll.json();
        const job = unwrapApiData<{ status: string }>(pollRaw);
        if (job.status === "complete") {
          const apply = await fetchWithNamespace(wsUrl(`/api/decisions/${decisionId}/retrospective`, workspacePath), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId }),
          });
          const applyRaw = await apply.json();
          const data = unwrapApiData<{ decision?: Decision }>(applyRaw);
          if (data.decision) setDecision(data.decision);
          return;
        }
        if (job.status === "failed") return;
      }
    } catch {
      // ignore
    } finally {
      setRetroLoading(false);
      fetchDecision();
    }
  }, [decisionId, workspacePath, fetchWithNamespace, fetchDecision, setDecision]);

  // keyboard navigation for dashboard mode
  useEffect(() => {
    if (!decision || (decision.status !== "pending" && decision.status !== "briefed") || viewMode !== "dashboard") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement).tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;

      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        event.preventDefault();
        setSelectedOptionId((previous) => {
          const options = decision.options;
          if (!previous) return options[0]?.id ?? null;
          const index = options.findIndex((option) => option.id === previous);
          return options[(index + 1) % options.length]?.id ?? previous;
        });
      }

      if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        setSelectedOptionId((previous) => {
          const options = decision.options;
          if (!previous) return options[options.length - 1]?.id ?? null;
          const index = options.findIndex((option) => option.id === previous);
          return options[(index - 1 + options.length) % options.length]?.id ?? previous;
        });
      }

      if (event.key === "Enter" && !event.metaKey && !event.ctrlKey && selectedOptionId) {
        event.preventDefault();
        handleResolve();
      }

      // mode switches
      if (event.key === "g") {
        event.preventDefault();
        setViewMode("guided");
      }
      if (event.key === "b") {
        event.preventDefault();
        setViewMode("briefing");
      }
      if (event.key === "Escape") {
        if (viewMode !== "dashboard") {
          event.preventDefault();
          setViewMode("dashboard");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [decision, selectedOptionId, handleResolve, viewMode]);

  // global escape to return to dashboard from other modes
  useEffect(() => {
    if (viewMode === "dashboard") return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setViewMode("dashboard");
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [viewMode]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        loading...
      </div>
    );
  }

  if (!decision) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        decision not found
      </div>
    );
  }

  const isPending = decision.status === "pending" || decision.status === "briefed";
  const isResolved =
    decision.status === "approved" ||
    decision.status === "in_progress" ||
    decision.status === "done";

  const recommendedOption = decision.options.find(
    (option) => option.id === decision.recommendation?.choiceId
  );
  const selectedOption = decision.options.find(
    (option) =>
      option.id ===
      (isResolved ? decision.resolution?.selectedOptionId : selectedOptionId ?? decision.recommendation?.choiceId)
  );
  const blastRadius = inferBlastRadius(decision);
  const implementationTaskId = decision.resolution?.taskId;
  const implementationHref = implementationTaskId
    ? `/tasks?task=${encodeURIComponent(implementationTaskId)}`
    : null;
  const linkedRuns = [
    { label: "research", runId: decision.researchRunId },
    { label: "questions", runId: decision.guidedFlow?.round1.generationRunId },
    { label: "options", runId: decision.guidedFlow?.round2.generationRunId },
    { label: "plan", runId: decision.guidedFlow?.round3.generationRunId },
    { label: "retro", runId: decision.retroRunId },
  ].filter((item): item is { label: string; runId: string } => Boolean(item.runId));

  return (
    <div className="flex h-full flex-col">
      {/* header - always visible */}
      <div className="px-4 py-3 shrink-0">
        {onBack && <BackButton onBack={onBack} hideFrom="md" />}

        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-medium leading-tight line-clamp-2">
              {decision.title || decision.prompt}
            </h2>
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              {statusBadge(decision.status)}
              {priorityBadge(decision.priority)}
              {decision.category && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-accent text-foreground/70">
                  {decision.category}
                </span>
              )}
              <span className="text-[10px] text-foreground/30 ml-auto">
                {formatDate(decision.updatedAt)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {isPending && viewMode === "dashboard" && (
              <RaisedButton
                onClick={handleResolve}
                disabled={!selectedOptionId || resolving}
                color="#00bbff"
                className="h-7 px-3 text-xs font-semibold disabled:opacity-40"
              >
                <SendFilled className="h-3 w-3" />
                {resolving ? (decision.guidedFlow?.round3?.plan ? "Creating tasks..." : "Generating plan...") : selectedOption ? `Approve ${selectedOption.letter || selectedOption.name}` : "Approve"}
              </RaisedButton>
            )}

            {!isPending && implementationHref && (
              <Button
                size="sm"
                variant="default"
                className="h-7 text-xs"
                onClick={() => {
                  if (implementationTaskId && onOpenTask) {
                    onOpenTask(implementationTaskId);
                    return;
                  }
                  window.location.assign(implementationHref);
                }}
              >
                <TaskSquareFilled className="h-3 w-3 mr-1" style={{ color: "#5b9ef5" }} />
                Open task
              </Button>
            )}

            {(decision.status === "intake" || isPending) && viewMode === "dashboard" && (
              <DetailSecondaryButton
                onClick={() => {
                  if (isPending) {
                    setShowSteering((open) => !open);
                  } else {
                    triggerResearch();
                  }
                }}
                disabled={researching}
              >
                <RefreshFilled className={cn("h-3 w-3", researching && "animate-spin")} />
                {decision.status === "intake" ? "Research" : "Refine"}
              </DetailSecondaryButton>
            )}

            {isResolved && !decision.retrospective && (
              <DetailSecondaryButton
                onClick={triggerRetrospective}
                disabled={retroLoading}
              >
                <BookFilled className={cn("h-3 w-3", retroLoading && "animate-pulse")} />
                Retro
              </DetailSecondaryButton>
            )}

            {isPending && viewMode === "dashboard" && (
              <DetailSecondaryButton onClick={handleSkip}>
                <NextFilled className="h-3 w-3" />
                Skip
              </DetailSecondaryButton>
            )}

            {/* mode toggle buttons */}
            {(decision.brief || decision.options.length > 0) && viewMode !== "briefing" && (
              <DetailSecondaryButton onClick={() => setViewMode("briefing")}>
                Briefing
              </DetailSecondaryButton>
            )}

            {isPending && decision.mode !== "classic" && viewMode !== "guided" && (
              <DetailSecondaryButton onClick={() => setViewMode("guided")}>
                Guided
              </DetailSecondaryButton>
            )}

            {viewMode !== "dashboard" && (
              <DetailSecondaryButton onClick={() => setViewMode("dashboard")}>
                Dashboard
              </DetailSecondaryButton>
            )}

            <button
              type="button"
              onClick={handleDelete}
              className="h-7 w-7 inline-flex items-center justify-center rounded-md text-foreground/30 hover:bg-accent hover:text-red-400"
              title="Delete decision"
            >
              <TrashFilled className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* metadata grid */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-3 px-3 py-2.5 bg-muted rounded-md text-[10px]">
          <div className="flex items-center gap-1.5 col-span-2">
            <span className="text-foreground/30">id</span>
            <span className="text-foreground/50 font-mono select-all">{decision.id}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-foreground/30">created</span>
            <span className="text-foreground/60 font-medium">{formatDate(decision.createdAt)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-foreground/30">updated</span>
            <span className="text-foreground/60 font-medium">{formatDate(decision.updatedAt)}</span>
          </div>
          {decision.source && (
            <div className="flex items-center gap-1.5">
              <span className="text-foreground/30">source</span>
              <span className="text-foreground/60 font-medium">{decision.source}</span>
            </div>
          )}
          {recommendedOption && (
            <div className="flex items-center gap-1.5">
              <span className="text-foreground/30">recommended</span>
              <span className="text-foreground/60 font-medium">
                Option {recommendedOption.letter}
                {decision.recommendation?.confidence && (
                  <span className={cn("ml-1", confidenceTone(decision.recommendation.confidence))}>
                    ({decision.recommendation.confidence})
                  </span>
                )}
              </span>
            </div>
          )}
          {linkedRuns.length > 0 && (
            <div className="flex items-center gap-1.5 col-span-2 min-w-0">
              <span className="text-foreground/30">runs</span>
              <div className="flex items-center gap-1.5 flex-wrap">
                {linkedRuns.map((run) => (
                  <a
                    key={`${run.label}-${run.runId}`}
                    href={runHref(run.runId)}
                    className="text-[10px] font-semibold text-sky-300 hover:text-sky-200"
                  >
                    {run.label}
                  </a>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-4 col-span-2 pt-1 mt-1">
            <span className="text-foreground/30">
              <span className="text-foreground/60 font-medium">{decision.options.length}</span> options
            </span>
            <span className="text-foreground/30">
              <span className="text-foreground/60 font-medium">{decision.context?.affectedAreas?.length ?? 0}</span> areas
            </span>
            <span className="text-foreground/30">
              <span className="text-foreground/60 font-medium">{(decision.context?.references ?? []).length}</span> refs
            </span>
            <span className="text-foreground/30">
              blast: <span className={cn("font-medium", blastRadius === "high" ? "text-rose-300" : blastRadius === "medium" ? "text-amber-300" : "text-foreground/60")}>{blastRadius}</span>
            </span>
          </div>
        </div>
      </div>

      {/* body - switches on viewMode */}
      {viewMode === "briefing" ? (
        <BriefingCarousel
          decision={decision}
          onExit={() => setViewMode(decision.status === "briefed" ? "guided" : "dashboard")}
          onOpenTask={onOpenTask}
        />
      ) : viewMode === "guided" ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <GuidedFlowShell
            decision={decision}
            workspacePath={workspacePath}
            onUpdate={(d) => setDecision(d)}
            onExit={() => setViewMode("dashboard")}
            selectedOptionId={selectedOptionId}
            onSelectedOptionChange={setSelectedOptionId}
          />
        </div>
      ) : (
        <>
          {/* verdict card */}
          <VerdictCard decision={decision} mode={isResolved ? "approved" : "pending"} />

          {/* tab bar */}
          <div className="shrink-0 px-4 pb-2">
            <WorkflowSidebarSegmentedControl
              options={[
                { value: "overview" as const, label: "Overview" },
                { value: "options" as const, label: `Options (${decision.options.length})` },
                { value: "context" as const, label: "Context" },
                { value: "history" as const, label: "History" },
              ]}
              value={activeTab}
              onChange={(v) => setActiveTab(v as DetailTab)}
              className="w-full"
            />
          </div>

          {/* tab content */}
          <div className="flex-1 overflow-y-auto">
            {activeTab === "overview" && (
              <OverviewTab
                decision={decision}
                recommendedOption={recommendedOption}
                selectedOption={selectedOption}
                showSteering={showSteering}
                setShowSteering={setShowSteering}
                steeringPrompt={steeringPrompt}
                setSteeringPrompt={setSteeringPrompt}
                triggerResearch={triggerResearch}
                researching={researching}
                isPending={isPending}
                notes={notes}
                setNotes={setNotes}
              />
            )}

            {activeTab === "options" && (
              <OptionsTab
                decision={decision}
                isPending={isPending}
                isResolved={isResolved}
                selectedOptionId={selectedOptionId}
                setSelectedOptionId={setSelectedOptionId}
              />
            )}

            {activeTab === "context" && (
              <ContextTab decision={decision} />
            )}

            {activeTab === "history" && (
              <HistoryTab
                decision={decision}
                retroLoading={retroLoading}
                onOpenTask={onOpenTask}
              />
            )}
          </div>

          {/* sticky approval bar */}
          {isPending && selectedOptionId && activeTab !== "overview" && (
            <ApprovalBar
              selectedOption={selectedOption}
              onApprove={handleResolve}
              onSkip={handleSkip}
              resolving={resolving}
              disabled={!selectedOptionId}
            />
          )}
        </>
      )}
    </div>
  );
}
