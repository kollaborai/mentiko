"use client";

import { useState } from "react";
import {
  TickCircleFilled as CheckCircle2,
  ArrowDown2Filled as ChevronDown,
  ArrowUp2Filled as ChevronUp,
} from "@aliimam/icons";
import type { Option, Recommendation } from "@/lib/decision-types";
import { cn } from "@/lib/utils";
import { GradientDots } from "@/components/ui/gradient-dots";
import { Abstract80Shapes } from "@aliimam/vectors";
import { Markdown } from "@/components/ui/markdown";

interface OptionCardsProps {
  options: Option[];
  recommendation?: Recommendation;
  selectedId: string | null;
  onSelect?: (id: string) => void;
  readOnly?: boolean;
}

function effortColor(effort: string) {
  switch (effort) {
    case "low":
      return "text-emerald-300";
    case "medium":
      return "text-amber-300";
    case "high":
      return "text-rose-300";
    default:
      return "text-muted-foreground";
  }
}

function effortDotColor(effort: string) {
  switch (effort) {
    case "low":
      return "bg-emerald-400";
    case "medium":
      return "bg-amber-400";
    case "high":
      return "bg-rose-400";
    default:
      return "bg-foreground/20";
  }
}

function riskColor(risk: string) {
  switch (risk) {
    case "low":
      return "text-emerald-300";
    case "medium":
      return "text-amber-300";
    case "high":
      return "text-rose-300";
    default:
      return "text-muted-foreground";
  }
}

function riskDotColor(risk: string) {
  switch (risk) {
    case "low":
      return "bg-emerald-400";
    case "medium":
      return "bg-amber-400";
    case "high":
      return "bg-rose-400";
    default:
      return "bg-foreground/20";
  }
}

function containsPattern(items: string[], patterns: RegExp[]) {
  return patterns.some((pattern) => items.some((item) => pattern.test(item)));
}

function backwardCompatibility(option: Option) {
  const pros = option.pros.map((item) => item.toLowerCase());
  const cons = option.cons.map((item) => item.toLowerCase());

  if (
    containsPattern(cons, [
      /\bbreak/i,
      /\bmigration/i,
      /\brename/i,
      /\bapi\b/i,
      /\brollback/i,
      /\bmanual update/i,
    ])
  ) {
    return "breaking";
  }

  if (
    containsPattern(pros, [
      /\bcompatible/i,
      /\bdrop-?in/i,
      /\bno migration/i,
      /\bpreserve/i,
      /\bno api/i,
    ])
  ) {
    return "safe";
  }

  return "review";
}

function performanceImpact(option: Option) {
  const pros = option.pros.map((item) => item.toLowerCase());
  const cons = option.cons.map((item) => item.toLowerCase());

  if (
    containsPattern(pros, [
      /\bperformance/i,
      /\blatency/i,
      /\bfaster/i,
      /\bthroughput/i,
      /\befficient/i,
      /\bcache/i,
    ])
  ) {
    return "gain";
  }

  if (
    containsPattern(cons, [
      /\boverhead/i,
      /\bslower/i,
      /\bperformance/i,
      /\blatency/i,
      /\bextra hop/i,
      /\bregression/i,
    ])
  ) {
    return "cost";
  }

  return "neutral";
}

function compactSignalTone(value: string) {
  switch (value) {
    case "safe":
    case "gain":
    case "low":
      return "text-emerald-300";
    case "breaking":
    case "cost":
    case "high":
      return "text-rose-300";
    case "medium":
      return "text-amber-300";
    default:
      return "text-muted-foreground";
  }
}

function changeSizeLabel(effort: Option["effort"]) {
  switch (effort) {
    case "low":
      return "small";
    case "medium":
      return "medium";
    case "high":
      return "large";
    default:
      return effort;
  }
}

export function OptionCards({
  options,
  recommendation,
  selectedId,
  onSelect,
  readOnly = false,
}: OptionCardsProps) {
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  return (
    <div className="relative h-full overflow-hidden">
      <GradientDots dotSize={6} spacing={12} duration={40} colorCycleDuration={8} className="opacity-[0.07] pointer-events-none" />
      <div className="absolute -right-20 -bottom-20 pointer-events-none opacity-[0.03] z-[1]">
        <Abstract80Shapes className="w-[600px] h-[600px] text-foreground" />
      </div>
      <div className="relative z-10 h-full overflow-y-auto space-y-3">
      <div className="overflow-hidden rounded-md bg-muted">
        <div className="grid grid-cols-[minmax(0,1.3fr)_repeat(5,minmax(0,0.8fr))] gap-3 px-3 py-2 text-xs text-foreground/40 font-medium">
          <span>Option</span>
          <span>Change size</span>
          <span>Risk</span>
          <span>Compatibility</span>
          <span>Performance</span>
          <span>Recommended</span>
        </div>
        <div className="space-y-px px-1 pb-1">
          {options.map((option) => {
            const isRecommended = recommendation?.choiceId === option.id;
            const isSelected = selectedId === option.id;
            const compatibility = backwardCompatibility(option);
            const performance = performanceImpact(option);

            return (
              <button
                key={`compare-${option.id}`}
                type="button"
                onClick={() => onSelect?.(option.id)}
                disabled={readOnly}
                className={cn(
                  "grid w-full grid-cols-[minmax(0,1.3fr)_repeat(5,minmax(0,0.8fr))] gap-3 rounded px-3 py-2 text-left text-xs transition-colors",
                  isRecommended && "bg-foreground/5",
                  isSelected && "bg-accent",
                  !readOnly && "hover:bg-accent"
                )}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex size-5 items-center justify-center rounded bg-card text-[10px] font-semibold text-foreground">
                      {option.letter}
                    </span>
                    <span className="truncate font-medium">{option.name}</span>
                  </div>
                </div>
                <span className={effortColor(option.effort)}>{changeSizeLabel(option.effort)}</span>
                <span className={riskColor(option.risk)}>{option.risk}</span>
                <span className={compactSignalTone(compatibility)}>{compatibility}</span>
                <span className={compactSignalTone(performance)}>{performance}</span>
                <span className={cn(isRecommended ? "text-foreground/80" : "text-muted-foreground")}>
                  {isRecommended ? "yes" : "no"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        {options.map((option) => {
          const isRecommended = recommendation?.choiceId === option.id;
          const isSelected = selectedId === option.id;
          const compatibility = backwardCompatibility(option);
          const performance = performanceImpact(option);
          const expanded =
            expandedIds[option.id] ??
            (selectedId === option.id || recommendation?.choiceId === option.id);
          const rationale = isRecommended
            ? recommendation?.rationale
            : option.description;

          return (
            <div
              key={option.id}
              className={cn(
                "rounded-md p-3 transition-colors",
                isRecommended
                  ? "bg-muted border-l-2 border-emerald-500/30"
                  : "bg-card border-l-2 border-transparent",
                isSelected && "bg-accent",
                !isSelected && !isRecommended && "hover:bg-muted"
              )}
            >
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex size-7 items-center justify-center rounded text-xs font-bold",
                        isSelected
                          ? "bg-foreground text-background"
                          : isRecommended
                            ? "bg-foreground/10 text-foreground"
                            : "bg-muted text-foreground"
                      )}
                    >
                      {option.letter}
                    </span>
                    <span className="text-sm font-medium">{option.name}</span>
                    {isRecommended && (
                      <span className="rounded bg-foreground/10 px-1.5 py-0.5 text-[10px] font-medium text-foreground/70">
                        Recommended
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    <Markdown content={rationale || ""} compact />
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => onSelect?.(option.id)}
                      className={cn(
                        "inline-flex h-7 items-center gap-1 rounded-md px-3 text-xs font-medium transition-colors",
                        isSelected
                          ? "bg-foreground text-background"
                          : isRecommended
                            ? "bg-foreground/10 text-foreground hover:bg-foreground/15"
                            : "bg-muted text-foreground hover:bg-accent"
                      )}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {isSelected ? "Selected" : `Choose ${option.letter}`}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedIds((prev) => ({
                        ...prev,
                        [option.id]: !expanded,
                      }))
                    }
                    className="inline-flex h-7 items-center gap-1 rounded-md px-3 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    {expanded ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                    {expanded ? "Hide detail" : "Show detail"}
                  </button>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 text-[10px]">
                <span className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-muted-foreground">
                  change size: <span className={cn("inline-block w-1.5 h-1.5 rounded-full", effortDotColor(option.effort))} /><span className={effortColor(option.effort)}>{changeSizeLabel(option.effort)}</span>
                </span>
                <span className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-muted-foreground">
                  risk: <span className={cn("inline-block w-1.5 h-1.5 rounded-full", riskDotColor(option.risk))} /><span className={riskColor(option.risk)}>{option.risk}</span>
                </span>
                <span className="rounded bg-muted px-2 py-0.5 text-muted-foreground">
                  compatibility: <span className={compactSignalTone(compatibility)}>{compatibility}</span>
                </span>
                <span className="rounded bg-muted px-2 py-0.5 text-muted-foreground">
                  performance: <span className={compactSignalTone(performance)}>{performance}</span>
                </span>
              </div>

              {expanded && (
                <div className="mt-3 grid gap-3 border-t border-foreground/5 pt-3 md:grid-cols-2">
                  <div>
                    <div className="mb-2 text-xs text-foreground/40 font-medium">
                      Pros
                    </div>
                    <ul className="space-y-1">
                      {option.pros.map((pro, i) => (
                        <li key={i} className="text-sm text-foreground/75">
                          + {pro}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="mb-2 text-xs text-foreground/40 font-medium">
                      Cons
                    </div>
                    <ul className="space-y-1">
                      {option.cons.map((con, i) => (
                        <li key={i} className="text-sm text-foreground/75">
                          - {con}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}
