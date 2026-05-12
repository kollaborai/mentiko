"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Warning2Filled as Bug, PlayFilled as Play, StopFilled as Square, ArrowDown2Filled as ChevronDown, ArrowRight2Filled as ChevronRight, TickCircleFilled as Check, RotateFilled as Loader2 } from "@aliimam/icons";

interface DebugStep {
  agent_id: string;
  agent_name?: string;
  status: "pending" | "running" | "complete" | "skipped" | "error";
  started?: string;
  completed?: string;
  error?: string;
}

interface DebugState {
  status: "running" | "paused" | "complete" | "aborted";
  current_step: number | null;
  steps: DebugStep[];
}

interface DebugPanelProps {
  debugMode: boolean;
  breakpoints: Set<string>;
  agents: Array<{ id: string; name: string }>;
  runId: string | null;
  runState: DebugState | null;
  onToggleMode: () => void;
  onToggleBreakpoint: (agentId: string) => void;
  onStartRun: () => void;
  onStopRun: () => void;
}

export function DebugPanel({
  debugMode,
  breakpoints,
  agents,
  runId,
  runState,
  onToggleMode,
  onToggleBreakpoint,
  onStartRun,
  onStopRun,
}: DebugPanelProps) {
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  if (!debugMode) {
    return (
      <div className="border-t border-foreground/10 p-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={onToggleMode}
          className="w-full justify-start h-7 text-xs bg-muted/5 text-foreground/60 hover:text-foreground"
        >
          <Bug className="mr-1.5 h-3 w-3" />
          debug mode
        </Button>
      </div>
    );
  }

  const steps = runState?.steps || [];
  const currentStepIndex = runState?.current_step ?? null;
  const isRunning = runId !== null && runState?.status === "running";

  return (
    <div className="bg-muted/20 border-t border-foreground/10">
      {/* debug header */}
      <div className="p-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Bug className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-xs font-medium">debug mode</span>
            <Badge
              variant="outline"
              className={`text-[9px] ${
                isRunning
                  ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                  : "bg-foreground/10 text-foreground/40"
              }`}
            >
              {isRunning ? "running" : "idle"}
            </Badge>
            {currentStepIndex !== null && (
              <span className="text-[10px] text-foreground/40">
                {currentStepIndex + 1}/{steps.length}
              </span>
            )}
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={onToggleMode}
            className="h-6 px-2 text-[10px] text-foreground/40 hover:text-foreground"
          >
            exit
          </Button>
        </div>

        {/* control buttons */}
        <div className="flex items-center gap-1.5">
          {!isRunning ? (
            <Button
              size="sm"
              onClick={onStartRun}
              className="h-7 px-2 text-xs bg-green-500/10 text-green-400 hover:bg-green-500/20"
            >
              <Play className="mr-1 h-3 w-3" />
              start debug run
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                onClick={onStopRun}
                className="h-7 px-2 text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20"
              >
                <Square className="mr-1 h-3 w-3" />
                stop
              </Button>
            </>
          )}
        </div>
      </div>

      {/* breakpoints section */}
      <div className="px-3 pb-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] text-foreground/40 uppercase tracking-wide">
            breakpoints
          </span>
          <span className="text-[9px] text-foreground/30">
            {breakpoints.size} set
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          {agents.map((agent) => {
            const hasBreakpoint = breakpoints.has(agent.id);
            return (
              <button
                key={agent.id}
                onClick={() => onToggleBreakpoint(agent.id)}
                className={`flex items-center gap-1 px-2 py-1 rounded text-[9px] transition-colors ${
                  hasBreakpoint
                    ? "bg-red-500/20 text-red-400"
                    : "bg-muted/5 text-foreground/40 hover:bg-muted/10"
                }`}
              >
                {hasBreakpoint ? <Bug className="h-2.5 w-2.5" /> : <div className="w-2.5 h-2.5" />}
                <span className="truncate max-w-[80px]">{agent.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* execution timeline */}
      {isRunning && steps.length > 0 && (
        <div className="px-3 pb-3 max-h-48 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-foreground/40 uppercase tracking-wide">
              execution
            </span>
          </div>
          <div className="space-y-1">
            {steps.map((step, idx) => {
              const isCurrent = idx === currentStepIndex;
              const hasBreakpoint = breakpoints.has(step.agent_id);
              const agent = agents.find((a) => a.id === step.agent_id);
              const expanded = expandedStep === idx;

              return (
                <div key={idx}>
                  <button
                    onClick={() => setExpandedStep(expanded ? null : idx)}
                    className={`w-full flex items-center gap-2 p-2 rounded text-left transition-colors ${
                      isCurrent
                        ? "bg-blue-500/10 border border-blue-500/20"
                        : "bg-muted/5 hover:bg-muted/10"
                    }`}
                  >
                    <div className="shrink-0">
                      {expanded ? (
                        <ChevronDown className="h-3 w-3 text-foreground/40" />
                      ) : (
                        <ChevronRight className="h-3 w-3 text-foreground/40" />
                      )}
                    </div>
                    {hasBreakpoint && (
                      <Bug className="h-2.5 w-2.5 text-red-400 shrink-0" />
                    )}
                    <span className="text-[9px] text-foreground/30 font-mono w-4">
                      {idx + 1}
                    </span>
                    {step.status === "complete" ? (
                      <Check className="h-3 w-3 text-green-400 shrink-0" />
                    ) : step.status === "running" ? (
                      <Loader2 className="h-3 w-3 text-blue-400 shrink-0 animate-spin" />
                    ) : step.status === "error" ? (
                      <span className="text-red-400 text-[8px]">!</span>
                    ) : null}
                    <span className="text-[10px] truncate flex-1">
                      {agent?.name || step.agent_id}
                    </span>
                    <Badge
                      variant="outline"
                      className={`text-[8px] ${
                        step.status === "running"
                          ? "bg-blue-500/10 text-blue-400"
                          : step.status === "complete"
                          ? "bg-green-500/10 text-green-400"
                          : step.status === "error"
                          ? "bg-red-500/10 text-red-400"
                          : "bg-muted/5 text-foreground/30"
                      }`}
                    >
                      {step.status}
                    </Badge>
                  </button>

                  {expanded && (
                    <div className="ml-6 mt-1 p-2 bg-muted/30 text-[9px] space-y-1">
                      {step.error && (
                        <div className="text-red-400 bg-red-500/10 p-1.5">
                          {step.error}
                        </div>
                      )}
                      {step.started && (
                        <div className="text-foreground/40">
                          started: {new Date(step.started).toLocaleTimeString()}
                        </div>
                      )}
                      {step.completed && (
                        <div className="text-foreground/40">
                          completed: {new Date(step.completed).toLocaleTimeString()}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
