"use client";

import { cn } from "@/lib/utils";

interface TradeoffCardProps {
  side: "a" | "b";
  label: string;
  value: string;
  summary?: string;
  pros?: string[];
  cons?: string[];
  selected?: boolean;
  onSelect: () => void;
  disabled?: boolean;
  recommended?: boolean;
  recommendationRationale?: string;
}

export function TradeoffCard({
  side,
  label,
  value,
  summary,
  pros,
  cons,
  selected,
  onSelect,
  disabled,
  recommended,
  recommendationRationale,
}: TradeoffCardProps) {
  const displaySummary = summary || value.replace(/[_-]+/g, " ");
  const visiblePros = (pros ?? []).filter(Boolean);
  const visibleCons = (cons ?? []).filter(Boolean);
  const hasDetails = visiblePros.length > 0 || visibleCons.length > 0 || !!recommendationRationale;

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        "flex flex-col rounded-md bg-card px-5 py-5 text-left transition-colors duration-200",
        hasDetails ? "min-h-[300px]" : "min-h-[160px]",
        "hover:bg-accent",
        selected && "bg-accent",
        recommended && !selected && "bg-muted",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      <span className="flex items-start justify-between gap-3">
        <span
          className={cn(
            "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
            selected
              ? "bg-foreground text-background"
              : "bg-foreground/5 text-foreground/40"
          )}
        >
          {side.toUpperCase()}
        </span>
        {recommended && (
          <span className="rounded bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
            Recommended
          </span>
        )}
      </span>

      <span className="mt-4 text-base font-bold leading-tight">{label}</span>
      <span className="mt-2 text-sm text-foreground/55 leading-relaxed">
        {displaySummary}
      </span>

      {recommended && recommendationRationale && (
        <span className="mt-3 rounded-md bg-emerald-400/10 px-3 py-2 text-xs leading-relaxed text-emerald-100/80">
          {recommendationRationale}
        </span>
      )}

      {(visiblePros.length > 0 || visibleCons.length > 0) && (
        <span className="mt-4 grid flex-1 gap-4 sm:grid-cols-2">
          {visiblePros.length > 0 && (
            <span>
              <span className="block text-xs font-medium text-foreground/40">Pros</span>
              <span className="mt-2 block space-y-1">
                {visiblePros.slice(0, 3).map((pro, i) => (
                  <span key={i} className="block text-xs leading-relaxed text-foreground/65">
                    + {pro}
                  </span>
                ))}
              </span>
            </span>
          )}
          {visibleCons.length > 0 && (
            <span>
              <span className="block text-xs font-medium text-foreground/40">Cons</span>
              <span className="mt-2 block space-y-1">
                {visibleCons.slice(0, 3).map((con, i) => (
                  <span key={i} className="block text-xs leading-relaxed text-foreground/65">
                    - {con}
                  </span>
                ))}
              </span>
            </span>
          )}
        </span>
      )}
    </button>
  );
}
