"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ClockFilled } from "@aliimam/icons";

interface SnoozeButtonProps {
  onSnooze: (duration: string) => void;
  disabled?: boolean;
}

const SNOOZE_PRESETS = [
  { label: "15m", duration: "15min" },
  { label: "1h", duration: "1h" },
  { label: "4h", duration: "4h" },
  { label: "1d", duration: "1d" },
  { label: "1w", duration: "1w" },
];

export function SnoozeButton({ onSnooze, disabled }: SnoozeButtonProps) {
  const [showPresets, setShowPresets] = useState(false);

  if (showPresets) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-foreground/40">Snooze for:</span>
        {SNOOZE_PRESETS.map((preset) => (
          <Button
            key={preset.duration}
            size="sm"
            variant="ghost"
            className="h-6 text-xs text-amber-400/70 hover:text-amber-400 hover:bg-amber-400/10 px-2"
            onClick={() => {
              onSnooze(preset.duration);
              setShowPresets(false);
            }}
            disabled={disabled}
          >
            {preset.label}
          </Button>
        ))}
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-xs px-2"
          onClick={() => setShowPresets(false)}
        >
          cancel
        </Button>
      </div>
    );
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-6 text-xs text-foreground/30 hover:text-amber-400 transition-colors"
      onClick={() => setShowPresets(true)}
      disabled={disabled}
    >
      <ClockFilled className="h-3 w-3 mr-1" />
      Snooze
    </Button>
  );
}
