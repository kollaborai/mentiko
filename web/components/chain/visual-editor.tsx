"use client";

import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { AddFilled as Plus, TrashFilled as Trash2, BotMessageSquare as Bot, Link2Filled as Link2 } from "@aliimam/icons";
import type { ChainAgent, ChainBranch } from "./chain-flow-graph";
import type { BranchConfig } from "@/lib/types";

interface NodePosition {
  id: string;
  x: number;
  y: number;
}

interface VisualChainEditorProps {
  agents: ChainAgent[];
  branches?: ChainBranch;
  onAddAgent: () => void;
  onDeleteAgent: (id: string) => void;
  onEditAgent: (agent: ChainAgent) => void;
  onEditEdge?: (fromId: string, toId: string, event: string) => void;
  onDeleteEdge?: (fromId: string, toId: string, event: string) => void;
}

const NODE_WIDTH = 180;
const NODE_HEIGHT = 80;

export function VisualChainEditor({
  agents,
  branches,
  onAddAgent,
  onDeleteAgent,
  onEditAgent,
  onEditEdge,
  onDeleteEdge,
}: VisualChainEditorProps) {
  const [positions, setPositions] = useState<NodePosition[]>(() => {
    // layout: 3 levels, cascade horizontally
    const entry = agents.find((a) => (a.triggers || []).includes("manual-start"));
    const others = agents.filter((a) => !(a.triggers || []).includes("manual-start"));

    const pos: NodePosition[] = [];
    let yOffset = 40;

    if (entry) {
      pos.push({ id: entry.id, x: 100, y: yOffset });
      yOffset += 150;
    }

    others.forEach((a, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      pos.push({
        id: a.id,
        x: 100 + col * (NODE_WIDTH + 40),
        y: yOffset + row * 150,
      });
    });

    return pos;
  });

  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<{ from: string; to: string; event: string } | null>(null);
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [hoverNode, setHoverNode] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // get connections from branches and agent props
  const getConnections = useCallback(() => {
    const conns: { from: string; to: string; event: string; type: string }[] = [];

    // branch mappings
    Object.entries(branches || {}).forEach(([event, target]) => {
      const fromAgent = agents.find((a) => a.emits === event);
      if (fromAgent) {
        if (typeof target === "string") {
          conns.push({ from: fromAgent.id, to: target, event, type: "branch" });
        } else if (Array.isArray(target)) {
          target.forEach((t) => conns.push({ from: fromAgent.id, to: t, event, type: "branch" }));
        } else if (typeof target === "object") {
          const branchConfig = target as BranchConfig;
          const fanOut = branchConfig.fan_out;
          const fanIn = branchConfig.fan_in;
          const onError = branchConfig.on_error;

          if (Array.isArray(fanOut)) {
            fanOut.forEach((t: string) => conns.push({ from: fromAgent.id, to: t, event, type: "fanout" }));
          }
          if (fanIn) {
            fanOut?.forEach((t: string) => conns.push({ from: t, to: fanIn, event: "fan-in", type: "fanin" }));
          }
          if (onError) {
            fanOut?.forEach((t: string) => conns.push({ from: t, to: onError, event: "error", type: "error" }));
          }
        }
      }
    });

    // trigger/emit matching (default edges when no branch mapping exists)
    const emitMap = new Map<string, ChainAgent[]>();
    agents.forEach((agent) => {
      (agent.triggers || []).forEach((trigger) => {
        if (!emitMap.has(trigger)) emitMap.set(trigger, []);
        emitMap.get(trigger)!.push(agent);
      });
    });

    agents.forEach((fromAgent) => {
      if ((branches || {})[fromAgent.emits]) return;
      const toAgents = emitMap.get(fromAgent.emits) || [];
      toAgents.forEach((toAgent) => {
        conns.push({ from: fromAgent.id, to: toAgent.id, event: fromAgent.emits, type: "trigger" });
      });
    });

    // error/timeout from agent props
    agents.forEach((a) => {
      if (a.on_error) conns.push({ from: a.id, to: a.on_error, event: "error", type: "error" });
      if (a.on_timeout) conns.push({ from: a.id, to: a.on_timeout, event: "timeout", type: "timeout" });
    });

    return conns;
  }, [agents, branches]);

  const connections = getConnections();

  const handleMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
    if ((e.target as SVGElement).tagName === "button") return;

    const pos = positions.find((p) => p.id === nodeId);
    if (!pos || !svgRef.current) return;

    const rect = svgRef.current.getBoundingClientRect();
    setDragging(nodeId);
    setDragOffset({
      x: e.clientX - rect.left - pos.x,
      y: e.clientY - rect.top - pos.y,
    });
    setSelectedNode(nodeId);
  }, [positions]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging || !svgRef.current) return;

    const rect = svgRef.current.getBoundingClientRect();
    const newX = e.clientX - rect.left - dragOffset.x;
    const newY = e.clientY - rect.top - dragOffset.y;

    setPositions((prev) =>
      prev.map((p) =>
        p.id === dragging
          ? { ...p, x: Math.max(0, newX), y: Math.max(0, newY) }
          : p
      )
    );
  }, [dragging, dragOffset]);

  const handleMouseUp = useCallback(() => {
    setDragging(null);
  }, []);

  const handleNodeClick = useCallback((nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (connectingFrom) {
      // creating connection
      if (connectingFrom !== nodeId) {
        const fromAgent = agents.find((a) => a.id === connectingFrom);
        const toAgent = agents.find((a) => a.id === nodeId);
        if (fromAgent && toAgent && onEditEdge) {
          onEditEdge(connectingFrom, nodeId, fromAgent.emits);
        }
      }
      setConnectingFrom(null);
    } else {
      setSelectedNode(nodeId);
    }
  }, [connectingFrom, agents, onEditEdge]);

  const handleEdgeClick = useCallback((conn: typeof connections[0], e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedEdge({ from: conn.from, to: conn.to, event: conn.event });
  }, []);

  const startConnecting = useCallback((nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConnectingFrom(nodeId);
    setSelectedNode(null);
    setSelectedEdge(null);
  }, []);

  const deleteSelectedEdge = useCallback(() => {
    if (selectedEdge && onDeleteEdge) {
      onDeleteEdge(selectedEdge.from, selectedEdge.to, selectedEdge.event);
      setSelectedEdge(null);
    }
  }, [selectedEdge, onDeleteEdge]);

  const bgClick = useCallback(() => {
    setSelectedNode(null);
    setSelectedEdge(null);
    setConnectingFrom(null);
  }, []);

  // get node position
  const getPos = (id: string) => positions.find((p) => p.id === id);

  // colors (using theme tokens)
  const colors = {
    nodeBg: "oklch(0.17 0 0)", // bg-card
    nodeBorder: "oklch(0.25 0 0)", // bg-accent
    nodeBorderSelected: "oklch(0.65 0.2 280)",
    nodeBorderConnecting: "oklch(0.65 0.25 30)",
    nodeHeader: "oklch(0.55 0.2 200)",
    edge: "rgba(255, 255, 255, 0.2)",
    edgeSelected: "oklch(0.65 0.2 280)",
    edgeError: "oklch(0.6 0.25 25)",
    edgeTimeout: "oklch(0.6 0.2 280)",
    text: "oklch(0.97 0 0)",
    textMuted: "oklch(0.6 0 0)",
  };

  // get edge color
  const getEdgeColor = (conn: typeof connections[0]) => {
    if (selectedEdge && selectedEdge.from === conn.from && selectedEdge.to === conn.to && selectedEdge.event === conn.event) {
      return colors.edgeSelected;
    }
    if (conn.type === "error") return colors.edgeError;
    if (conn.type === "timeout") return colors.edgeTimeout;
    if (conn.type === "trigger") return "oklch(0.65 0.2 150)";
    return colors.edge;
  };

  // calculate bounds
  const bounds = {
    width: Math.max(800, ...positions.map((p) => p.x + NODE_WIDTH + 100)),
    height: Math.max(600, ...positions.map((p) => p.y + NODE_HEIGHT + 100)),
  };

  return (
    <div className="relative bg-background rounded-md overflow-hidden">
      {/* toolbar */}
      <div className="absolute top-3 left-3 z-10 flex gap-2">
        <Button size="sm" variant="secondary" onClick={onAddAgent} className="bg-muted">
          <Plus className="mr-1 h-3 w-3" /> Add Agent
        </Button>
        {selectedNode && (
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                const agent = agents.find((a) => a.id === selectedNode);
                if (agent) onEditAgent(agent);
              }}
              className="bg-muted"
            >
              <Bot className="mr-1 h-3 w-3" /> Edit
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => startConnecting(selectedNode, { stopPropagation: () => {} } as unknown as React.MouseEvent)}
              className="bg-muted"
            >
              <Link2 className="mr-1 h-3 w-3" /> Connect
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onDeleteAgent(selectedNode)}
              className="bg-muted text-destructive"
            >
              <Trash2 className="mr-1 h-3 w-3" /> Delete
            </Button>
          </>
        )}
        {selectedEdge && (
          <Button
            size="sm"
            variant="secondary"
            onClick={deleteSelectedEdge}
            className="bg-muted text-destructive"
          >
            <Trash2 className="mr-1 h-3 w-3" /> Remove Connection
          </Button>
        )}
        {connectingFrom && (
          <div className="bg-accent text-foreground text-xs px-3 py-1.5 rounded-sm">
            select target agent...
          </div>
        )}
      </div>

      <svg
        ref={svgRef}
        width={bounds.width}
        height={bounds.height}
        className="cursor-grab active:cursor-grabbing"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={bgClick}
      >
        <defs>
          {/* arrow markers */}
          <marker
            id="arrow-default"
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill={colors.edge} />
          </marker>
          <marker
            id="arrow-selected"
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill={colors.edgeSelected} />
          </marker>
          <marker
            id="arrow-error"
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill={colors.edgeError} />
          </marker>
          <marker
            id="arrow-timeout"
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill={colors.edgeTimeout} />
          </marker>
          <marker
            id="arrow-trigger"
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="oklch(0.65 0.2 150)" />
          </marker>
        </defs>

        {/* edges */}
        {connections.map((conn, i) => {
          const fromPos = getPos(conn.from);
          const toPos = getPos(conn.to);
          if (!fromPos || !toPos) return null;

          const fromX = fromPos.x + NODE_WIDTH / 2;
          const fromY = fromPos.y + NODE_HEIGHT;
          const toX = toPos.x + NODE_WIDTH / 2;
          const toY = toPos.y;
          const edgeColor = getEdgeColor(conn);
          const markerId = conn.type === "error" ? "arrow-error" : conn.type === "timeout" ? "arrow-timeout" : conn.type === "trigger" ? "arrow-trigger" : selectedEdge?.from === conn.from && selectedEdge?.to === conn.to ? "arrow-selected" : "arrow-default";

          // bezier curve
          const midY = (fromY + toY) / 2;
          const pathD = `M ${fromX} ${fromY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY}`;

          return (
            <g key={`${conn.from}-${conn.to}-${i}`}>
              {/* invisible wider path for easier clicking */}
              <path
                d={pathD}
                fill="none"
                stroke="transparent"
                strokeWidth="16"
                className="cursor-pointer"
                onClick={(e) => handleEdgeClick(conn, e)}
              />
              {/* visible path */}
              <path
                d={pathD}
                fill="none"
                stroke={edgeColor}
                strokeWidth={conn.type === "branch" ? 2 : conn.type === "error" || conn.type === "timeout" ? 1.5 : 1}
                strokeDasharray={conn.type === "error" || conn.type === "timeout" ? "4,4" : ""}
                markerEnd={`url(#${markerId})`}
                onClick={(e) => handleEdgeClick(conn, e)}
                className={hoverNode && connectingFrom === conn.from ? "opacity-30" : ""}
              />
              {/* label */}
              <text
                x={(fromX + toX) / 2}
                y={midY - 5}
                fill={edgeColor}
                fontSize="9"
                textAnchor="middle"
                className="font-mono pointer-events-none"
                onClick={(e) => handleEdgeClick(conn, e)}
              >
                {conn.event}
              </text>
            </g>
          );
        })}

        {/* connection line being drawn */}
        {connectingFrom && hoverNode && (() => {
          const fromPos = getPos(connectingFrom);
          const toPos = getPos(hoverNode);
          if (!fromPos || !toPos) return null;
          const fromX = fromPos.x + NODE_WIDTH / 2;
          const fromY = fromPos.y + NODE_HEIGHT;
          const toX = toPos.x + NODE_WIDTH / 2;
          const toY = toPos.y;
          const midY = (fromY + toY) / 2;
          return (
            <path
              d={`M ${fromX} ${fromY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY}`}
              fill="none"
              stroke={colors.nodeBorderConnecting}
              strokeWidth="2"
              strokeDasharray="4,4"
            />
          );
        })()}

        {/* nodes */}
        {agents.map((agent) => {
          const pos = getPos(agent.id);
          if (!pos) return null;

          const isSelected = selectedNode === agent.id;
          const isConnecting = connectingFrom === agent.id;
          const isTarget = connectingFrom && hoverNode === agent.id;
          const isStart = (agent.triggers || []).includes("manual-start");

          return (
            <g
              key={agent.id}
              transform={`translate(${pos.x}, ${pos.y})`}
              onMouseDown={(e) => handleMouseDown(e, agent.id)}
              onClick={(e) => handleNodeClick(agent.id, e)}
              onMouseEnter={() => setHoverNode(agent.id)}
              onMouseLeave={() => setHoverNode(null)}
              className="cursor-pointer"
              style={{ cursor: dragging === agent.id ? "grabbing" : "grab" }}
            >
              {/* main bg - flat, no border */}
              <rect
                x="0"
                y="0"
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                rx="6"
                fill={colors.nodeBg}
                stroke={
                  isTarget ? colors.nodeBorderConnecting :
                  isSelected ? colors.nodeBorderSelected :
                  isConnecting ? colors.nodeBorderConnecting :
                  "none"
                }
                strokeWidth={isSelected || isConnecting || isTarget ? "2" : "0"}
              />

              {/* start indicator */}
              {isStart && (
                <circle
                  cx={NODE_WIDTH - 10}
                  cy={14}
                  r="3.5"
                  fill="oklch(0.65 0.2 150)"
                />
              )}

              {/* name */}
              <text
                x={NODE_WIDTH / 2}
                y={22}
                fill={colors.text}
                fontSize="11"
                fontWeight="500"
                textAnchor="middle"
              >
                {agent.name.length > 18 ? agent.name.slice(0, 16) + "..." : agent.name}
              </text>

              {/* id */}
              <text
                x={NODE_WIDTH / 2}
                y={40}
                fill={colors.textMuted}
                fontSize="9"
                textAnchor="middle"
                className="font-mono"
              >
                {agent.id}
              </text>

              {/* emits */}
              <text
                x={NODE_WIDTH / 2}
                y={58}
                fill="oklch(0.65 0.2 150)"
                fontSize="9"
                textAnchor="middle"
                className="font-mono"
              >
                emits: {agent.emits}
              </text>

              {/* timeout indicator */}
              {agent.timeout && (
                <circle
                  cx="10"
                  cy={NODE_HEIGHT - 10}
                  r="3"
                  fill="oklch(0.6 0.2 280)"
                />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
