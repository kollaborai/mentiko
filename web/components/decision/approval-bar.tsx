"use client";

import { SendFilled } from "@aliimam/icons";
import type { Option } from "@/lib/decision-types";
import { RaisedButton } from "@/components/ui/raised-button";

interface ApprovalBarProps {
  selectedOption?: Option;
  onApprove: () => void;
  onSkip: () => void;
  resolving: boolean;
  disabled: boolean;
}

export function ApprovalBar({
  selectedOption,
  onApprove,
  onSkip,
  resolving,
  disabled,
}: ApprovalBarProps) {
  return (
    <div className="shrink-0 px-4 py-2 flex items-center justify-between gap-3 bg-card">
      <span className="text-xs text-foreground/50 truncate">
        {selectedOption
          ? `Option ${selectedOption.letter || "?"}: ${selectedOption.name}`
          : "Select an option"}
      </span>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onSkip}
          className="h-7 px-3 rounded-md text-xs font-medium text-foreground/30 hover:text-foreground/50 hover:bg-muted"
        >
          Skip
        </button>
        <RaisedButton
          onClick={onApprove}
          disabled={disabled || resolving}
          color="#00bbff"
          className="h-7 px-3 text-xs font-semibold disabled:opacity-40"
        >
          <SendFilled className="h-3 w-3" />
          {resolving
            ? "Approving..."
            : selectedOption
              ? `Approve ${selectedOption.letter || selectedOption.name}`
              : "Approve"}
        </RaisedButton>
      </div>
    </div>
  );
}
