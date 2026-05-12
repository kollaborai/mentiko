"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { type FC, type ReactNode } from "react";
import { Tooltip, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { LayerFilled as Layers, ArrowRightFilled as ArrowRight } from "@aliimam/icons";

interface ChainData {
  id: string;
  name: string;
  description?: string;
  agentCount?: number;
  agents?: { id: string; name: string; emits?: string }[];
}

interface ChainPreviewTooltipProps {
  chain: ChainData;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}

export const ChainPreviewTooltip: FC<ChainPreviewTooltipProps> = ({
  chain,
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
          style={{ width: 280 }}
        >
          <div className="p-3 space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-md bg-purple-500/10 flex items-center justify-center">
                <Layers className="h-3.5 w-3.5 text-purple-400" />
              </div>
              <div>
                <div className="text-xs font-medium">{chain.name}</div>
                <div className="text-[10px] text-foreground/40">
                  {chain.agentCount || chain.agents?.length || 0} agents
                </div>
              </div>
            </div>

            {chain.description && (
              <p className="text-[11px] text-foreground/60 leading-relaxed line-clamp-2">
                {chain.description}
              </p>
            )}

            {chain.agents && chain.agents.length > 0 && (
              <div className="flex items-center gap-1 pt-1 flex-wrap">
                {chain.agents.slice(0, 5).map((agent, i) => (
                  <span key={agent.id} className="flex items-center gap-1">
                    <span className="text-[10px] text-foreground/70 bg-muted px-1.5 py-0.5 rounded">
                      {agent.name}
                    </span>
                    {i < Math.min(chain.agents!.length, 5) - 1 && (
                      <ArrowRight className="h-2.5 w-2.5 text-foreground/20" />
                    )}
                  </span>
                ))}
                {chain.agents.length > 5 && (
                  <span className="text-[10px] text-foreground/40">
                    +{chain.agents.length - 5} more
                  </span>
                )}
              </div>
            )}
          </div>

          <TooltipPrimitive.Arrow className="fill-card" width={11} height={5} />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </Tooltip>
  );
};
