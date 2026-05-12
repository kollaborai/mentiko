"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";
import type { TailoredOption } from "@/lib/decision-types";

interface TailoredOptionCardProps {
  option: TailoredOption;
  selected: boolean;
  expanded: boolean;
  onSelect: () => void;
  onToggleExpand: () => void;
  readOnly?: boolean;
  isRecommended?: boolean;
}

function effortColor(level: "low" | "medium" | "high") {
  if (level === "low") return "text-emerald-400";
  if (level === "medium") return "text-amber-400";
  return "text-red-400";
}

function riskColor(level: "low" | "medium" | "high") {
  if (level === "low") return "text-emerald-400";
  if (level === "medium") return "text-amber-400";
  return "text-red-400";
}

export function MatchScoreBadge({ score }: { score: number }) {
  const tone =
    score >= 90
      ? "text-emerald-400"
      : score >= 70
        ? "text-amber-400"
        : "text-foreground/40";

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <div className="w-12 h-1 rounded-full bg-foreground/10 overflow-hidden">
        <div
          className={cn("h-full rounded-full", tone.replace("text-", "bg-"))}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className={cn("text-[10px] font-medium", tone)}>{score}%</span>
    </div>
  );
}

export function TailoredOptionCard({
  option,
  selected,
  expanded,
  onSelect,
  onToggleExpand,
  readOnly,
  isRecommended,
}: TailoredOptionCardProps) {
  return (
    <div
      className={cn(
        "rounded-md p-3 transition-colors",
        selected ? "bg-accent" : "bg-card",
        !selected && "hover:bg-muted",
        isRecommended && "border-l-2 border-emerald-400/50"
      )}
    >
      {/* row 1: letter + name + match score */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={cn(
              "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[10px] font-bold",
              selected
                ? "bg-foreground text-background"
                : "bg-muted text-foreground"
            )}
          >
            {option.letter}
          </span>
          <span className="text-sm font-medium truncate">{option.name}</span>
        </div>
        <MatchScoreBadge score={option.matchScore} />
      </div>

      {/* row 2: 1-line description */}
      <p className="mt-1 text-xs text-foreground/50 line-clamp-1 pl-8">
        {option.description}
      </p>

      {/* row 3: signal pills + actions */}
      <div className="mt-2 flex items-center justify-between pl-8">
        <div className="flex flex-wrap gap-1.5 text-[10px]">
          <span className="rounded bg-muted px-2 py-0.5 text-muted-foreground">
            effort:{" "}
            <span className={effortColor(option.effort)}>{option.effort}</span>
          </span>
          <span className="rounded bg-muted px-2 py-0.5 text-muted-foreground">
            risk:{" "}
            <span className={riskColor(option.risk)}>{option.risk}</span>
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {!readOnly && (
            <button
              onClick={onSelect}
              className={cn(
                "h-7 px-3 rounded-md text-xs font-medium",
                selected
                  ? "bg-foreground text-background"
                  : "bg-muted text-foreground hover:bg-accent"
              )}
            >
              {selected ? "selected" : "select"}
            </button>
          )}
          <button
            onClick={onToggleExpand}
            className="h-7 px-2 text-xs text-foreground/30 hover:text-foreground/60"
          >
            {expanded ? "less" : "more"}
          </button>
        </div>
      </div>

      {/* expanded: pros/cons */}
      {expanded && (
        <div
          className="mt-3 grid gap-3 pt-3 md:grid-cols-2 pl-8"
          style={{ borderTop: "1px solid hsl(var(--foreground) / 0.05)" }}
        >
          <div>
            <div className="mb-1.5 text-xs text-foreground/40 font-medium">
              pros
            </div>
            <ul className="space-y-1">
              {option.pros.map((pro, i) => (
                <li key={i} className="text-xs text-foreground/60">
                  + {pro}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="mb-1.5 text-xs text-foreground/40 font-medium">
              cons
            </div>
            <ul className="space-y-1">
              {option.cons.map((con, i) => (
                <li key={i} className="text-xs text-foreground/60">
                  - {con}
                </li>
              ))}
            </ul>
          </div>

          {/* optional preview */}
          {option.preview && (
            <div className="col-span-2 mt-2">
              {option.preview.type === "image" && (
                <Image
                  src={option.preview.content}
                  alt={option.name}
                  width={200}
                  height={200}
                  className="rounded-md max-h-48 object-contain"
                />
              )}
              {option.preview.type === "code" && (
                <pre className="rounded-md bg-muted p-2 text-xs font-mono text-foreground/70 overflow-x-auto">
                  {option.preview.content}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
