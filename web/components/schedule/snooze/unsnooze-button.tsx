"use client";

import { Button } from "@/components/ui/button";
import { CheckFilled } from "@aliimam/icons";

interface UnSnoozeButtonProps {
  onUnsnooze: () => void;
  disabled?: boolean;
}

export function UnSnoozeButton({ onUnsnooze, disabled }: UnSnoozeButtonProps) {
  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-6 text-xs text-amber-400 hover:text-amber-300"
      onClick={onUnsnooze}
      disabled={disabled}
    >
      <CheckFilled className="h-3 w-3 mr-1" />
      Unsnooze
    </Button>
  );
}
