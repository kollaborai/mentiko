"use client";

import type { JSX } from "react";
import { ShieldTickFilled, FlashFilled } from "@aliimam/icons";
import { cn } from "@/lib/utils";

export interface KollaborModeChoicePromptProps {
  result?: "permission" | "yolo";
  onChoose: (choice: "permission" | "yolo") => void;
}

const RESOLVED_LABEL: Record<"permission" | "yolo", string> = {
  permission: "asking before each tool",
  yolo: "YOLO — running without asking",
};

/**
 * First-run choice shown the first time someone talks to the agent: ask for
 * approval before each tool, or run freely (YOLO). The decision is remembered
 * and can be changed later via /yolo or Settings → Mentiko Agent.
 */
export function KollaborModeChoicePrompt({
  result,
  onChoose,
}: KollaborModeChoicePromptProps): JSX.Element {
  if (result) {
    return (
      <div className="max-w-[85%] self-start rounded-2xl bg-muted px-3.5 py-2 text-xs text-muted-foreground">
        {result === "yolo" ? (
          <FlashFilled className="mr-1.5 inline h-3.5 w-3.5 text-amber-300" />
        ) : (
          <ShieldTickFilled className="mr-1.5 inline h-3.5 w-3.5 text-foreground/70" />
        )}
        {RESOLVED_LABEL[result]}
      </div>
    );
  }

  return (
    <div className="max-w-[85%] self-start rounded-2xl bg-muted px-3.5 py-2.5 flex flex-col gap-2.5">
      <div className="text-sm text-foreground">
        How should I handle tools?
      </div>
      <div className="text-xs text-muted-foreground -mt-1.5">
        I can ask before each action, or just run them (YOLO).
      </div>
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => onChoose("permission")}
          className="flex items-center gap-2 rounded-lg bg-muted-foreground/15 px-3 py-2 text-left text-xs text-foreground hover:bg-muted-foreground/25 transition-colors"
        >
          <ShieldTickFilled className="h-4 w-4 shrink-0 text-foreground/70" />
          <span>
            <span className="font-medium">Ask me first</span>
            <span className="block text-[11px] text-muted-foreground">
              approve each tool before it runs
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => onChoose("yolo")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors",
            "bg-amber-400/15 text-amber-100 hover:bg-amber-400/25",
          )}
        >
          <FlashFilled className="h-4 w-4 shrink-0 text-amber-300" />
          <span>
            <span className="font-medium">YOLO mode</span>
            <span className="block text-[11px] text-amber-200/70">
              run tools automatically, no prompts
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}
