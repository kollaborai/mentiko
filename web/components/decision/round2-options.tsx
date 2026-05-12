"use client";

import { useState, useEffect } from "react";
import { TickCircleFilled } from "@aliimam/icons";
import { Abstract75Shapes } from "@aliimam/vectors";
import { GradientDots } from "@/components/ui/gradient-dots";
import type { TailoredOption, Recommendation } from "@/lib/decision-types";
import { TailoredOptionCard } from "@/components/guided-flow/tailored-option-card";

interface Round2OptionsProps {
  options: TailoredOption[];
  recommendation?: Recommendation;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onConfirm: () => void;
}

export function Round2Options({
  options,
  recommendation,
  selectedId,
  onSelect,
  onConfirm,
}: Round2OptionsProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;

      // number keys 1-9 to select options
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= options.length) {
        e.preventDefault();
        onSelect(options[num - 1].id);
        return;
      }

      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        const idx = selectedId ? options.findIndex((o) => o.id === selectedId) : -1;
        const next = options[(idx + 1) % options.length];
        if (next) onSelect(next.id);
      }

      if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        const idx = selectedId ? options.findIndex((o) => o.id === selectedId) : 0;
        const prev = options[(idx - 1 + options.length) % options.length];
        if (prev) onSelect(prev.id);
      }

      if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && selectedId) {
        e.preventDefault();
        onConfirm();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [options, selectedId, onSelect, onConfirm]);

  return (
    <div className="relative h-full overflow-hidden">
      <GradientDots dotSize={6} spacing={12} duration={40} colorCycleDuration={8} className="opacity-[0.07] pointer-events-none" />
      <div className="absolute -right-20 -bottom-20 pointer-events-none opacity-[0.03] z-[1]">
        <Abstract75Shapes className="w-[600px] h-[600px] text-foreground" />
      </div>
      <div className="relative z-10 h-full overflow-y-auto px-4 py-3 space-y-3">
        <div className="text-center mb-4">
          <span className="text-xs text-foreground/30">
            Round 2 - Choose your approach
          </span>
          <p className="mt-1 text-sm text-foreground/60 leading-snug">
            Options tailored to your preferences. Pick one or explore details.
          </p>
        </div>

        <div className="space-y-2">
          {options.map((option) => (
            <TailoredOptionCard
              key={option.id}
              option={option}
              selected={selectedId === option.id}
              expanded={expandedId === option.id}
              onSelect={() => onSelect(option.id)}
              onToggleExpand={() =>
                setExpandedId(expandedId === option.id ? null : option.id)
              }
              isRecommended={recommendation?.choiceId === option.id}
            />
          ))}
        </div>

        {selectedId && (
          <div className="flex justify-center pt-2">
            <button
              type="button"
              onClick={onConfirm}
              className="inline-flex items-center gap-1.5 h-8 rounded-md bg-foreground px-4 text-xs font-medium text-background hover:bg-foreground/90"
            >
              <TickCircleFilled className="h-3 w-3" />
              Continue with {options.find((o) => o.id === selectedId)?.letter}
            </button>
          </div>
        )}

        <div className="text-center pt-2 text-[10px] text-foreground/20">
          1-{options.length}: select, arrows: cycle, enter: confirm
        </div>
      </div>
    </div>
  );
}
