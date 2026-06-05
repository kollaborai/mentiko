"use client";

import { cn } from "@/lib/utils";
import type { Decision } from "@/lib/decisions/decision-types";
import { GradientDots } from "@/components/ui/gradient-dots";
import { confidenceTone, inferBlastRadius } from "./decision-shared";

interface VerdictCardProps {
  decision: Decision;
  mode?: "pending" | "approved";
}

export function VerdictCard({ decision, mode }: VerdictCardProps) {
  const isApproved = mode === "approved" || decision.status === "approved" || decision.status === "done";

  const displayOption = isApproved
    ? decision.options.find((o) => o.id === decision.resolution?.selectedOptionId)
    : decision.options.find((o) => o.id === decision.recommendation?.choiceId);

  const blastRadius = inferBlastRadius(decision);

  if (!displayOption && decision.options.length === 0) return null;

  return (
    <div className="mx-4 mb-2 rounded-md bg-muted px-4 py-3 relative overflow-hidden">
      <GradientDots dotSize={6} spacing={12} duration={40} colorCycleDuration={8} className="opacity-[0.07] pointer-events-none" />
      <div className="relative z-10">
      <div className="flex items-center gap-2">
        {displayOption && (
          <>
            <span className="inline-flex size-5 items-center justify-center rounded bg-card text-[10px] font-bold text-foreground/60">
              {displayOption.letter}
            </span>
            <span className="text-sm font-bold truncate">{displayOption.name}</span>
          </>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {decision.recommendation?.confidence && (
          <span className={cn(
            "inline-flex items-center gap-1.5 rounded bg-card px-2 py-0.5 text-[10px] font-bold",
            confidenceTone(decision.recommendation.confidence)
          )}>
            {decision.recommendation.confidence} confidence
            <span className="inline-flex items-center gap-0.5">
              <span className={cn("inline-block w-1.5 h-1.5 rounded-full", decision.recommendation.confidence === "low" ? "bg-rose-400" : decision.recommendation.confidence === "medium" ? "bg-amber-400" : "bg-emerald-400")} />
              <span className={cn("inline-block w-1.5 h-1.5 rounded-full", decision.recommendation.confidence === "low" ? "bg-foreground/10" : decision.recommendation.confidence === "medium" ? "bg-amber-400" : "bg-emerald-400")} />
              <span className={cn("inline-block w-1.5 h-1.5 rounded-full", decision.recommendation.confidence === "high" ? "bg-emerald-400" : "bg-foreground/10")} />
            </span>
          </span>
        )}
        <span className={cn(
          "rounded bg-card px-2 py-0.5 text-[10px] font-bold",
          blastRadius === "high" ? "text-rose-300" :
          blastRadius === "medium" ? "text-amber-300" : "text-foreground/40"
        )}>
          {blastRadius} blast radius
        </span>
        <span className="rounded bg-card px-2 py-0.5 text-[10px] font-bold text-foreground/40">
          {decision.options.length} options
        </span>
      </div>

      {decision.recommendation?.rationale && !isApproved && (
        <p className="mt-2 text-xs text-foreground/50 line-clamp-2">
          {decision.recommendation.rationale}
        </p>
      )}

      {isApproved && decision.resolution && (
        <p className="mt-2 text-[10px] text-foreground/30">
          approved by {decision.resolution.selectedBy} on {new Date(decision.resolution.selectedAt).toLocaleDateString()}
        </p>
      )}
      </div>
    </div>
  );
}
