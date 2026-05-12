"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { RefreshFilled, FlashCircleFilled, SearchStatusFilled } from "@aliimam/icons";
import { Abstract30Shapes, Abstract45Shapes } from "@aliimam/vectors";
import { GradientDots } from "@/components/ui/gradient-dots";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { unwrapApiData, getApiErrorMessage } from "@/lib/api-client";
import type { Decision } from "@/lib/decision-types";
import { RoundIndicator } from "./round-indicator";
import { Round1Cards } from "@/components/decision/round1-cards";
import { Round2Options } from "@/components/decision/round2-options";
import { Round3Plan } from "@/components/decision/round3-plan";
import { WaveSpinner } from "@/components/ui/wave-spinner";

interface GuidedFlowShellProps {
  decision: Decision;
  workspacePath?: string;
  onUpdate: (decision: Decision) => void;
  onExit: () => void;
  selectedOptionId: string | null;
  onSelectedOptionChange: (id: string | null) => void;
}

/** Append workspace query param to a URL path if workspace is available */
function wsUrl(path: string, workspacePath?: string): string {
  if (!workspacePath) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}workspace=${encodeURIComponent(workspacePath)}`;
}

async function pollJob(
  fetchFn: ReturnType<typeof useNamespaceFetch>["fetchWithNamespace"],
  jobId: string,
  maxAttempts = 120
): Promise<{ status: string; result?: unknown }> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const res = await fetchFn(`/api/jobs/${jobId}`);
    const raw = await res.json();
    const job = unwrapApiData<{ status: string; result?: unknown }>(raw);
    if (job.status === "complete" || job.status === "failed") return job;
  }
  return { status: "timeout" };
}

export function GuidedFlowShell({ decision, workspacePath, onUpdate, onExit, selectedOptionId, onSelectedOptionChange }: GuidedFlowShellProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [generating, setGenerating] = useState(false);
  const [synthesizing, setSynthesizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resumeRef = useRef(false);

  const flow = decision.guidedFlow;
  const currentRound = flow?.currentRound ?? 0;

  // resume polling on mount if a generation job is in progress
  useEffect(() => {
    if (resumeRef.current || !flow) return;

    // check for in-progress synthesis job first
    if (flow.round1.synthesisJobId && flow.round1.status === "synthesizing") {
      resumeRef.current = true;
      setSynthesizing(true);

      (async () => {
        try {
          const job = await pollJob(fetchWithNamespace, flow.round1.synthesisJobId!);
          if (job.status === "complete") {
            const apply = await fetchWithNamespace(
              wsUrl(`/api/decisions/${decision.id}/guided/synthesize`, workspacePath),
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ jobId: flow.round1.synthesisJobId }),
              }
            );
            const applyRaw = await apply.json();
            const applyData = unwrapApiData<{ decision?: Decision }>(applyRaw);
            if (applyData.decision) onUpdate(applyData.decision);
          } else if (job.status === "failed") {
            setError("Preference synthesis failed");
          }
        } catch {
          setError("Failed to resume synthesis");
        } finally {
          setSynthesizing(false);
        }
      })();
      return;
    }

    const activeJobId =
      flow.round1.generationJobId ||
      flow.round2.generationJobId ||
      flow.round3.generationJobId;

    if (!activeJobId) return;

    const roundEndpoint = flow.round3.generationJobId ? "plan"
      : flow.round2.generationJobId ? "options"
      : "questions";

    resumeRef.current = true;
    setGenerating(true);

    (async () => {
      try {
        const job = await pollJob(fetchWithNamespace, activeJobId);
        if (job.status === "complete") {
          const apply = await fetchWithNamespace(
            wsUrl(`/api/decisions/${decision.id}/guided/${roundEndpoint}`, workspacePath),
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ jobId: activeJobId }),
            }
          );
          const resultRaw = await apply.json();
          const resultData = unwrapApiData<{ decision?: Decision }>(resultRaw);
          if (resultData.decision) onUpdate(resultData.decision);
        } else if (job.status === "failed") {
          setError(`Generation failed: ${roundEndpoint}`);
        }
      } catch {
        setError("Failed to resume generation");
      } finally {
        setGenerating(false);
      }
    })();
  }, [flow, decision.id, fetchWithNamespace, onUpdate]);

  const startRound1 = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetchWithNamespace(
        wsUrl(`/api/decisions/${decision.id}/guided/questions`, workspacePath),
        { method: "POST" }
      );
      const raw = await res.json();
      if (!res.ok) { setError(getApiErrorMessage(raw, "Failed to start guided flow")); return; }
      const data = unwrapApiData<{ jobId: string }>(raw);

      const job = await pollJob(fetchWithNamespace, data.jobId);
      if (job.status === "complete") {
        const apply = await fetchWithNamespace(
          wsUrl(`/api/decisions/${decision.id}/guided/questions`, workspacePath),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId: data.jobId }),
          }
        );
        const resultRaw = await apply.json();
        const resultData = unwrapApiData<{ decision?: Decision }>(resultRaw);
        if (resultData.decision) onUpdate(resultData.decision);
      } else {
        setError("Question generation failed or timed out");
      }
    } catch {
      setError("Failed to start guided flow");
    } finally {
      setGenerating(false);
    }
  }, [decision.id, fetchWithNamespace, onUpdate]);

  // auto-start round 1 when research is done but guided flow hasn't started
  const autoStartRef = useRef<string | null>(null);

  const researchDone = !!decision.brief || decision.options.length > 0;

  useEffect(() => {
    if (
      autoStartRef.current !== decision.id &&
      !generating &&
      researchDone &&
      (currentRound === 0 || !flow) &&
      (!flow || flow.round1.status === "pending")
    ) {
      autoStartRef.current = decision.id;
      startRound1();
    }
  }, [decision.id, researchDone, currentRound, flow, generating, startRound1]);

  const handleAnswer = useCallback(
    async (questionId: string, choice: "a" | "b" | "skip") => {
      const res = await fetchWithNamespace(
        wsUrl(`/api/decisions/${decision.id}/guided/answer`, workspacePath),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId, choice }),
        }
      );
      if (!res.ok) {
        setError("Failed to save answer");
        return;
      }
      const raw = await res.json();
      const data = unwrapApiData<{ decision?: Decision }>(raw);
      if (data.decision) onUpdate(data.decision);
    },
    [decision.id, fetchWithNamespace, onUpdate]
  );

  const startSynthesis = useCallback(async () => {
    setSynthesizing(true);
    setError(null);
    try {
      const res = await fetchWithNamespace(
        wsUrl(`/api/decisions/${decision.id}/guided/synthesize`, workspacePath),
        { method: "POST" }
      );
      const raw = await res.json();
      if (!res.ok) { setError(getApiErrorMessage(raw, "Failed to synthesize preferences")); return; }
      const data = unwrapApiData<{ jobId: string }>(raw);

      const job = await pollJob(fetchWithNamespace, data.jobId);
      if (job.status === "complete") {
        const apply = await fetchWithNamespace(
          wsUrl(`/api/decisions/${decision.id}/guided/synthesize`, workspacePath),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId: data.jobId }),
          }
        );
        const resultRaw = await apply.json();
        const resultData = unwrapApiData<{ decision?: Decision }>(resultRaw);
        if (resultData.decision) onUpdate(resultData.decision);
      } else {
        setError("Preference synthesis failed or timed out");
      }
    } catch {
      setError("Failed to synthesize preferences");
    } finally {
      setSynthesizing(false);
    }
  }, [decision.id, fetchWithNamespace, onUpdate]);

  const startRound2 = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetchWithNamespace(
        wsUrl(`/api/decisions/${decision.id}/guided/options`, workspacePath),
        { method: "POST" }
      );
      const raw = await res.json();
      if (!res.ok) { setError(getApiErrorMessage(raw, "Failed to generate options")); return; }
      const data = unwrapApiData<{ jobId: string }>(raw);

      const job = await pollJob(fetchWithNamespace, data.jobId);
      if (job.status === "complete") {
        const apply = await fetchWithNamespace(
          wsUrl(`/api/decisions/${decision.id}/guided/options`, workspacePath),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId: data.jobId }),
          }
        );
        const resultRaw = await apply.json();
        const resultData = unwrapApiData<{ decision?: Decision }>(resultRaw);
        if (resultData.decision) onUpdate(resultData.decision);
      } else {
        setError("Option generation failed or timed out");
      }
    } catch {
      setError("Failed to generate options");
    } finally {
      setGenerating(false);
    }
  }, [decision.id, fetchWithNamespace, onUpdate]);

  // auto-start round 2 after synthesis completes
  const autoRound2Ref = useRef(false);
  useEffect(() => {
    autoRound2Ref.current = false;
  }, [decision.id]);

  useEffect(() => {
    if (
      !autoRound2Ref.current &&
      !generating &&
      !synthesizing &&
      flow &&
      flow.round1.status === "complete" &&
      flow.round2.status === "pending" &&
      currentRound >= 1
    ) {
      autoRound2Ref.current = true;
      startRound2();
    }
  }, [flow, currentRound, generating, synthesizing, startRound2]);

  // sync from persisted round2 selection on mount
  useEffect(() => {
    if (flow?.round2.selectedOptionId && !selectedOptionId) {
      onSelectedOptionChange(flow.round2.selectedOptionId);
    }
  }, [flow?.round2.selectedOptionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const startRound3 = useCallback(async () => {
    if (!selectedOptionId) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetchWithNamespace(
        wsUrl(`/api/decisions/${decision.id}/guided/plan`, workspacePath),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ selectedOptionId }),
        }
      );
      const raw = await res.json();
      if (!res.ok) { setError(getApiErrorMessage(raw, "Failed to generate plan")); return; }
      const data = unwrapApiData<{ jobId: string }>(raw);

      const job = await pollJob(fetchWithNamespace, data.jobId);
      if (job.status === "complete") {
        const apply = await fetchWithNamespace(
          wsUrl(`/api/decisions/${decision.id}/guided/plan`, workspacePath),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId: data.jobId }),
          }
        );
        const resultRaw = await apply.json();
        const resultData = unwrapApiData<{ decision?: Decision }>(resultRaw);
        if (resultData.decision) onUpdate(resultData.decision);
      } else {
        setError("Plan generation failed or timed out");
      }
    } catch {
      setError("Failed to generate plan");
    } finally {
      setGenerating(false);
    }
  }, [decision.id, selectedOptionId, fetchWithNamespace, onUpdate]);

  const [approving, setApproving] = useState(false);

  const handleApprovePlan = useCallback(async () => {
    setApproving(true);
    try {
      const optId = flow?.round2.selectedOptionId || selectedOptionId;
      const res = await fetchWithNamespace(
        wsUrl(`/api/decisions/${decision.id}/resolve`, workspacePath),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ selectedOptionId: optId }),
        }
      );
      const raw = await res.json();
      if (!res.ok) {
        setError(getApiErrorMessage(raw, "Failed to approve plan"));
        return;
      }
      const data = unwrapApiData<{ decision?: Decision }>(raw);
      if (data.decision) {
        onUpdate(data.decision);
        onExit();
      }
    } catch {
      setError("Failed to approve plan");
    } finally {
      setApproving(false);
    }
  }, [decision.id, flow, selectedOptionId, fetchWithNamespace, onUpdate, onExit]);

  const handleSelectRound = useCallback((round: 1 | 2 | 3) => {
    if (!flow) return;
    // only allow going back to completed rounds
    if (round === 1 && (flow.round1.status === "complete" || flow.round1.status === "in_progress" || flow.round1.status === "synthesizing")) {
      onUpdate({
        ...decision,
        guidedFlow: { ...flow, currentRound: 1 },
      });
    } else if (round === 2 && flow.round2.status === "ready") {
      onUpdate({
        ...decision,
        guidedFlow: { ...flow, currentRound: 2 },
      });
    } else if (round === 3 && flow.round3.status === "ready") {
      onUpdate({
        ...decision,
        guidedFlow: { ...flow, currentRound: 3 },
      });
    }
  }, [decision, flow, onUpdate]);

  const handleStartOver = useCallback(() => {
    onUpdate({
      ...decision,
      guidedFlow: {
        currentRound: 0,
        round1: { status: "pending", questions: [], answers: [] },
        round2: { status: "pending", tailoredOptions: [] },
        round3: { status: "pending" },
      },
    });
  }, [decision, onUpdate]);

  // loading state
  if (generating || synthesizing) {
    return (
      <div className="relative flex flex-col h-full overflow-hidden">
        <GradientDots dotSize={6} spacing={12} duration={40} colorCycleDuration={8} className="opacity-[0.07] pointer-events-none" />
        <div className="absolute -right-20 -bottom-20 pointer-events-none opacity-[0.03] z-[1]">
          <Abstract30Shapes className="w-[600px] h-[600px] text-foreground" />
        </div>
        <div className="relative z-10 flex flex-col h-full">
          {flow && (
            <RoundIndicator
              currentRound={currentRound}
              round1Status={flow.round1.status}
              round2Status={flow.round2.status}
              round3Status={flow.round3.status}
              onSelectRound={handleSelectRound}
              onSkipToDashboard={onExit}
            />
          )}
          <div className="flex flex-col items-center justify-center flex-1 gap-3">
            <WaveSpinner size="sm" color="primary" animation="ripple" />
            <span className="text-xs text-foreground/40">
              {synthesizing ? "Analyzing your preferences..." :
               currentRound === 0 ? "Generating preference questions..." :
               currentRound === 1 ? "Generating tailored options..." :
               "Generating execution plan..."}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // error state
  if (error) {
    return (
      <div className="relative flex flex-col h-full overflow-hidden">
        <GradientDots dotSize={6} spacing={12} duration={40} colorCycleDuration={8} className="opacity-[0.07] pointer-events-none" />
        <div className="absolute -right-20 -bottom-20 pointer-events-none opacity-[0.03] z-[1]">
          <Abstract30Shapes className="w-[600px] h-[600px] text-foreground" />
        </div>
        <div className="relative z-10 flex flex-col h-full">
          {flow && (
            <RoundIndicator
              currentRound={currentRound}
              round1Status={flow.round1.status}
              round2Status={flow.round2.status}
              round3Status={flow.round3.status}
              onSelectRound={handleSelectRound}
              onSkipToDashboard={onExit}
            />
          )}
          <div className="flex flex-col items-center justify-center flex-1 gap-3">
            <span className="text-xs text-rose-300">{error}</span>
            <button
              type="button"
              onClick={() => {
                setError(null);
                if (currentRound === 0) startRound1();
                else if (currentRound === 1 && flow?.round1.status !== "complete") startSynthesis();
                else if (currentRound === 1) startRound2();
                else startRound3();
              }}
              className="inline-flex items-center gap-1.5 h-7 rounded-md bg-card px-3 text-xs font-medium text-foreground hover:bg-accent"
            >
              <RefreshFilled className="h-3 w-3" />
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  // not started - show research summary + start CTA
  if (currentRound === 0 || !flow) {
    const hasResearch = !!decision.brief || decision.options.length > 0 || decision.context?.problem;
    const rec = decision.recommendation;
    const recOption = decision.options.find((o) => o.id === rec?.choiceId);

    return (
      <div className="relative flex flex-col h-full overflow-hidden">
        <GradientDots dotSize={6} spacing={12} duration={40} colorCycleDuration={8} className="opacity-[0.07] pointer-events-none" />
        <div className="absolute -right-20 -bottom-20 pointer-events-none opacity-[0.03] z-[1]">
          <Abstract45Shapes className="w-[600px] h-[600px] text-foreground" />
        </div>
        <div className="relative z-10 flex flex-col h-full px-6 py-6 overflow-y-auto">
          <div className="flex items-center gap-3 mb-5">
            <div className="flex items-center justify-center size-9 rounded-md bg-violet-500/10 shrink-0">
              <FlashCircleFilled className="h-5 w-5 text-violet-400" />
            </div>
            <div>
              <span className="text-2xl font-black leading-none tracking-tight">Guided Decision Flow</span>
              <p className="text-xs text-foreground/50 mt-1">
                3 steps: preferences, tailored options, execution plan
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 mb-5 shrink-0">
            <button
              type="button"
              onClick={startRound1}
              className="h-9 rounded-md bg-foreground px-5 text-sm font-bold text-background hover:bg-foreground/90"
            >
              Start guided flow
            </button>
            <button
              type="button"
              onClick={onExit}
              className="h-9 px-3 text-xs text-foreground/30 hover:text-foreground/50"
            >
              Skip to dashboard
            </button>
          </div>

          {/* research summary */}
          {hasResearch && (
            <div className="space-y-3 flex-1">
              <div className="rounded-md bg-card px-5 py-4">
                <div className="flex items-center gap-2 mb-2">
                  <SearchStatusFilled className="h-3.5 w-3.5 text-amber-400" />
                  <span className="text-[10px] text-foreground/30 font-bold uppercase tracking-wide">research found</span>
                </div>
                {decision.brief?.situation ? (
                  <p className="text-sm text-foreground/70 leading-snug">
                    {decision.brief.situation}
                  </p>
                ) : decision.context?.problem ? (
                  <p className="text-sm text-foreground/70 leading-snug">
                    {decision.context.problem}
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {decision.options.length > 0 && (
                    <span className="rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-foreground/60">
                      {decision.options.length} options
                    </span>
                  )}
                  {decision.context?.affectedAreas?.length ? (
                    <span className="rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-foreground/60">
                      {decision.context.affectedAreas.length} areas affected
                    </span>
                  ) : null}
                  {decision.context?.constraints?.length ? (
                    <span className="rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-foreground/60">
                      {decision.context.constraints.length} constraints
                    </span>
                  ) : null}
                </div>
              </div>

              {recOption && rec && (
                <div className="rounded-md bg-card px-5 py-4">
                  <span className="text-[10px] text-foreground/30 font-bold uppercase tracking-wide">initial recommendation</span>
                  <div className="mt-2 flex items-center gap-2.5">
                    <span className="inline-flex size-6 items-center justify-center rounded bg-foreground text-background text-[10px] font-bold shrink-0">
                      {recOption.letter}
                    </span>
                    <span className="text-sm font-bold">{recOption.name}</span>
                    <span className={`text-xs font-bold uppercase tracking-wide ${
                      rec.confidence === "high" ? "text-emerald-400" :
                      rec.confidence === "medium" ? "text-amber-400" : "text-rose-400"
                    }`}>
                      {rec.confidence}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-foreground/50 leading-snug line-clamp-3">
                    {rec.rationale}
                  </p>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <RoundIndicator
        currentRound={currentRound}
        round1Status={flow.round1.status}
        round2Status={flow.round2.status}
        round3Status={flow.round3.status}
        onSelectRound={handleSelectRound}
        onStartOver={handleStartOver}
        onSkipToDashboard={onExit}
      />

      <div className="flex-1 overflow-y-auto">
        {/* round 1: preference gathering */}
        {currentRound === 1 && flow.round1.status === "in_progress" && flow.round1.questions.length > 0 && (
          <Round1Cards
            questions={flow.round1.questions}
            answers={flow.round1.answers}
            onAnswer={handleAnswer}
            onComplete={startSynthesis}
          />
        )}

        {/* round 2: option selection */}
        {currentRound === 2 && flow.round2.status === "ready" && flow.round2.tailoredOptions.length > 0 && (
          <Round2Options
            options={flow.round2.tailoredOptions}
            recommendation={decision.recommendation}
            selectedId={selectedOptionId}
            onSelect={onSelectedOptionChange}
            onConfirm={startRound3}
          />
        )}

        {/* round 3: plan review */}
        {currentRound === 3 && flow.round3.status === "ready" && flow.round3.plan && (
          <Round3Plan
            plan={flow.round3.plan}
            onApprove={handleApprovePlan}
            onRedo={() => {
              onSelectedOptionChange(null);
              onUpdate({
                ...decision,
                guidedFlow: {
                  ...flow,
                  currentRound: 2,
                  round3: { status: "pending" },
                },
              });
            }}
            approving={approving}
          />
        )}
      </div>
    </div>
  );
}
