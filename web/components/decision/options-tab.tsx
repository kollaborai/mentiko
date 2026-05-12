"use client";

import type { Decision } from "@/lib/decision-types";
import { OptionCards } from "./option-cards";

interface OptionsTabProps {
  decision: Decision;
  isPending: boolean;
  isResolved: boolean;
  selectedOptionId: string | null;
  setSelectedOptionId: (id: string | null) => void;
}

export function OptionsTab({
  decision,
  isPending,
  isResolved,
  selectedOptionId,
  setSelectedOptionId,
}: OptionsTabProps) {
  if (decision.options.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-xs text-foreground/30">
        No options generated yet
      </div>
    );
  }

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-foreground/40 font-medium">Options</span>
        {isPending && (
          <span className="text-[10px] text-foreground/30">
            Arrow keys to navigate, Enter to approve
          </span>
        )}
      </div>
      <div className="mt-2">
        <OptionCards
          options={decision.options}
          recommendation={decision.recommendation}
          selectedId={
            isResolved
              ? decision.resolution?.selectedOptionId ?? null
              : selectedOptionId
          }
          onSelect={isPending ? (id: string) => setSelectedOptionId(id) : undefined}
          readOnly={!isPending}
        />
      </div>
    </div>
  );
}
