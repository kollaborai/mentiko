"use client";

import { TickCircleFilled } from "@aliimam/icons";
import { cn } from "@/lib/utils";

interface RoundIndicatorProps {
  currentRound: 0 | 1 | 2 | 3;
  round1Status: string;
  round2Status: string;
  round3Status: string;
  onSelectRound: (round: 1 | 2 | 3) => void;
  onStartOver?: () => void;
  onSkipToDashboard?: () => void;
}

type StepState = "locked" | "active" | "complete";

function deriveStepState(
  roundNumber: 1 | 2 | 3,
  status: string,
  currentRound: 0 | 1 | 2 | 3
): StepState {
  if (status === "complete" || status === "skipped") return "complete";
  if (roundNumber === currentRound) return "active";
  if (status === "in_progress" || status === "ready" || status === "generating" || status === "synthesizing")
    return "active";
  return "locked";
}

function RoundStep({
  number,
  label,
  state,
  onClick,
}: {
  number: 1 | 2 | 3;
  label: string;
  state: StepState;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={state === "locked"}
      className={cn(
        "flex items-center gap-1.5",
        state === "locked" && "cursor-default opacity-30",
        state === "active" && "text-foreground",
        state === "complete" && "cursor-pointer text-foreground/60"
      )}
    >
      <span
        className={cn(
          "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold",
          state === "active" && "bg-foreground text-background",
          state === "complete" && "bg-emerald-500/15 text-emerald-400",
          state === "locked" && "bg-foreground/5 text-foreground/30"
        )}
      >
        {state === "complete" ? (
          <TickCircleFilled className="h-3 w-3" />
        ) : (
          number
        )}
      </span>
      <span className="hidden text-xs font-medium min-[400px]:inline">
        {label}
      </span>
    </button>
  );
}

export function RoundIndicator({
  currentRound,
  round1Status,
  round2Status,
  round3Status,
  onSelectRound,
  onStartOver,
  onSkipToDashboard,
}: RoundIndicatorProps) {
  const step1 = deriveStepState(1, round1Status, currentRound);
  const step2 = deriveStepState(2, round2Status, currentRound);
  const step3 = deriveStepState(3, round3Status, currentRound);

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <RoundStep
        number={1}
        label="preferences"
        state={step1}
        onClick={() => onSelectRound(1)}
      />

      <div
        className={cn(
          "h-px flex-1",
          step1 === "complete" ? "bg-emerald-400" : "bg-foreground/10"
        )}
      />

      <RoundStep
        number={2}
        label="options"
        state={step2}
        onClick={() => onSelectRound(2)}
      />

      <div
        className={cn(
          "h-px flex-1",
          step2 === "complete" ? "bg-emerald-400" : "bg-foreground/10"
        )}
      />

      <RoundStep
        number={3}
        label="plan"
        state={step3}
        onClick={() => onSelectRound(3)}
      />

      <div className="ml-auto flex items-center gap-1">
        {onStartOver && (
          <button
            onClick={onStartOver}
            className="h-7 px-2 text-xs text-foreground/30 hover:text-foreground/60"
          >
            start over
          </button>
        )}
        {onSkipToDashboard && (
          <button
            onClick={onSkipToDashboard}
            className="h-7 px-2 text-xs text-foreground/30 hover:text-foreground/60"
          >
            dashboard
          </button>
        )}
      </div>
    </div>
  );
}
