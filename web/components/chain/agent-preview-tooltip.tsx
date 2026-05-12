"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { type FC, type ReactNode } from "react";
import { Tooltip, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { BotMessageSquare as Bot } from "@aliimam/icons";

interface AgentData {
  id: string;
  name: string;
  role?: string;
  triggers?: string[];
  emits?: string;
}

interface AgentPreviewTooltipProps {
  agent: AgentData;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}

export const AgentPreviewTooltip: FC<AgentPreviewTooltipProps> = ({
  agent,
  children,
  side = "right",
  className,
}) => {
  return (
    <Tooltip delayDuration={100}>
      <TooltipTrigger asChild>
        <span className={cn("inline-block", className)}>{children}</span>
      </TooltipTrigger>

      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={8}
          className={cn(
            "z-50 overflow-hidden rounded-xl",
            "bg-card text-foreground",
            "animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
            "data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2"
          )}
          style={{ width: 260 }}
        >
          <div className="p-3 space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-md bg-blue-500/10 flex items-center justify-center">
                <Bot className="h-3.5 w-3.5 text-blue-400" />
              </div>
              <div>
                <div className="text-xs font-medium">{agent.name}</div>
                <div className="text-[10px] text-foreground/40 font-mono">
                  {agent.id}
                </div>
              </div>
            </div>

            {agent.role && (
              <p className="text-[11px] text-foreground/60 leading-relaxed">
                {agent.role}
              </p>
            )}

            <div className="flex flex-wrap gap-1 pt-1">
              {agent.triggers?.map((t) => (
                <span
                  key={t}
                  className="text-[9px] bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded"
                >
                  {t === "manual-start" ? "start" : t}
                </span>
              ))}
              {agent.emits && (
                <>
                  <span className="text-[9px] text-foreground/20">→</span>
                  <span className="text-[9px] bg-green-500/10 text-green-400 px-1.5 py-0.5 rounded">
                    {agent.emits}
                  </span>
                </>
              )}
            </div>
          </div>

          <TooltipPrimitive.Arrow className="fill-card" width={11} height={5} />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </Tooltip>
  );
};
