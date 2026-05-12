"use client";

import { memo, useState, useRef, useCallback } from "react";
import { AgentPreview } from "./agent-preview";
import type { ChainAgent as BaseChainAgent, ChainBranch as BaseChainBranch } from "@/lib/types";

export type ChainAgent = Omit<BaseChainAgent, 'model' | 'tools' | 'prompt'>;

export type ChainBranch = BaseChainBranch;

// parallel branches with their own agents
export interface ParallelBranch {
  agents: ChainAgent[];
  condition?: string;
}

export type ChainBranches = Record<string, string | string[] | ParallelBranch>;

interface ChainFlowGraphProps {
  agents: ChainAgent[];
  branches?: ChainBranch;
  width?: number;
  height?: number;
  showRoutingDetails?: boolean;
}

interface Node {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  type: "start" | "middle" | "loop" | "decision" | "error" | "timeout" | "fanin";
  hasTimeout: boolean;
  hasRetry: boolean;
}

interface Edge {
  from: string;
  to: string;
  label: string;
  isLoopBack: boolean;
  isConditional?: boolean;
  isFanOut?: boolean;
  isFanIn?: boolean;
  isErrorRoute?: boolean;
  isTimeoutRoute?: boolean;
  edgeStyle?: "solid" | "dashed" | "dotted";
}

export const ChainFlowGraph = memo(function ChainFlowGraph({ agents, branches, width = 600, height = 400 }: ChainFlowGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredAgent, setHoveredAgent] = useState<BaseChainAgent | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const handleNodeMouseEnter = useCallback((e: React.MouseEvent, agentId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    if (!agent || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setTooltipPos({
      x: e.clientX - rect.left + 12,
      y: e.clientY - rect.top - 8,
    });
    setHoveredAgent(agent as unknown as BaseChainAgent);
  }, [agents]);

  const handleNodeMouseLeave = useCallback(() => {
    setHoveredAgent(null);
  }, []);

  const nodeWidth = 140;
  const nodeHeight = 50;
  const verticalGap = 80;
  const horizontalGap = 20;

  // Build graph structure
  const buildGraph = (): { nodes: Node[]; edges: Edge[] } => {
    // Find entry points (agents with manual-start trigger)
    const entryAgents = agents.filter((a) =>
      (a.triggers || []).includes("manual-start")
    );

    // Determine node types
    const getNode = (agent: ChainAgent, level: number, offset: number): Node => {
      const hasNeedsRevision = (agent.triggers || []).some((t) =>
        t.includes("needs-revision") || t.includes("revision")
      );

      // check if this agent's emitted event has branching
      const branch = branches?.[agent.emits];
      const hasBranching = branch !== undefined;

      // check for fan-out/fan-in
      const hasFanOut = typeof branch === "object" && branch !== null && "fan_out" in branch;

      // check if this agent is a fan-in target (referenced as fan_in in any branch)
      const isFanInTarget = Object.values(branches ?? {}).some(
        (b) => typeof b === "object" && b !== null && "fan_in" in b && (b as { fan_in?: string }).fan_in === agent.id
      );

      // check if this agent is an error handler (triggered by error events)
      const isErrorHandler = (agent.triggers || []).some((t) =>
        t.includes("error") || t.includes("timeout")
      );

      let type: "start" | "middle" | "loop" | "decision" | "error" | "timeout" | "fanin" = "middle";
      if ((agent.triggers || []).includes("manual-start")) type = "start";
      else if (hasNeedsRevision) type = "loop";
      else if (isFanInTarget) type = "fanin";
      else if (hasBranching && !hasFanOut) type = "decision";
      else if (isErrorHandler) {
        type = (agent.triggers || []).some((t) => t.includes("timeout")) ? "timeout" : "error";
      }

      return {
        id: agent.id,
        name: agent.name,
        x: offset,
        y: level * (nodeHeight + verticalGap) + 40,
        width: nodeWidth,
        height: nodeHeight,
        type,
        hasTimeout: (agent.timeout ?? 0) > 0,
        hasRetry: (agent.retry?.max_retries ?? 0) > 0,
      };
    };

    // Build levels based on flow
    const levels: ChainAgent[][] = [];
    const placed = new Set<string>();
    const emitMap = new Map<string, ChainAgent[]>();

    // Build emit -> agents map
    agents.forEach((agent) => {
      (agent.triggers || []).forEach((trigger) => {
        if (!emitMap.has(trigger)) {
          emitMap.set(trigger, []);
        }
        emitMap.get(trigger)!.push(agent);
      });
    });

    // BFS to assign levels
    const queue: { agent: ChainAgent; level: number }[] = [
      ...entryAgents.map((a) => ({ agent: a, level: 0 })),
    ];

    while (queue.length > 0) {
      const { agent, level } = queue.shift()!;

      if (placed.has(agent.id)) continue;
      placed.add(agent.id);

      if (!levels[level]) levels[level] = [];
      levels[level].push(agent);

      // Find next agents
      const nextAgents = emitMap.get(agent.emits) || [];
      nextAgents.forEach((next) => {
        if (!placed.has(next.id)) {
          queue.push({ agent: next, level: level + 1 });
        }
      });
    }

    // Add any unplaced agents (orphans)
    agents.forEach((agent) => {
      if (!placed.has(agent.id)) {
        if (!levels[0]) levels[0] = [];
        levels[0].push(agent);
      }
    });

    // Calculate positions
    const nodes: Node[] = [];
    levels.forEach((levelAgents, levelIdx) => {
      const levelWidth = levelAgents.length * nodeWidth +
        (levelAgents.length - 1) * horizontalGap;
      const startX = (width - levelWidth) / 2;

      levelAgents.forEach((agent, agentIdx) => {
        const x = startX + agentIdx * (nodeWidth + horizontalGap);
        nodes.push(getNode(agent, levelIdx, x));
      });
    });

    // Build edges - include branch mappings and error routes
    const edges: Edge[] = [];

    // helper to check if branch is object with conditions
    const isConditionalBranch = (branch: unknown): branch is { conditions: Array<{ if: string; then: string }>, default?: string } => {
      return typeof branch === "object" && branch !== null && "conditions" in branch;
    };

    // helper to check if branch is fan-out object
    const isFanOutBranch = (branch: unknown): branch is { fan_out: string[], fan_in?: string, on_error?: string } => {
      return typeof branch === "object" && branch !== null && "fan_out" in branch;
    };

    // add error handler edges from agent on_error/on_timeout properties
    agents.forEach((agent) => {
      const fromNode = nodes.find((n) => n.id === agent.id);
      if (!fromNode) return;

      if (agent.on_timeout) {
        const toNode = nodes.find((n) => n.id === agent.on_timeout);
        if (toNode) {
          edges.push({
            from: agent.id,
            to: agent.on_timeout,
            label: "timeout",
            isLoopBack: false,
            isTimeoutRoute: true,
            edgeStyle: "dashed",
          });
        }
      }

      if (agent.on_error) {
        const toNode = nodes.find((n) => n.id === agent.on_error);
        if (toNode) {
          edges.push({
            from: agent.id,
            to: agent.on_error,
            label: "error",
            isLoopBack: false,
            isErrorRoute: true,
            edgeStyle: "dashed",
          });
        }
      }
    });

    agents.forEach((fromAgent) => {
      // check if there's a branch mapping for this agent's emitted event
      const branchTarget = branches?.[fromAgent.emits];
      const fromNode = nodes.find((n) => n.id === fromAgent.id);

      if (branchTarget && fromNode) {
        // string = simple branch
        if (typeof branchTarget === "string") {
          const toNode = nodes.find((n) => n.id === branchTarget);
          if (toNode) {
            const isLoopBack = toNode.y < fromNode.y;
            edges.push({
              from: fromAgent.id,
              to: branchTarget,
              label: fromAgent.emits,
              isLoopBack,
              isConditional: true,
            });
          }
        }
        // array = fan-out (parallel)
        else if (Array.isArray(branchTarget)) {
          branchTarget.forEach((targetId) => {
            const toNode = nodes.find((n) => n.id === targetId);
            if (toNode) {
              const isLoopBack = toNode.y < fromNode.y;
              edges.push({
                from: fromAgent.id,
                to: targetId,
                label: fromAgent.emits,
                isLoopBack,
                isFanOut: true,
              });
            }
          });
        }
        // object with fan_out
        else if (isFanOutBranch(branchTarget)) {
          const { fan_out, fan_in, on_error } = branchTarget;

          // fan-out edges
          fan_out.forEach((targetId: string) => {
            const toNode = nodes.find((n) => n.id === targetId);
            if (toNode) {
              const isLoopBack = toNode.y < fromNode.y;
              edges.push({
                from: fromAgent.id,
                to: targetId,
                label: fromAgent.emits,
                isLoopBack,
                isFanOut: true,
              });
            }
          });

          // fan-in edge (if specified)
          if (fan_in) {
            fan_out.forEach((sourceId: string) => {
              const sourceNode = nodes.find((n) => n.id === sourceId);
              const targetNode = nodes.find((n) => n.id === fan_in);
              if (sourceNode && targetNode) {
                edges.push({
                  from: sourceId,
                  to: fan_in,
                  label: "fan-in",
                  isLoopBack: false,
                  isFanIn: true,
                  edgeStyle: "dotted",
                });
              }
            });
          }

          // error handler edge for fan-out group
          if (on_error) {
            fan_out.forEach((sourceId: string) => {
              const sourceNode = nodes.find((n) => n.id === sourceId);
              const targetNode = nodes.find((n) => n.id === on_error);
              if (sourceNode && targetNode) {
                edges.push({
                  from: sourceId,
                  to: on_error,
                  label: "error",
                  isLoopBack: false,
                  isErrorRoute: true,
                  edgeStyle: "dashed",
                });
              }
            });
          }
        }
        // conditional branch
        else if (isConditionalBranch(branchTarget)) {
          const { conditions, default: defaultTarget } = branchTarget;

          conditions.forEach((cond) => {
            const toNode = nodes.find((n) => n.id === cond.then);
            if (toNode) {
              const isLoopBack = toNode.y < fromNode.y;
              edges.push({
                from: fromAgent.id,
                to: cond.then,
                label: cond.if,
                isLoopBack,
                isConditional: true,
              });
            }
          });

          if (defaultTarget) {
            const toNode = nodes.find((n) => n.id === defaultTarget);
            if (toNode) {
              const isLoopBack = toNode.y < fromNode.y;
              edges.push({
                from: fromAgent.id,
                to: defaultTarget,
                label: "default",
                isLoopBack,
                isConditional: true,
              });
            }
          }
        }
      } else {
        // no branch mapping - use trigger-based edges
        const toAgents = emitMap.get(fromAgent.emits) || [];
        toAgents.forEach((toAgent) => {
          const fromNode = nodes.find((n) => n.id === fromAgent.id);
          const toNode = nodes.find((n) => n.id === toAgent.id);

          if (fromNode && toNode) {
            const isLoopBack = toNode.y < fromNode.y;
            edges.push({
              from: fromAgent.id,
              to: toAgent.id,
              label: fromAgent.emits,
              isLoopBack,
            });
          }
        });
      }
    });

    return { nodes, edges };
  };

  const { nodes, edges } = buildGraph();
  const calculatedHeight = nodes.length > 0
    ? Math.max(...nodes.map((n) => n.y + n.height)) + 40
    : height;

  // Colors from globals.css (oklch dark theme)
  const colors = {
    start: "oklch(0.488 0.243 264.376)",   // purple-ish
    middle: "oklch(0.696 0.17 162.48)",    // blue-ish
    loop: "oklch(0.645 0.246 16.439)",     // orange-ish
    decision: "oklch(0.65 0.25 30)",       // amber/gold for branching
    fanin: "oklch(0.6 0.2 120)",           // green for fan-in targets
    error: "oklch(0.55 0.25 25)",          // red-ish for error handlers
    timeout: "oklch(0.5 0.2 280)",         // magenta-ish for timeout handlers
    border: "oklch(1 0 0 / 20%)",
    text: "oklch(0.97 0 0)",
    textMuted: "oklch(0.65 0 0)",
    edge: "oklch(1 0 0 / 30%)",
    edgeConditional: "oklch(0.65 0.25 30 / 60%)",  // amber tint for branch edges
    edgeFanOut: "oklch(0.6 0.2 180)",             // cyan for fan-out
    edgeFanIn: "oklch(0.6 0.2 120)",              // green for fan-in
    edgeError: "oklch(0.6 0.25 25)",              // red for error routes
    edgeTimeout: "oklch(0.6 0.2 280)",             // magenta for timeout routes
    edgeLabel: "oklch(0.65 0 0)",
  };

  // Render edges
  const renderEdges = () => {
    return edges.map((edge) => {
      const fromNode = nodes.find((n) => n.id === edge.from);
      const toNode = nodes.find((n) => n.id === edge.to);

      if (!fromNode || !toNode) return null;

      const fromX = fromNode.x + fromNode.width / 2;
      const fromY = fromNode.y + fromNode.height;
      const toX = toNode.x + toNode.width / 2;
      const toY = toNode.y;

      // determine edge color and style
      let edgeColor = colors.edge;
      if (edge.isTimeoutRoute) edgeColor = colors.edgeTimeout;
      else if (edge.isErrorRoute) edgeColor = colors.edgeError;
      else if (edge.isFanIn) edgeColor = colors.edgeFanIn;
      else if (edge.isFanOut) edgeColor = colors.edgeFanOut;
      else if (edge.isConditional) edgeColor = colors.edgeConditional;

      const strokeWidth = edge.isConditional ? "2" : "1.5";
      const strokeDasharray = edge.edgeStyle === "dashed" ? "5,5" : edge.edgeStyle === "dotted" ? "2,2" : "";

      let pathD = "";
      let labelX: number;
      let labelY: number;

      if (edge.isLoopBack) {
        // Loop back edge - curve around the right side
        const curveOut = fromX + 60;
        const curveBack = toX + 60;
        const loopMidY = (fromY + toY) / 2;

        pathD = `
          M ${fromX} ${fromY}
          C ${curveOut} ${fromY}, ${curveOut} ${toY}, ${curveBack} ${toY}
          L ${toX} ${toY}
        `;

        labelX = fromX + 70;
        labelY = loopMidY;
      } else {
        // Normal downward edge with slight curve
        const edgeMidY = (fromY + toY) / 2;
        pathD = `
          M ${fromX} ${fromY}
          C ${fromX} ${edgeMidY}, ${toX} ${edgeMidY}, ${toX} ${toY}
        `;

        labelX = (fromX + toX) / 2;
        labelY = edgeMidY;
      }

      return (
        <g
          key={`${edge.from}-${edge.to}-${edge.label}-${edge.edgeStyle ?? "solid"}-${
            edge.isFanIn ? "fanin" : edge.isFanOut ? "fanout" : edge.isErrorRoute ? "error" : edge.isTimeoutRoute ? "timeout" : edge.isConditional ? "conditional" : "default"
          }`}
        >
          <path
            d={pathD}
            fill="none"
            stroke={edgeColor}
            strokeWidth={strokeWidth}
            strokeDasharray={strokeDasharray}
            markerEnd={`url(#arrowhead-${edge.isTimeoutRoute ? 'timeout' : edge.isErrorRoute ? 'error' : edge.isFanIn ? 'fanin' : edge.isFanOut ? 'fanout' : edge.isConditional ? 'branch' : 'default'})`}
          />
          <text
            x={labelX}
            y={labelY}
            fill={colors.edgeLabel}
            fontSize="9"
            textAnchor="middle"
            dominantBaseline="middle"
            className="font-mono"
          >
            {edge.label}
          </text>
        </g>
      );
    });
  };

  // Render nodes
  const renderNodes = () => {
    return nodes.map((node) => {
      const fillColor = node.type === "start" ? colors.start :
                        node.type === "loop" ? colors.loop :
                        node.type === "decision" ? colors.decision :
                        node.type === "error" ? colors.error :
                        node.type === "timeout" ? colors.timeout :
                        colors.middle;

      return (
        <g
          key={node.id}
          onMouseEnter={(e) => handleNodeMouseEnter(e, node.id)}
          onMouseLeave={handleNodeMouseLeave}
          className="cursor-pointer"
        >
          {/* Node background */}
          <rect
            x={node.x}
            y={node.y}
            width={node.width}
            height={node.height}
            rx="8"
            fill={fillColor}
            fillOpacity="0.15"
            stroke={fillColor}
            strokeWidth={node.hasTimeout ? "2.5" : "1.5"}
            strokeDasharray={node.hasRetry ? "4,2" : ""}
          />

          {/* Agent name */}
          <text
            x={node.x + node.width / 2}
            y={node.y + 18}
            fill={colors.text}
            fontSize="11"
            fontWeight="500"
            textAnchor="middle"
          >
            {node.name}
          </text>

          {/* Agent ID */}
          <text
            x={node.x + node.width / 2}
            y={node.y + 35}
            fill={colors.textMuted}
            fontSize="9"
            textAnchor="middle"
            className="font-mono"
          >
            {node.id}
          </text>

          {/* Type badge */}
          {node.type === "start" && (
            <circle
              cx={node.x + node.width - 12}
              cy={node.y + 12}
              r="4"
              fill={colors.start}
            />
          )}
          {node.type === "loop" && (
            <circle
              cx={node.x + node.width - 12}
              cy={node.y + 12}
              r="4"
              fill={colors.loop}
            />
          )}
          {node.type === "fanin" && (
            <g transform={`translate(${node.x + node.width - 12}, ${node.y + 12})`}>
              <polygon points="0,-5 5,3 -5,3" fill={colors.fanin} />
            </g>
          )}
          {node.type === "decision" && (
            <g transform={`translate(${node.x + node.width - 12}, ${node.y + 12})`}>
              <rect x="-4" y="-4" width="8" height="8" fill={colors.decision} />
            </g>
          )}
          {node.type === "error" && (
            <g transform={`translate(${node.x + node.width - 12}, ${node.y + 12})`}>
              <polygon points="0,-5 5,4 -5,4" fill={colors.error} />
            </g>
          )}
          {node.type === "timeout" && (
            <g transform={`translate(${node.x + node.width - 12}, ${node.y + 12})`}>
              <rect x="-4" y="-4" width="8" height="8" fill={colors.timeout} rx="1" />
            </g>
          )}

          {/* Timeout indicator (bottom left corner) */}
          {node.hasTimeout && (
            <circle
              cx={node.x + 12}
              cy={node.y + node.height - 12}
              r="3"
              fill={colors.timeout}
              fillOpacity="0.8"
            />
          )}

          {/* Retry indicator (small 'r') */}
          {node.hasRetry && (
            <text
              x={node.x + node.width - 6}
              y={node.y + node.height - 6}
              fill={colors.textMuted}
              fontSize="8"
              className="font-mono"
            >
              r
            </text>
          )}
        </g>
      );
    });
  };

  return (
    <div ref={containerRef} className="relative">
    <svg
      width={width}
      height={calculatedHeight}
      viewBox={`0 0 ${width} ${calculatedHeight}`}
      className="w-full"
      style={{ display: "block" }}
    >
      <defs>
        {/* default arrow */}
        <marker
          id="arrowhead"
          markerWidth="10"
          markerHeight="7"
          refX="9"
          refY="3.5"
          orient="auto"
        >
          <polygon points="0 0, 10 3.5, 0 7" fill={colors.edge} />
        </marker>
        {/* branch arrow */}
        <marker
          id="arrowhead-branch"
          markerWidth="10"
          markerHeight="7"
          refX="9"
          refY="3.5"
          orient="auto"
        >
          <polygon points="0 0, 10 3.5, 0 7" fill={colors.edgeConditional} />
        </marker>
        {/* fan-out arrow */}
        <marker
          id="arrowhead-fanout"
          markerWidth="10"
          markerHeight="7"
          refX="9"
          refY="3.5"
          orient="auto"
        >
          <polygon points="0 0, 10 3.5, 0 7" fill={colors.edgeFanOut} />
        </marker>
        {/* fan-in arrow */}
        <marker
          id="arrowhead-fanin"
          markerWidth="10"
          markerHeight="7"
          refX="9"
          refY="3.5"
          orient="auto"
        >
          <polygon points="0 0, 10 3.5, 0 7" fill={colors.edgeFanIn} />
        </marker>
        {/* error arrow */}
        <marker
          id="arrowhead-error"
          markerWidth="10"
          markerHeight="7"
          refX="9"
          refY="3.5"
          orient="auto"
        >
          <polygon points="0 0, 10 3.5, 0 7" fill={colors.edgeError} />
        </marker>
        {/* timeout arrow */}
        <marker
          id="arrowhead-timeout"
          markerWidth="10"
          markerHeight="7"
          refX="9"
          refY="3.5"
          orient="auto"
        >
          <polygon points="0 0, 10 3.5, 0 7" fill={colors.edgeTimeout} />
        </marker>
        {/* default alias */}
        <marker
          id="arrowhead-default"
          markerWidth="10"
          markerHeight="7"
          refX="9"
          refY="3.5"
          orient="auto"
        >
          <polygon points="0 0, 10 3.5, 0 7" fill={colors.edge} />
        </marker>
      </defs>

      {edges.length > 0 && renderEdges()}
      {renderNodes()}
    </svg>

    {/* hover tooltip */}
    {hoveredAgent && (
      <div
        className="absolute z-50 pointer-events-none animate-in fade-in-0 zoom-in-95"
        style={{ left: tooltipPos.x, top: tooltipPos.y }}
      >
        <div className="bg-card rounded-md p-3">
          <AgentPreview
            id={hoveredAgent.id}
            name={hoveredAgent.name}
            role={hoveredAgent.role}
            triggers={hoveredAgent.triggers}
            emits={hoveredAgent.emits}
            timeout={hoveredAgent.timeout}
            retry={hoveredAgent.retry?.max_retries !== undefined ? {
              max_retries: hoveredAgent.retry.max_retries,
            } : undefined}
            model={hoveredAgent.model}
            prompt={hoveredAgent.prompt}
            tools={hoveredAgent.tools}
          />
        </div>
      </div>
    )}
    </div>
  );
});
