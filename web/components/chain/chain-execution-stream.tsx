"use client";

import { useState, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useWebSocket } from "@/hooks/use-websocket";
import { LiveIndicator } from "@/components/live-indicator";
import {
  PlayFilled as Play,
  TickCircleFilled as CheckCircle2,
  CloseCircleFilled as XCircle,
  ClockFilled as Clock,
  ArrowDown2Filled as ChevronDown,
  ArrowRight2Filled as ChevronRight,
  CommandSquareFilled as Terminal,
} from "@aliimam/icons";
import type { StreamEvent } from "@/hooks/use-websocket";

export interface ChainStep {
  id: string;
  agentName: string;
  status: "pending" | "running" | "completed" | "failed";
  started?: string;
  completed?: string;
  output?: string[];
  error?: string;
}

export interface ChainExecutionStreamProps {
  runId: string;
  chainName: string;
  onComplete?: (result: unknown) => void;
  onError?: (error: string) => void;
}

function getStatusColor(status: ChainStep["status"]) {
  switch (status) {
    case "running":
      return "bg-green-500/20 text-green-400";
    case "completed":
      return "bg-blue-500/20 text-blue-400";
    case "failed":
      return "bg-red-500/20 text-red-400";
    default:
      return "bg-muted text-foreground/40";
  }
}

function getStatusIcon(status: ChainStep["status"]) {
  switch (status) {
    case "running":
      return <Play className="h-3 w-3" />;
    case "completed":
      return <CheckCircle2 className="h-3 w-3" />;
    case "failed":
      return <XCircle className="h-3 w-3" />;
    default:
      return <Clock className="h-3 w-3" />;
  }
}

export function ChainExecutionStream({
  runId,
  chainName,
  onComplete,
  onError,
}: ChainExecutionStreamProps) {
  const [steps, setSteps] = useState<ChainStep[]>([]);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [isComplete, setIsComplete] = useState(false);

  const { connected, connectionState, reconnect } = useWebSocket({
    runId,
    onEvent: (event: StreamEvent) => {
      handleStreamEvent(event);
    },
  });

  const stepMapRef = useRef<Map<string, ChainStep>>(new Map());

  const handleStreamEvent = useCallback((event: StreamEvent) => {
    switch (event.type) {
      case "session_status": {
        const data = event.data as Record<string, unknown>;
        const agentId = data.agent_id as string || event.agent_id || "unknown";
        const status = data.status as string;

        stepMapRef.current.set(agentId, {
          id: agentId,
          agentName: data.agent_name as string || agentId,
          status: status === "running" ? "running" :
                  status === "completed" ? "completed" :
                  status === "failed" ? "failed" : "pending",
          started: data.started as string | undefined,
          completed: data.completed as string | undefined,
          output: data.output ? [String(data.output)] : [],
        });

        setSteps(Array.from(stepMapRef.current.values()));
        break;
      }

      case "agent_complete": {
        const data = event.data as Record<string, unknown>;
        const agentId = data.agent_id as string || event.agent_id || "unknown";

        const existing = stepMapRef.current.get(agentId);
        if (existing) {
          stepMapRef.current.set(agentId, {
            ...existing,
            status: "completed",
            completed: new Date().toISOString(),
          });
          setSteps(Array.from(stepMapRef.current.values()));
        }
        break;
      }

      case "chain_complete": {
        setIsComplete(true);
        onComplete?.(event.data);
        break;
      }

      case "error": {
        const data = event.data as Record<string, unknown>;
        const errorMsg = data.error as string || "Unknown error";
        onError?.(errorMsg);
        break;
      }
    }
  }, [onComplete, onError]);

  const toggleStep = (stepId: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) {
        next.delete(stepId);
      } else {
        next.add(stepId);
      }
      return next;
    });
  };

  const runningCount = steps.filter((s) => s.status === "running").length;
  const completedCount = steps.filter((s) => s.status === "completed").length;
  const failedCount = steps.filter((s) => s.status === "failed").length;

  return (
    <Card className="bg-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Terminal className="h-4 w-4 text-foreground/50" />
            <div>
              <CardTitle className="text-sm">{chainName}</CardTitle>
              <p className="text-xs text-foreground/40 mt-0.5">
                {runningCount > 0
                  ? `${runningCount} agent${runningCount > 1 ? "s" : ""} running`
                  : isComplete
                  ? "Execution complete"
                  : "Waiting to start"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs">
              {completedCount > 0 && (
                <Badge
                  variant="outline"
                  className="bg-blue-500/20 text-blue-400"
                >
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  {completedCount}
                </Badge>
              )}
              {runningCount > 0 && (
                <Badge
                  variant="outline"
                  className="bg-green-500/20 text-green-400"
                >
                  <Play className="h-3 w-3 mr-1" />
                  {runningCount}
                </Badge>
              )}
              {failedCount > 0 && (
                <Badge
                  variant="outline"
                  className="bg-red-500/20 text-red-400"
                >
                  <XCircle className="h-3 w-3 mr-1" />
                  {failedCount}
                </Badge>
              )}
            </div>

            <LiveIndicator connected={connected} size="sm" />

            {connectionState.status === "reconnecting" && (
              <Button
                size="sm"
                variant="ghost"
                onClick={reconnect}
                className="h-7 text-xs"
              >
                Reconnecting... ({connectionState.reconnectAttempts})
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-1">
        {steps.length === 0 ? (
          <div className="text-center py-8 text-foreground/40 text-sm">
            {connected ? "Waiting for agents to start..." : "Connecting..."}
          </div>
        ) : (
          steps.map((step) => {
            const isExpanded = expandedSteps.has(step.id);
            return (
              <div
                key={step.id}
                className={`rounded-lg transition-colors ${
                  isExpanded ? "bg-muted" : "hover:bg-card"
                }`}
              >
                <button
                  onClick={() => toggleStep(step.id)}
                  className="w-full flex items-center gap-3 p-3 text-left"
                >
                  <div className="shrink-0">
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 text-foreground/40" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-foreground/40" />
                    )}
                  </div>

                  <div className={`shrink-0 ${getStatusColor(step.status)} rounded-full p-1.5`}>
                    {getStatusIcon(step.status)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">
                        {step.agentName}
                      </span>
                      <Badge
                        variant="outline"
                        className={`text-xs ${getStatusColor(step.status)}`}
                      >
                        {step.status}
                      </Badge>
                    </div>
                  </div>

                  <div className="text-xs text-foreground/40 shrink-0">
                    {step.completed
                      ? `Completed ${new Date(step.completed).toLocaleTimeString()}`
                      : step.started
                      ? `Started ${new Date(step.started).toLocaleTimeString()}`
                      : "Pending"}
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-3 pb-3 ml-7 pt-3">
                    {step.output && step.output.length > 0 ? (
                      <div className="bg-muted rounded p-3 font-mono text-xs text-green-400 overflow-x-auto">
                        {step.output.map((line, i) => (
                          <div key={i} className="whitespace-pre-wrap break-words">
                            {line}
                          </div>
                        ))}
                      </div>
                    ) : step.error ? (
                      <div className="bg-red-500/10 rounded p-3 font-mono text-xs text-red-400">
                        {step.error}
                      </div>
                    ) : (
                      <div className="text-foreground/40 text-sm italic">
                        No output yet
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
