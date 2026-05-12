"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ForwardFilled,
  ForwardFilled as SkipForwardFilled,
  RotateLeftFilled,
  StopFilled,
  Warning2Filled,
  PlayFilled,
  PauseFilled,
  EyeFilled,
  ArrowDown2Filled,
  ArrowRight2Filled,
  BotMessageSquare,
  DocumentTextFilled,
  MessageFilled,
  FlashFilled,
} from "@aliimam/icons";

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
  last_action?: string;
  last_action_at?: string;
}

interface AgentInspectData {
  agentId: string;
  prompt?: string;
  messages?: Array<{ role: string; content: string }>;
  context?: Record<string, unknown>;
  state?: Record<string, unknown>;
  stateRaw?: string;
  statePath?: string;
}

interface DebugPanelProps {
  debugMode: boolean;
  debugState: DebugState | null;
  debugPaused: boolean;
  debugBreakpoints: Set<string>;
  agents: Array<{ id: string; name: string; role: string }>;
  onToggleMode: () => void;
  onAction: (action: string, stepIndex?: number) => void;
  onToggleBreakpoint: (agentId: string) => void;
  onInspect: (agentId: string) => void;
  inspectData: AgentInspectData | null;
  onCloseInspect: () => void;
}

export function DebugPanel({
  debugMode,
  debugState,
  debugPaused,
  debugBreakpoints,
  agents,
  onToggleMode,
  onAction,
  onToggleBreakpoint,
  onInspect,
  inspectData,
  onCloseInspect,
}: DebugPanelProps) {
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  if (!debugMode) {
    return (
      <div className="border-t border-border p-3">
        <Button
          size="sm"
          variant="outline"
          onClick={onToggleMode}
          className="w-full justify-start h-8 text-xs bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/20"
        >
          <Warning2Filled className="mr-2 h-3 w-3" />
          Enable Debug Mode
        </Button>
      </div>
    );
  }

  const steps = debugState?.steps || [];
  const currentStepIndex = debugState?.current_step ?? null;

  return (
    <div className="bg-muted/20">
      {/* debug header with controls */}
      <div className="p-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Warning2Filled className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-xs font-medium">debug mode</span>
            <Badge
              variant="outline"
              className={`text-[9px] ${
                debugPaused
                  ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                  : "bg-green-500/10 text-green-400 border-green-500/20"
              }`}
            >
              {debugPaused ? "paused" : "running"}
            </Badge>
            {currentStepIndex !== null && (
              <span className="text-[10px] text-foreground/40">
                step {currentStepIndex + 1}/{steps.length}
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
          {debugPaused ? (
            <>
              <Button
                size="sm"
                onClick={() => onAction("continue")}
                className="h-7 px-2 text-xs bg-green-500/10 text-green-400 hover:bg-green-500/20"
              >
                <PlayFilled className="mr-1 h-3 w-3" />
                resume
              </Button>
              <Button
                size="sm"
                onClick={() => onAction("step", (currentStepIndex ?? -1) + 1)}
                disabled={currentStepIndex === null || currentStepIndex >= steps.length - 1}
                className="h-7 px-2 text-xs"
              >
                <ForwardFilled className="mr-1 h-3 w-3" />
                next agent
              </Button>
              <Button
                size="sm"
                onClick={() => onAction("skip", currentStepIndex ?? 0)}
                disabled={currentStepIndex === null}
                className="h-7 px-2 text-xs"
              >
                <SkipForwardFilled className="mr-1 h-3 w-3" />
                skip
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              onClick={() => onAction("pause")}
              className="h-7 px-2 text-xs bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
            >
              <PauseFilled className="mr-1 h-3 w-3" />
              pause
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => onAction("retry", currentStepIndex ?? 0)}
            disabled={currentStepIndex === null}
            className="h-7 px-2 text-xs"
          >
            <RotateLeftFilled className="mr-1 h-3 w-3" />
            retry
          </Button>
          <Button
            size="sm"
            onClick={() => onAction("abort")}
            className="h-7 px-2 text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 ml-auto"
          >
            <StopFilled className="mr-1 h-3 w-3" />
            abort
          </Button>
        </div>
      </div>

      {/* breakpoints section */}
      <div className="p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] text-foreground/40 uppercase tracking-wide">
            breakpoints
          </span>
          <span className="text-[9px] text-foreground/30">
            {debugBreakpoints.size} set
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          {agents.map((agent) => {
            const hasBreakpoint = debugBreakpoints.has(agent.id);
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
                {hasBreakpoint ? <Warning2Filled className="h-2.5 w-2.5" /> : <BotMessageSquare className="h-2.5 w-2.5" />}
                <span className="truncate max-w-[80px]">{agent.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* step execution log */}
      <div className="p-3 max-h-48 overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] text-foreground/40 uppercase tracking-wide">
            execution
          </span>
        </div>
        <div className="space-y-1">
          {steps.length === 0 ? (
            <p className="text-[10px] text-foreground/30 italic">
              waiting for execution...
            </p>
          ) : (
            steps.map((step, idx) => {
              const isCurrent = idx === currentStepIndex;
              const hasBreakpoint = debugBreakpoints.has(step.agent_id);
              const agent = agents.find((a) => a.id === step.agent_id);
              const expanded = expandedStep === idx;

              return (
                <div key={idx}>
                  <button
                    onClick={() => setExpandedStep(expanded ? null : idx)}
                    className={`w-full flex items-center gap-2 p-2 rounded text-left transition-colors ${
                      isCurrent
                        ? "bg-amber-500/10 border border-amber-500/20"
                        : "bg-muted/5 hover:bg-muted/10"
                    }`}
                  >
                    <div className="shrink-0">
                      {expanded ? (
                        <ArrowDown2Filled className="h-3 w-3 text-foreground/40" />
                      ) : (
                        <ArrowRight2Filled className="h-3 w-3 text-foreground/40" />
                      )}
                    </div>
                    {hasBreakpoint && (
                      <Warning2Filled className="h-2.5 w-2.5 text-red-400 shrink-0" />
                    )}
                    <span className="text-[9px] text-foreground/30 font-mono w-4">
                      {idx + 1}
                    </span>
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
                          : step.status === "skipped"
                          ? "bg-foreground/10 text-foreground/40"
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
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onInspect(step.agent_id)}
                        className="h-6 px-2 text-[9px] w-full mt-2"
                      >
                        <EyeFilled className="mr-1 h-2.5 w-2.5" />
                        inspect state
                      </Button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* agent inspection modal */}
      {inspectData && (
        <div className="fixed inset-0 bg-muted/50 flex items-center justify-center z-50 p-4">
          <Card className="bg-card max-w-2xl w-full max-h-[80vh] overflow-auto">
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <EyeFilled className="h-4 w-4 text-foreground/40" />
                <span className="text-sm font-medium">
                  {agents.find((a) => a.id === inspectData.agentId)?.name || inspectData.agentId}
                </span>
                <Badge variant="outline" className="text-[9px]">
                  {inspectData.agentId}
                </Badge>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={onCloseInspect}
                className="h-7 w-7 p-0"
              >
                ×
              </Button>
            </div>
            <div className="p-4 space-y-4">
              {/* prompt */}
              {inspectData.prompt && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <DocumentTextFilled className="h-3 w-3 text-foreground/40" />
                    <span className="text-[10px] text-foreground/40 uppercase tracking-wide">
                      prompt
                    </span>
                  </div>
                  <pre className="text-[10px] bg-muted/5 p-3 overflow-x-auto whitespace-pre-wrap text-foreground/60">
                    {inspectData.prompt}
                  </pre>
                </div>
              )}

              {/* messages */}
              {inspectData.messages && inspectData.messages.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <MessageFilled className="h-3 w-3 text-foreground/40" />
                    <span className="text-[10px] text-foreground/40 uppercase tracking-wide">
                      messages ({inspectData.messages.length})
                    </span>
                  </div>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {inspectData.messages.map((msg, idx) => (
                      <div key={idx} className="text-[9px] bg-muted/5 p-2">
                        <span className="text-foreground/30 font-mono">{msg.role}:</span>
                        <p className="text-foreground/60 mt-1 whitespace-pre-wrap">
                          {typeof msg.content === "string"
                            ? msg.content.slice(0, 200) + (msg.content.length > 200 ? "..." : "")
                            : JSON.stringify(msg.content).slice(0, 200) + "..."}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* context */}
              {inspectData.context && Object.keys(inspectData.context).length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <FlashFilled className="h-3 w-3 text-foreground/40" />
                    <span className="text-[10px] text-foreground/40 uppercase tracking-wide">
                      context
                    </span>
                  </div>
                  <pre className="text-[9px] bg-muted/5 rounded p-3 overflow-x-auto text-foreground/60">
                    {JSON.stringify(inspectData.context, null, 2)}
                  </pre>
                </div>
              )}

              {/* state - raw or parsed */}
              {(inspectData.stateRaw || (inspectData.state && Object.keys(inspectData.state).length > 0)) && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <BotMessageSquare className="h-3 w-3 text-foreground/40" />
                      <span className="text-[10px] text-foreground/40 uppercase tracking-wide">
                        agent state
                      </span>
                    </div>
                    {inspectData.statePath && (
                      <span className="text-[8px] text-foreground/30 font-mono truncate max-w-[150px]">
                        {inspectData.statePath.split("/").pop()}
                      </span>
                    )}
                  </div>
                  {inspectData.stateRaw ? (
                    <pre className="text-[9px] bg-muted/5 rounded p-3 overflow-x-auto text-foreground/60 whitespace-pre-wrap">
                      {inspectData.stateRaw}
                    </pre>
                  ) : (
                    <pre className="text-[9px] bg-muted/5 rounded p-3 overflow-x-auto text-foreground/60">
                      {JSON.stringify(inspectData.state, null, 2)}
                    </pre>
                  )}
                </div>
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
