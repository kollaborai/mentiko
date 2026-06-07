"use client";

import { WifiFilled, ActivityFilled } from "@aliimam/icons";

interface LiveIndicatorProps {
  connected: boolean;
  size?: "sm" | "md";
  showText?: boolean;
}

export function LiveIndicator({
  connected,
  size = "sm",
  showText = true,
}: LiveIndicatorProps) {
  const sizeClass = size === "sm" ? "h-1.5 w-1.5" : "h-2 w-2";
  const textSize = size === "sm" ? "text-xs" : "text-sm";

  return (
    <div
      className={`flex items-center gap-1.5 ${
        connected ? "text-green-400" : "text-foreground/30"
      } ${textSize}`}
    >
      {connected ? (
        <>
          <WifiFilled className={size === "sm" ? "h-3 w-3" : "h-4 w-4"} />
          {showText && (
            <>
              <div className={`rounded-full ${sizeClass} bg-green-400 animate-pulse`} />
              <span>live</span>
            </>
          )}
        </>
      ) : (
        <>
          <ActivityFilled className={size === "sm" ? "h-3 w-3" : "h-4 w-4"} />
          {showText && (
            <span className="text-foreground/30">polling</span>
          )}
        </>
      )}
    </div>
  );
}
