"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AddFilled as Plus, TrashFilled as Trash2, ArrowRightFilled as ArrowRight, FlashFilled as Zap, HierarchyFilled as GitMerge, ArrowDown2Filled as ChevronDown, ArrowRight2Filled as ChevronRight, InfoCircleFilled as AlertCircle } from "@aliimam/icons";
import type { ChainAgent } from "@/components/chain";
import type { ChainBranch } from "@/components/chain";

interface AgentEventMappingProps {
  agents: ChainAgent[];
  branches?: ChainBranch;
  onChange: (agents: ChainAgent[]) => void;
  onBranchesChange?: (branches: ChainBranch) => void;
}

interface EventConnection {
  fromAgent: ChainAgent;
  toAgent?: ChainAgent;
  event: string;
  type: "emit" | "error" | "timeout";
}

const COMMON_EVENTS = [
  "chain-started",
  "chain-completed",
  "task-done",
  "analysis-done",
  "code-done",
  "review-done",
  "error",
  "timeout",
  "manual-start",
];

export function AgentEventMapping({ agents, branches, onChange, onBranchesChange }: AgentEventMappingProps) {
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());

  const toggleAgent = (agentId: string) => {
    setExpandedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  };

  const updateAgent = (agentId: string, updates: Partial<ChainAgent>) => {
    onChange(agents.map((a) => (a.id === agentId ? { ...a, ...updates } : a)));
  };

  const addTrigger = (agentId: string, trigger: string) => {
    const agent = agents.find((a) => a.id === agentId);
    if (!agent || !trigger.trim()) return;
    const trimmed = trigger.trim();
    if ((agent.triggers || []).includes(trimmed)) return;
    updateAgent(agentId, { triggers: [...(agent.triggers || []), trimmed] });
  };

  const removeTrigger = (agentId: string, trigger: string) => {
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) return;
    updateAgent(agentId, { triggers: (agent.triggers || []).filter((t) => t !== trigger) });
  };

  const updateEmit = (agentId: string, emit: string) => {
    updateAgent(agentId, { emits: emit });
  };

  const updateErrorHandler = (agentId: string, handler: string) => {
    updateAgent(agentId, { on_error: handler || undefined });
  };

  const updateTimeoutHandler = (agentId: string, handler: string) => {
    updateAgent(agentId, { on_timeout: handler || undefined });
  };

  const eventTopology = useMemo(() => {
    const connections: EventConnection[] = [];

    agents.forEach((agent) => {
      // emit connections (via branches)
      if (agent.emits) {
        const branchTarget = branches?.[agent.emits];
        if (typeof branchTarget === "string") {
          const targetAgent = agents.find((a) => a.id === branchTarget);
          connections.push({
            fromAgent: agent,
            toAgent: targetAgent,
            event: agent.emits,
            type: "emit",
          });
        } else if (Array.isArray(branchTarget)) {
          branchTarget.forEach((targetId) => {
            const targetAgent = agents.find((a) => a.id === targetId);
            connections.push({
              fromAgent: agent,
              toAgent: targetAgent,
              event: agent.emits,
              type: "emit",
            });
          });
        }
      }

      // error handler connection
      if (agent.on_error) {
        const targetAgent = agents.find((a) => a.id === agent.on_error);
        connections.push({
          fromAgent: agent,
          toAgent: targetAgent,
          event: "error",
          type: "error",
        });
      }

      // timeout handler connection
      if (agent.on_timeout) {
        const targetAgent = agents.find((a) => a.id === agent.on_timeout);
        connections.push({
          fromAgent: agent,
          toAgent: targetAgent,
          event: "timeout",
          type: "timeout",
        });
      }
    });

    return connections;
  }, [agents, branches]);

  const buildTopologyPreview = () => {
    const lines: string[] = [];
    const processed = new Set<string>();

    // find entry points (agents with manual-start trigger)
    const entryPoints = agents.filter((a) => (a.triggers || []).includes("manual-start"));

    const traverse = (agent: ChainAgent, prefix: string = "", isLast: boolean = true) => {
      if (processed.has(agent.id)) {
        lines.push(`${prefix}${isLast ? "└─" : "├─"} ${agent.name} (already visited)`);
        return;
      }
      processed.add(agent.id);

      const emitInfo = agent.emits ? `[emits: ${agent.emits}]` : "";
      lines.push(`${prefix}${isLast ? "└─" : "├─"} ${agent.name} ${emitInfo}`);

      // find children
      const children = eventTopology.filter((c) => c.fromAgent.id === agent.id && c.toAgent);

      children.forEach((child, idx) => {
        const isLastChild = idx === children.length - 1;
        const childPrefix = `${prefix}${isLast ? "  " : "│  "}`;
        traverse(child.toAgent!, childPrefix, isLastChild);
      });
    };

    entryPoints.forEach((agent, idx) => {
      const isLast = idx === entryPoints.length - 1;
      traverse(agent, "", isLast);
    });

    // handle unconnected agents
    const unconnected = agents.filter((a) => !processed.has(a.id));
    if (unconnected.length > 0) {
      lines.push("");
      lines.push("(unconnected agents)");
      unconnected.forEach((a) => {
        lines.push(`└─ ${a.name}`);
      });
    }

    return lines.length > 0 ? lines.join("\n") : "no agents defined";
  };

  const allOtherAgents = (currentId: string) =>
    agents.filter((a) => a.id !== currentId);

  return (
    <div className="space-y-6">
      {/* topology preview */}
      <div className="rounded-md bg-muted/30 p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-medium">Event Topology Preview</h4>
          <Badge variant="outline" className="text-[10px]">
            {agents.length} agents, {eventTopology.length} connections
          </Badge>
        </div>
        <pre className="text-xs font-mono text-foreground/70 whitespace-pre-wrap leading-relaxed">
          {buildTopologyPreview()}
        </pre>
      </div>

      {/* event map visualization */}
      <div>
        <h4 className="text-sm font-medium mb-3 flex items-center gap-1.5">
          <GitMerge className="w-3.5 h-3.5 text-foreground/40" />
          Event Map
        </h4>
        <p className="text-xs text-foreground/40 mb-3">
          Events flow between agents. Configure connections below.
        </p>
        <div className="space-y-2">
          {eventTopology.map((conn, idx) => (
            <div
              key={idx}
              className="flex items-center gap-2 rounded-md bg-card px-3 py-2 text-xs"
            >
              <span className="font-mono text-foreground/70">{conn.fromAgent.name}</span>
              <ArrowRight className="w-3 h-3 text-foreground/30" />
              <Badge variant="secondary" className="text-[10px] font-mono">
                {conn.event}
              </Badge>
              <ArrowRight className="w-3 h-3 text-foreground/30" />
              <span className="font-mono text-foreground/70">
                {conn.toAgent?.name || "(unknown)"}
              </span>
              <Badge
                variant={conn.type === "error" ? "destructive" : "outline"}
                className="ml-auto text-[10px]"
              >
                {conn.type}
              </Badge>
            </div>
          ))}
          {eventTopology.length === 0 && (
            <div className="rounded-md border border-dashed border-foreground/10 p-4 text-center">
              <AlertCircle className="w-4 h-4 text-foreground/20 mx-auto mb-2" />
              <p className="text-xs text-foreground/40">No event connections configured</p>
            </div>
          )}
        </div>
      </div>

      {/* agent event configuration */}
      <div>
        <h4 className="text-sm font-medium mb-3 flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5 text-foreground/40" />
          Agent Event Configuration
        </h4>
        <p className="text-xs text-foreground/40 mb-3">
          Configure triggers (what starts an agent) and emits (what an agent produces).
        </p>
        <div className="space-y-3">
          {agents.map((agent) => {
            const isExpanded = expandedAgents.has(agent.id);
            return (
              <div key={agent.id} className="rounded-md bg-card overflow-hidden">
                <button
                  onClick={() => toggleAgent(agent.id)}
                  className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-foreground/40" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-foreground/40" />
                    )}
                    <span className="text-sm font-medium">{agent.name}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {agent.id}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    {agent.emits && (
                      <Badge variant="secondary" className="text-[10px] font-mono">
                        emits: {agent.emits}
                      </Badge>
                    )}
                    <span className="text-[10px] text-foreground/40">
                      {(agent.triggers || []).length} triggers
                    </span>
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-foreground/5 p-3 space-y-4">
                    {/* triggers section */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-[10px] text-foreground/50 uppercase tracking-wide">
                          Triggers (events that start this agent)
                        </Label>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {(agent.triggers || []).map((trigger) => (
                          <Badge
                            key={trigger}
                            variant="outline"
                            className="font-mono text-xs bg-muted/50 px-1.5 py-0.5 gap-1"
                          >
                            <code>{trigger}</code>
                            <button
                              onClick={() => removeTrigger(agent.id, trigger)}
                              className="hover:text-destructive transition-colors"
                            >
                              <Trash2 className="w-2.5 h-2.5" />
                            </button>
                          </Badge>
                        ))}
                        <div className="flex gap-1">
                          <Input
                            placeholder="new trigger"
                            className="h-6 w-24 text-xs bg-background"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                const target = e.target as HTMLInputElement;
                                addTrigger(agent.id, target.value);
                                target.value = "";
                              }
                            }}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-xs"
                            onClick={() => {
                              const input = document.querySelector(
                                `input[placeholder="new trigger"]`
                              ) as HTMLInputElement;
                              if (input?.value) {
                                addTrigger(agent.id, input.value);
                                input.value = "";
                              }
                            }}
                          >
                            <Plus className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <span className="text-[10px] text-foreground/30">common:</span>
                        {COMMON_EVENTS.filter((e) => !(agent.triggers || []).includes(e)).slice(0, 4).map((event) => (
                          <button
                            key={event}
                            onClick={() => addTrigger(agent.id, event)}
                            className="text-[10px] text-foreground/40 hover:text-foreground/70 transition-colors underline"
                          >
                            {event}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* emits section */}
                    <div className="space-y-2">
                      <Label className="text-[10px] text-foreground/50 uppercase tracking-wide">
                        Emit (event this agent produces)
                      </Label>
                      <div className="flex gap-2">
                        <Input
                          value={agent.emits || ""}
                          onChange={(e) => updateEmit(agent.id, e.target.value)}
                          placeholder="e.g. analysis-complete"
                          className="h-8 text-xs bg-background font-mono"
                        />
                        {onBranchesChange && agent.emits && (
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-foreground/30">→</span>
                            <select
                              value={(typeof branches?.[agent.emits] === "string" ? branches[agent.emits] : "") as string}
                              onChange={(e) => {
                                const newBranches = { ...branches } as ChainBranch;
                                if (e.target.value) {
                                  newBranches[agent.emits] = e.target.value;
                                } else {
                                  delete newBranches[agent.emits];
                                }
                                onBranchesChange(newBranches);
                              }}
                              className="h-8 text-xs bg-background rounded-md border border-foreground/10 px-2"
                            >
                              <option value="">select target agent</option>
                              {allOtherAgents(agent.id).map((other) => (
                                <option key={other.id} value={other.id}>
                                  {other.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* error handler */}
                    <div className="space-y-2">
                      <Label className="text-[10px] text-foreground/50 uppercase tracking-wide">
                        On Error (agent to run when this agent fails)
                      </Label>
                      <div className="flex gap-2">
                        <select
                          value={agent.on_error || ""}
                          onChange={(e) => updateErrorHandler(agent.id, e.target.value)}
                          className="h-8 text-xs bg-background rounded-md border border-foreground/10 px-2 flex-1"
                        >
                          <option value="">none</option>
                          {allOtherAgents(agent.id).map((other) => (
                            <option key={other.id} value={other.id}>
                              {other.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* timeout handler */}
                    <div className="space-y-2">
                      <Label className="text-[10px] text-foreground/50 uppercase tracking-wide">
                        On Timeout (agent to run when this agent times out)
                      </Label>
                      <div className="flex gap-2">
                        <select
                          value={agent.on_timeout || ""}
                          onChange={(e) => updateTimeoutHandler(agent.id, e.target.value)}
                          className="h-8 text-xs bg-background rounded-md border border-foreground/10 px-2 flex-1"
                        >
                          <option value="">none</option>
                          {allOtherAgents(agent.id).map((other) => (
                            <option key={other.id} value={other.id}>
                              {other.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
