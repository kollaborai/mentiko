"use client";

import { cn } from "@/lib/utils";
import type { Decision, Option } from "@/lib/decisions/decision-types";
import { Textarea } from "@/components/ui/textarea";
import { GradientDots } from "@/components/ui/gradient-dots";
import { SearchStatusFilled } from "@aliimam/icons";
import { Abstract15Shapes } from "@aliimam/vectors";
import { Markdown } from "@/components/ui/markdown";
import {
  CollapsibleSection,
  SummaryTextRow,
  SummaryListRow,
  confidenceTone,
  extractNonFileReferences,
} from "./decision-shared";

interface OverviewTabProps {
  decision: Decision;
  recommendedOption?: Option;
  selectedOption?: Option;
  showSteering: boolean;
  setShowSteering: (v: boolean | ((v: boolean) => boolean)) => void;
  steeringPrompt: string;
  setSteeringPrompt: (v: string) => void;
  triggerResearch: (steering?: string) => void;
  researching: boolean;
  isPending: boolean;
  notes: string;
  setNotes: (v: string) => void;
}

export function OverviewTab({
  decision,
  recommendedOption,
  selectedOption,
  showSteering,
  setShowSteering,
  steeringPrompt,
  setSteeringPrompt,
  triggerResearch,
  researching,
  isPending,
  notes,
  setNotes,
}: OverviewTabProps) {
  const referenceLinks = extractNonFileReferences(decision.context?.references ?? []);

  return (
    <div className="relative h-full overflow-hidden">
      <GradientDots dotSize={6} spacing={12} duration={40} colorCycleDuration={8} className="opacity-[0.07] pointer-events-none" />
      <div className="absolute -right-20 -bottom-20 pointer-events-none opacity-[0.03] z-[1]">
        <Abstract15Shapes className="w-[600px] h-[600px] text-foreground" />
      </div>
      <div className="relative z-10 h-full overflow-y-auto">
      {showSteering && (
        <div className="px-4 py-3">
          <span className="text-xs text-foreground/40 font-black">Refine the analysis</span>
          <p className="mt-1.5 text-sm text-foreground/70">
            Explain what the research should reconsider before generating a new recommendation.
          </p>
          <Textarea
            value={steeringPrompt}
            onChange={(event) => setSteeringPrompt(event.target.value)}
            placeholder="Focus on migration risk, implementation constraints, operational safety, or whatever was under-weighted."
            rows={4}
            className="mt-2 text-sm"
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && steeringPrompt.trim()) {
                event.preventDefault();
                triggerResearch(steeringPrompt.trim());
              }
              if (event.key === "Escape") setShowSteering(false);
            }}
          />
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => setShowSteering(false)}
              className="h-7 rounded-md bg-muted px-3 text-xs font-medium text-foreground/40 hover:bg-accent hover:text-foreground/60"
            >
              Cancel
            </button>
            <button
              onClick={() => triggerResearch(steeringPrompt.trim())}
              disabled={!steeringPrompt.trim() || researching}
              className="h-7 rounded-md bg-foreground px-3 text-xs font-medium text-background hover:bg-foreground/90 disabled:opacity-40"
            >
              {researching ? "Researching..." : "Re-run research"}
            </button>
          </div>
        </div>
      )}

      {(decision.status === "researching" || researching) && (
        <div className="px-4 py-5">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center size-8 rounded-md bg-amber-500/10 shrink-0">
              <SearchStatusFilled className="h-4 w-4 text-amber-400 animate-pulse" />
            </div>
            <div>
              <span className="text-sm font-bold text-foreground/80">Researching</span>
              <p className="mt-0.5 text-xs text-foreground/50">
                Gathering context, comparing options, and preparing a recommendation.
              </p>
            </div>
          </div>
        </div>
      )}

      {decision.brief && (
        <div className="px-4 pt-3 pb-1">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
            Research complete
          </span>
        </div>
      )}

      {decision.recommendation?.rationale && (
        <div className="px-4 py-3">
          <span className="text-xs text-foreground/40 font-black">Recommendation</span>
          <div className="mt-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">
                {recommendedOption
                  ? `Option ${recommendedOption.letter}: ${recommendedOption.name}`
                  : "Recommendation pending"}
              </span>
              {decision.recommendation?.confidence && (
                <span className={cn("text-[10px] font-medium", confidenceTone(decision.recommendation.confidence))}>
                  {decision.recommendation.confidence} confidence
                </span>
              )}
            </div>
            <div className="mt-1.5 text-sm text-foreground/70 leading-relaxed">
              <Markdown content={decision.recommendation.rationale} compact />
            </div>
          </div>
        </div>
      )}

      {decision.recommendation?.rationale && (decision.context?.problem || decision.prompt) && (
        <div className="h-px bg-foreground/5 mx-4" />
      )}

      {(decision.context?.problem || decision.prompt) && (
        <CollapsibleSection title="Executive summary">
          <div>
            <SummaryTextRow label="Problem" value={decision.context?.problem || decision.prompt} />
            <SummaryTextRow label="Root cause" value={decision.context?.currentState} />
            <SummaryTextRow label="Impact" value={decision.context?.whyProblem} />
            <SummaryListRow label="Constraints" items={decision.context?.constraints} />
            <SummaryListRow label="References" items={referenceLinks} />
          </div>
        </CollapsibleSection>
      )}

      {(decision.context?.problem || decision.prompt) && (decision.context?.problem || recommendedOption || selectedOption) && (
        <div className="h-px bg-foreground/5 mx-4" />
      )}

      {(decision.context?.problem || recommendedOption || selectedOption) && (
        <CollapsibleSection title="Before / After" defaultOpen={false}>
          <div className="space-y-3">
            <div>
              <div className="text-xs text-foreground/40 font-medium">Before</div>
              <div className="mt-1 text-sm text-foreground/70">
                <Markdown content={decision.context?.problem || decision.prompt || ""} compact />
              </div>
            </div>
            <div>
              <div className="text-xs text-foreground/40 font-medium">After</div>
              <div className="mt-1 text-sm text-foreground/70">
                <Markdown content={recommendedOption?.description || selectedOption?.description || "Choose an option to define the new path forward."} compact />
              </div>
            </div>
            <div>
              <div className="text-xs text-foreground/40 font-medium">Net effect</div>
              <div className="mt-1 text-sm text-foreground/70">
                <Markdown content={decision.context?.whyProblem || decision.recommendation?.rationale || "Clarify the expected impact once the decision is approved."} compact />
              </div>
            </div>
          </div>
        </CollapsibleSection>
      )}

      {isPending && (decision.context?.problem || recommendedOption || selectedOption) && (
        <div className="h-px bg-foreground/5 mx-4" />
      )}

      {isPending && (
        <div className="px-4 py-3">
          <span className="text-xs text-foreground/40 font-black">Approval notes</span>
          <p className="mt-1.5 text-sm text-foreground/70">
            Optional context that should travel with the implementation task.
          </p>
          <Textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Capture rollout notes, concerns to watch, or implementation guardrails."
            rows={3}
            className="mt-2 text-sm"
          />
        </div>
      )}
      </div>
    </div>
  );
}
