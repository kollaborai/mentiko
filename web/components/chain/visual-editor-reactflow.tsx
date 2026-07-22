"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { AgentPreview } from "./agent-preview";
import { AgentAvatar } from "@/components/agent/agent-avatar";
import {
  AddFilled as Plus,
  TrashFilled as Trash2,
  BotMessageSquare as Bot,
  DangerFilled as AlertTriangle,
  ClockFilled as Clock,
  SmsFilled as Mail,
  Warning2Filled as Bug,
  AddSquareFilled as ZoomIn,
  MinusSquareFilled as ZoomOut,
  MaximizeFilled as FitView,
} from "@aliimam/icons";
import type { ChainAgent, ChainBranch, ParallelBranch } from "./chain-flow-graph";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface VisualChainEditorProps {
  agents: ChainAgent[];
  branches?: ChainBranch;
  parallelBranches?: Record<string, ParallelBranch>;
  onAddAgent: () => void;
  onDeleteAgent: (id: string) => void;
  onEditAgent: (agent: ChainAgent) => void;
  onEditEdge?: (fromId: string, toId: string, event: string) => void;
  onDeleteEdge?: (fromId: string, toId: string, event: string) => void;
  readOnly?: boolean;
  previewMode?: boolean;
  debugMode?: boolean;
  breakpoints?: Set<string>;
  onToggleBreakpoint?: (agentId: string) => void;
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface NodeLayout {
  id: string;
  x: number;
  y: number;
  agent: ChainAgent;
}

interface EdgeLayout {
  id: string;
  fromId: string;
  toId: string;
  event: string;
  edgeType: "branch" | "trigger" | "error" | "timeout" | "fanout" | "fanin";
}

interface BranchTarget {
  fan_out?: string[];
  fan_in?: string;
  on_error?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const NODE_WIDTH = 300;
const NODE_HEIGHT = 185;
const H_GAP = 420;
const V_GAP = 220;
// arrowhead length (user units). the stroke ends this far short of the target
// so the marker's tip lands on the card edge and the line meets its fat base.
const ARROWHEAD_LEN = 12;

function getNodeMetrics(previewMode: boolean) {
  return {
    nodeWidth: previewMode ? 260 : NODE_WIDTH,
    nodeHeight: previewMode ? 150 : NODE_HEIGHT,
    hGap: previewMode ? 340 : H_GAP,
    vGap: previewMode ? 170 : V_GAP,
  };
}

const EDGE_COLORS = {
  branch:  "#22c55e",
  trigger: "#22c55e",
  fanout:  "#22c55e",
  fanin:   "#22c55e",
  error:   "#ef4444",
  timeout: "#a855f7",
};

// ─── Layout ───────────────────────────────────────────────────────────────────

function computeLayout(agents: ChainAgent[], previewMode = false): NodeLayout[] {
  const { hGap, vGap } = getNodeMetrics(previewMode);
  const triggerMap = new Map<string, ChainAgent[]>();
  agents.forEach((a) => {
    (a.triggers || []).forEach((t) => {
      if (t === "manual-start") return;
      if (!triggerMap.has(t)) triggerMap.set(t, []);
      triggerMap.get(t)!.push(a);
    });
  });

  const levels: ChainAgent[][] = [];
  const placed = new Set<string>();

  const emittedEvents = new Set(agents.map((a) => a.emits).filter(Boolean));
  const entryAgents = agents.filter((a) => {
    const triggers = a.triggers || [];
    return (
      triggers.includes("manual-start") ||
      triggers.includes("chain-started") ||
      triggers.includes("chain_start") ||
      triggers.every((trigger) => !emittedEvents.has(trigger))
    );
  });
  const fallbackEntryAgents = entryAgents.length > 0 ? entryAgents : agents.slice(0, 1);
  const bfsQueue: { agent: ChainAgent; level: number }[] = fallbackEntryAgents.map((a) => ({ agent: a, level: 0 }));

  while (bfsQueue.length > 0) {
    const { agent, level } = bfsQueue.shift()!;
    if (placed.has(agent.id)) continue;
    placed.add(agent.id);
    if (!levels[level]) levels[level] = [];
    levels[level].push(agent);
    const next = triggerMap.get(agent.emits) || [];
    next.forEach((n) => {
      if (!placed.has(n.id)) bfsQueue.push({ agent: n, level: level + 1 });
    });
  }

  // orphans go to level 0
  agents.forEach((a) => {
    if (!placed.has(a.id)) {
      if (!levels[0]) levels[0] = [];
      levels[0].push(a);
    }
  });

  const nodes: NodeLayout[] = [];
  levels.forEach((levelAgents, levelIdx) => {
    const levelHeight = (levelAgents.length - 1) * vGap;
    const startY = -levelHeight / 2;
    levelAgents.forEach((a, idx) => {
      nodes.push({
        id: a.id,
        x: levelIdx * hGap,
        y: startY + idx * vGap,
        agent: a,
      });
    });
  });

  return nodes;
}

function computeEdges(agents: ChainAgent[], branches?: ChainBranch): EdgeLayout[] {
  const edges: EdgeLayout[] = [];

  const emitMap = new Map<string, ChainAgent[]>();
  agents.forEach((a) => {
    (a.triggers || []).forEach((t) => {
      if (!emitMap.has(t)) emitMap.set(t, []);
      emitMap.get(t)!.push(a);
    });
  });

  // branch-mapped edges
  Object.entries(branches || {}).forEach(([event, target]) => {
    const from = agents.find((a) => a.emits === event);
    if (!from) return;

    if (typeof target === "string") {
      edges.push({ id: `${from.id}-${target}-${event}`, fromId: from.id, toId: target, event, edgeType: "branch" });
    } else if (Array.isArray(target)) {
      if (target.length > 1) {
        target.forEach((t) => {
          edges.push({ id: `${from.id}-${t}-${event}`, fromId: from.id, toId: t, event, edgeType: "fanout" });
        });
      } else if (target.length === 1) {
        edges.push({ id: `${from.id}-${target[0]}-${event}`, fromId: from.id, toId: target[0], event, edgeType: "branch" });
      }
    } else if (typeof target === "object" && target !== null) {
      const bt = target as BranchTarget;
      if (bt.fan_out) {
        bt.fan_out.forEach((t) => {
          edges.push({ id: `${from.id}-${t}-${event}-fo`, fromId: from.id, toId: t, event, edgeType: "fanout" });
        });
        if (bt.fan_in) {
          bt.fan_out.forEach((t) => {
            edges.push({ id: `${t}-${bt.fan_in}-fanin`, fromId: t, toId: bt.fan_in!, event: "fan-in", edgeType: "fanin" });
          });
        }
        if (bt.on_error) {
          bt.fan_out.forEach((t) => {
            edges.push({ id: `${t}-${bt.on_error}-error`, fromId: t, toId: bt.on_error!, event: "error", edgeType: "error" });
          });
        }
      }
    }
  });

  // trigger/emit default edges (skip if already branch-mapped)
  const branchEvents = new Set(Object.keys(branches || {}));
  agents.forEach((from) => {
    if (branchEvents.has(from.emits)) return;
    const toAgents = emitMap.get(from.emits) || [];
    toAgents.forEach((to) => {
      edges.push({ id: `${from.id}-${to.id}-${from.emits}`, fromId: from.id, toId: to.id, event: from.emits, edgeType: "trigger" });
    });
  });

  // per-agent error/timeout
  agents.forEach((a) => {
    if (a.on_error) {
      edges.push({ id: `${a.id}-${a.on_error}-onerror`, fromId: a.id, toId: a.on_error, event: "error", edgeType: "error" });
    }
    if (a.on_timeout) {
      edges.push({ id: `${a.id}-${a.on_timeout}-ontimeout`, fromId: a.id, toId: a.on_timeout, event: "timeout", edgeType: "timeout" });
    }
  });

  return edges;
}

// ─── SVG edge renderer ────────────────────────────────────────────────────────

function bezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}

interface EdgeSvgProps {
  edges: EdgeLayout[];
  nodeMap: Map<string, NodeLayout>;
  nodeWidth: number;
  nodeHeight: number;
  selectedEdge: string | null;
  onEdgeClick: (id: string, e: React.MouseEvent) => void;
  readOnly?: boolean;
}

// flowing packet dots that travel along an edge path (source → target).
// comet trail: a bright lead dot with two dimmer, smaller trailing dots.
// colored by the edge so each edge type keeps its palette.
function FlowDots({ path, color }: { path: string; color: string }) {
  const DUR = 1.6; // seconds for one source→target traversal
  const trail = [
    { r: 2.4, opacity: 1, begin: 0 },
    { r: 1.7, opacity: 0.55, begin: 0.3 },
    { r: 1.1, opacity: 0.28, begin: 0.6 },
  ];
  return (
    <>
      {trail.map((dot, i) => (
        <circle key={i} r={dot.r} fill={color} opacity={dot.opacity} style={{ pointerEvents: "none" }}>
          <animateMotion dur={`${DUR}s`} repeatCount="indefinite" begin={`${dot.begin}s`} path={path} />
        </circle>
      ))}
    </>
  );
}

function EdgeLayer({
  edges,
  nodeMap,
  nodeWidth,
  nodeHeight,
  selectedEdge,
  onEdgeClick,
  readOnly,
}: EdgeSvgProps) {
  // Group edges by the node they attach to so a fan-out / fan-in spreads its
  // anchor points along the card edge instead of stacking them all on one
  // center point. Sort each group by the other endpoint's y so lines don't cross.
  const outByNode = new Map<string, EdgeLayout[]>();
  const inByNode = new Map<string, EdgeLayout[]>();
  for (const e of edges) {
    if (!nodeMap.has(e.fromId) || !nodeMap.has(e.toId)) continue;
    (outByNode.get(e.fromId) ?? outByNode.set(e.fromId, []).get(e.fromId)!).push(e);
    (inByNode.get(e.toId) ?? inByNode.set(e.toId, []).get(e.toId)!).push(e);
  }
  outByNode.forEach((list) => list.sort((a, b) => (nodeMap.get(a.toId)?.y ?? 0) - (nodeMap.get(b.toId)?.y ?? 0)));
  inByNode.forEach((list) => list.sort((a, b) => (nodeMap.get(a.fromId)?.y ?? 0) - (nodeMap.get(b.fromId)?.y ?? 0)));
  // one edge → dead center (unchanged); K edges → evenly spread, off the corners
  const anchorY = (top: number, count: number, index: number) => top + nodeHeight * (index + 1) / (count + 1);

  return (
    <>
      <defs>
        {(["branch", "trigger", "fanout", "fanin", "error", "timeout", "selected"] as const).map((type) => {
          const color = type === "selected" ? "#a855f7" : EDGE_COLORS[type as keyof typeof EDGE_COLORS] ?? EDGE_COLORS.branch;
          return (
            <marker
              key={type}
              id={`arrow-${type}`}
              viewBox="0 0 12 10"
              markerWidth="12"
              markerHeight="10"
              refX="0"
              refY="5"
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              {/* refX=0 puts the fat base center at the line end, so the line
                  meets the arrowhead at any approach angle (no detached gap) */}
              <path d="M0,0 L12,5 L0,10 Z" fill={color} />
            </marker>
          );
        })}
      </defs>

      {edges.map((edge) => {
        const from = nodeMap.get(edge.fromId);
        const to = nodeMap.get(edge.toId);
        if (!from || !to) return null;

        const isSelected = selectedEdge === edge.id;
        const color = isSelected ? "#a855f7" : EDGE_COLORS[edge.edgeType];
        const markerId = isSelected ? "arrow-selected" : `arrow-${edge.edgeType}`;
        const isError = edge.edgeType === "error";
        const isTimeout = edge.edgeType === "timeout";
        const isDashed = isError || isTimeout;
        const isAnimated = !isDashed && (edge.edgeType === "branch" || edge.edgeType === "trigger" || edge.edgeType === "fanout" || edge.edgeType === "fanin");

        // spread anchors along the source right edge / target left edge so
        // fan-outs and fan-ins attach at distinct points rather than one center
        const outList = outByNode.get(edge.fromId)!;
        const inList = inByNode.get(edge.toId)!;
        const x1 = from.x + nodeWidth;
        const y1 = anchorY(from.y, outList.length, outList.indexOf(edge));
        const x2 = to.x;
        const y2 = anchorY(to.y, inList.length, inList.indexOf(edge));

        const labelX = (x1 + x2) / 2;
        const labelY = (y1 + y2) / 2 - 12;

        // end the stroke one arrowhead-length short of the target so the marker
        // tip lands on the card edge and the line meets the arrowhead's fat base
        const d = bezierPath(x1, y1, x2 - ARROWHEAD_LEN, y2);

        return (
          <g key={edge.id}>
            {/* fat invisible hit zone — pointer-events:stroke so transparent stroke is still clickable */}
            {!readOnly && (
              <path
                d={d}
                fill="none"
                stroke="transparent"
                strokeWidth="16"
                style={{ pointerEvents: "stroke", cursor: "pointer" }}
                onClick={(e) => onEdgeClick(edge.id, e)}
              />
            )}
            {/* main visible path */}
            <path
              d={d}
              fill="none"
              stroke={color}
              strokeWidth={isSelected ? 2.5 : isDashed ? 1.5 : 2}
              strokeDasharray={isDashed ? "5,5" : ""}
              markerEnd={`url(#${markerId})`}
              onClick={!readOnly ? (e) => onEdgeClick(edge.id, e) : undefined}
              style={{
                cursor: readOnly ? "default" : "pointer",
                pointerEvents: readOnly ? "none" : "stroke",
              }}
            />
            {/* flowing packet dots along the line (branch flow) */}
            {isAnimated && <FlowDots path={d} color={color} />}
            {/* label */}
            <text
              x={labelX}
              y={labelY}
              fill={color}
              fontSize="9"
              textAnchor="middle"
              dominantBaseline="middle"
              style={{ fontFamily: "monospace", pointerEvents: "none", fillOpacity: 0.8 }}
            >
              {edge.event}
            </text>
          </g>
        );
      })}
    </>
  );
}

// ─── Agent node card ──────────────────────────────────────────────────────────

interface AgentNodeProps {
  node: NodeLayout;
  nodeWidth: number;
  nodeHeight: number;
  selected: boolean;
  dragging: boolean;
  hasBreakpoint: boolean;
  debugMode: boolean;
  readOnly: boolean;
  previewMode: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onClick: (e: React.MouseEvent) => void;
  onToggleBreakpoint?: () => void;
}

function AgentNode({
  node,
  nodeWidth,
  nodeHeight,
  selected,
  dragging,
  hasBreakpoint,
  debugMode,
  readOnly,
  previewMode,
  onMouseDown,
  onDoubleClick,
  onClick,
  onToggleBreakpoint,
}: AgentNodeProps) {
  const { agent } = node;
  const isStart = (agent.triggers || []).includes("manual-start");
  const hasTimeout = (agent.timeout ?? 0) > 0;
  const hasError = agent.on_error != null;
  const hasEmailTrigger = (agent.triggers || []).some((t) => t.startsWith("email:"));
  const maxRetries = agent.retry?.max_retries ?? 0;
  const hasRetry = maxRetries > 0;
  const primaryTrigger = agent.triggers?.[0];

  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            data-node-id={node.id}
            style={{
              position: "absolute",
              left: node.x,
              top: node.y,
              width: nodeWidth,
              minHeight: nodeHeight,
              cursor: readOnly ? "default" : dragging ? "grabbing" : "grab",
              userSelect: "none",
            }}
            className={[
              previewMode ? "px-3 py-2.5" : "px-4 py-3",
              "rounded-md transition-colors duration-150",
              "bg-card border border-border/50",
              selected ? "ring-2 ring-purple-500" : "hover:bg-muted",
              hasBreakpoint ? "ring-1 ring-red-500/30" : "",
            ].join(" ")}
            onMouseDown={readOnly ? undefined : onMouseDown}
            onDoubleClick={readOnly ? undefined : onDoubleClick}
            onClick={onClick}
          >
            {/* email badge */}
            {hasEmailTrigger && (
              <div className="absolute top-0 right-0 -mt-1 -mr-1 bg-muted text-foreground/60 p-1 rounded-full">
                <Mail className="h-3 w-3" />
              </div>
            )}

            {/* retry badge */}
            {hasRetry && (
              <div className="absolute top-0 right-0 bg-orange-500/80 text-white text-[9px] rounded-full w-4 h-4 flex items-center justify-center font-medium">
                {maxRetries}
              </div>
            )}

            {/* breakpoint dot */}
            {debugMode && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onToggleBreakpoint?.(); }}
                className={[
                  "absolute top-1 right-1 w-3.5 h-3.5 rounded-full transition-all",
                  hasBreakpoint
                    ? "bg-red-500 ring-2 ring-red-500/50"
                    : "bg-transparent hover:bg-red-500/30 border border-red-500/30",
                ].join(" ")}
                title={hasBreakpoint ? "Remove breakpoint" : "Set breakpoint"}
              >
                {hasBreakpoint && <Bug className="h-2 w-2 text-white/90 m-0.5" />}
              </button>
            )}

            {/* header */}
            <div className={previewMode ? "mb-1.5 flex items-start justify-between gap-2" : "mb-2 flex items-start justify-between gap-3"}>
              <div className="flex min-w-0 items-center gap-2">
                <AgentAvatar seed={agent.id} size={previewMode ? 14 : 16} className="shrink-0" />
                <span className={`${previewMode ? "text-[12px]" : "text-sm"} truncate font-semibold text-foreground`}>
                  {agent.name}
                </span>
              </div>
              {isStart && (
                <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              )}
            </div>

            {/* id */}
            <div className={`${previewMode ? "mb-1.5" : "mb-2"} truncate font-mono text-[10px] text-muted-foreground/60`}>
              {agent.id}
            </div>

            {/* role */}
            {agent.role && (
              <div className={`${previewMode ? "mb-1.5 h-7 text-[10px] leading-3" : "mb-2 h-9 text-[11px] leading-4"} line-clamp-2 text-muted-foreground`}>
                {agent.role}
              </div>
            )}

            {/* events */}
            <div className="space-y-1">
              <div className="grid grid-cols-[24px_minmax(0,1fr)] items-center gap-2 text-[10px]">
                <span className="text-muted-foreground/50">in</span>
                {primaryTrigger ? (
                  <span className="truncate text-blue-400 font-mono flex items-center gap-1">
                    {primaryTrigger.startsWith("email:") && <Mail className="h-2.5 w-2.5 shrink-0" />}
                    {primaryTrigger}
                  </span>
                ) : (
                  <span className="text-muted-foreground/30">—</span>
                )}
              </div>
              <div className="grid grid-cols-[24px_minmax(0,1fr)] items-center gap-2 text-[10px]">
                <span className="text-muted-foreground/50">out</span>
                <span className={agent.emits ? "truncate text-green-400 font-mono" : "text-muted-foreground/30"}>
                  {agent.emits || "—"}
                </span>
              </div>
            </div>

            {/* status indicators */}
            {(hasTimeout || hasError) && (
              <div className="flex items-center gap-2 mt-2 pt-2">
                {hasTimeout && (
                  <div className="flex items-center gap-1 text-[10px] text-purple-400">
                    <Clock className="h-3 w-3" />
                    {agent.timeout}s
                  </div>
                )}
                {hasError && (
                  <div className="flex items-center gap-1 text-[10px] text-red-400">
                    <AlertTriangle className="h-3 w-3" />
                    error
                  </div>
                )}
              </div>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="right" className="p-3 bg-card">
          <AgentPreview
            id={agent.id}
            name={agent.name}
            role={agent.role}
            description={agent.description}
            triggers={agent.triggers}
            emits={agent.emits}
            timeout={agent.timeout}
            retry={agent.retry}
          />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ─── Main editor ──────────────────────────────────────────────────────────────

export function VisualChainEditor({
  agents: rawAgents,
  branches,
  parallelBranches: _parallelBranches,
  onAddAgent,
  onDeleteAgent,
  onEditAgent,
  onEditEdge: _onEditEdge,
  onDeleteEdge,
  readOnly = false,
  previewMode = false,
  debugMode = false,
  breakpoints = new Set<string>(),
  onToggleBreakpoint,
}: VisualChainEditorProps) {
  // normalize agent ids
  const agents = useMemo(() =>
    rawAgents.map((a, i) => a.id ? a : { ...a, id: a.name?.toLowerCase().replace(/\s+/g, "-") || `agent-${i}` }),
    [rawAgents]
  );
  const { nodeWidth, nodeHeight } = useMemo(() => getNodeMetrics(previewMode), [previewMode]);

  // initial layout + overrides from dragging
  const initialNodes = useMemo(() => computeLayout(agents, previewMode), [agents, previewMode]);
  const [nodeOverrides, setNodeOverrides] = useState<Map<string, { x: number; y: number }>>(new Map());

  // when agents change, clear overrides for removed agents
  useEffect(() => {
    const ids = new Set(agents.map((a) => a.id));
    setNodeOverrides((prev) => {
      const next = new Map(prev);
      let changed = false;
      for (const k of next.keys()) {
        if (!ids.has(k)) { next.delete(k); changed = true; }
      }
      return changed ? next : prev;
    });
  }, [agents]);

  const nodes = useMemo<NodeLayout[]>(() =>
    initialNodes.map((n) => {
      const ov = nodeOverrides.get(n.id);
      return ov ? { ...n, ...ov } : n;
    }),
    [initialNodes, nodeOverrides]
  );

  const nodeMap = useMemo(() => {
    const m = new Map<string, NodeLayout>();
    nodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [nodes]);

  const edges = useMemo(() => computeEdges(agents, branches), [agents, branches]);

  // canvas transform: pan + zoom
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // fit to view on initial mount or when agents change
  // use a short delay so the container has real dimensions inside tab panels
  const didFit = useRef(false);
  useEffect(() => {
    if (nodes.length === 0) return;
    const timer = setTimeout(() => {
      if (!containerRef.current) return;
      const container = containerRef.current;
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      if (cw === 0 || ch === 0) return;

      const xs = nodes.map((n) => n.x);
      const ys = nodes.map((n) => n.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs) + nodeWidth;
      const maxY = Math.max(...ys) + nodeHeight;
      const graphW = maxX - minX;
      const graphH = maxY - minY;

      const padding = previewMode ? 32 : 72;
      const scaleX = (cw - padding * 2) / Math.max(graphW, 1);
      const scaleY = (ch - padding * 2) / Math.max(graphH, 1);
      const minScale = previewMode ? 0.58 : 0.45;
      const maxScale = previewMode ? 1.05 : 1;
      const clampedScale = Math.max(minScale, Math.min(maxScale, Math.min(scaleX, scaleY)));

      const scaledW = graphW * clampedScale;
      const scaledH = graphH * clampedScale;
      const px = previewMode
        ? padding - minX * clampedScale
        : (cw - scaledW) / 2 - minX * clampedScale;
      const py = (ch - scaledH) / 2 - minY * clampedScale;

      setScale(clampedScale);
      setPan({ x: px, y: py });
      didFit.current = true;
    }, 80);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents.length, previewMode, nodeWidth, nodeHeight]);

  // compute SVG canvas size (enough to cover all nodes + some margin)
  const svgSize = useMemo(() => {
    if (nodes.length === 0) return { w: 2000, h: 2000 };
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const w = Math.max(...xs) + nodeWidth + 400;
    const h = Math.max(...ys) + nodeHeight + 400;
    return {
      w: Math.max(w - Math.min(...xs) + 400, 2000),
      h: Math.max(h - Math.min(...ys) + 400, 2000),
    };
  }, [nodes, nodeWidth, nodeHeight]);

  // selection
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  // drag state
  const draggingRef = useRef<{ nodeId: string; startMouseX: number; startMouseY: number; startNodeX: number; startNodeY: number } | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);

  // pan state
  const panningRef = useRef<{ startMouseX: number; startMouseY: number; startPanX: number; startPanY: number } | null>(null);

  const fitToView = useCallback(() => {
    if (!containerRef.current || nodes.length === 0) return;
    const container = containerRef.current;
    const cw = container.clientWidth;
    const ch = container.clientHeight;

    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs) + nodeWidth;
    const maxY = Math.max(...ys) + nodeHeight;
    const graphW = maxX - minX;
    const graphH = maxY - minY;

    const padding = previewMode ? 32 : 72;
    const scaleX = (cw - padding * 2) / Math.max(graphW, 1);
    const scaleY = (ch - padding * 2) / Math.max(graphH, 1);
    const minScale = previewMode ? 0.58 : 0.45;
    const maxScale = previewMode ? 1.05 : 1;
    const clampedScale = Math.max(minScale, Math.min(maxScale, Math.min(scaleX, scaleY)));
    const scaledW = graphW * clampedScale;
    const scaledH = graphH * clampedScale;
    const px = previewMode
      ? padding - minX * clampedScale
      : (cw - scaledW) / 2 - minX * clampedScale;
    const py = (ch - scaledH) / 2 - minY * clampedScale;

    setScale(clampedScale);
    setPan({ x: px, y: py });
  }, [nodes, previewMode, nodeWidth, nodeHeight]);

  // wheel zoom (cursor-anchored). Plain scroll should move the page/panel,
  // not mutate the graph reference view by accident.
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    setScale((prev) => {
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const next = Math.max(0.3, Math.min(2, prev * delta));
      setPan((pp) => ({
        x: mouseX - (mouseX - pp.x) * (next / prev),
        y: mouseY - (mouseY - pp.y) * (next / prev),
      }));
      return next;
    });
  }, []);

  // canvas pointer events
  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-node-id]")) return;
    if (e.button !== 0) return;
    panningRef.current = {
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startPanX: pan.x,
      startPanY: pan.y,
    };
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (draggingRef.current) {
      const { nodeId, startMouseX, startMouseY, startNodeX, startNodeY } = draggingRef.current;
      const dx = (e.clientX - startMouseX) / scale;
      const dy = (e.clientY - startMouseY) / scale;
      setNodeOverrides((prev) => {
        const next = new Map(prev);
        next.set(nodeId, { x: startNodeX + dx, y: startNodeY + dy });
        return next;
      });
    } else if (panningRef.current) {
      const { startMouseX, startMouseY, startPanX, startPanY } = panningRef.current;
      setPan({
        x: startPanX + (e.clientX - startMouseX),
        y: startPanY + (e.clientY - startMouseY),
      });
    }
  }, [scale]);

  const handleMouseUp = useCallback(() => {
    draggingRef.current = null;
    setDraggingNodeId(null);
    panningRef.current = null;
  }, []);

  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-node-id]")) return;
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, []);

  const handleNodeMouseDown = useCallback((nodeId: string, e: React.MouseEvent) => {
    if (readOnly) return;
    e.stopPropagation();
    const node = nodeMap.get(nodeId);
    if (!node) return;
    draggingRef.current = {
      nodeId,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startNodeX: node.x,
      startNodeY: node.y,
    };
    setDraggingNodeId(nodeId);
  }, [readOnly, nodeMap]);

  const handleNodeClick = useCallback((nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
  }, []);

  const handleEdgeClick = useCallback((edgeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedEdgeId(edgeId);
    setSelectedNodeId(null);
  }, []);

  // delete key
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (readOnly) return;
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    const active = document.activeElement;
    if (active?.tagName === "INPUT" || active?.tagName === "TEXTAREA") return;

    if (selectedNodeId) {
      onDeleteAgent(selectedNodeId);
      setSelectedNodeId(null);
    }
    if (selectedEdgeId && onDeleteEdge) {
      const edge = edges.find((ed) => ed.id === selectedEdgeId);
      if (edge) onDeleteEdge(edge.fromId, edge.toId, edge.event);
      setSelectedEdgeId(null);
    }
  }, [readOnly, selectedNodeId, selectedEdgeId, edges, onDeleteAgent, onDeleteEdge]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const editSelectedNode = useCallback(() => {
    if (!selectedNodeId) return;
    const agent = agents.find((a) => a.id === selectedNodeId);
    if (agent) onEditAgent(agent);
  }, [selectedNodeId, agents, onEditAgent]);

  const deleteSelectedEdge = useCallback(() => {
    if (!selectedEdgeId || !onDeleteEdge) return;
    const edge = edges.find((ed) => ed.id === selectedEdgeId);
    if (edge) onDeleteEdge(edge.fromId, edge.toId, edge.event);
    setSelectedEdgeId(null);
  }, [selectedEdgeId, edges, onDeleteEdge]);

  // determine canvas cursor
  const canvasCursor = panningRef.current ? "grabbing" : "grab";

  return (
    <div className="h-full w-full relative overflow-hidden bg-background" ref={containerRef}>
      {/* top toolbar */}
      {!readOnly && (
        <div className="absolute top-4 left-4 z-10 flex gap-2">
          <Button size="sm" variant="secondary" onClick={onAddAgent} className="bg-card">
            <Plus className="mr-1 h-3 w-3" /> Add Agent
          </Button>

          {selectedNodeId && (
            <>
              <Button size="sm" variant="secondary" onClick={editSelectedNode} className="bg-card">
                <Bot className="mr-1 h-3 w-3" /> Edit
              </Button>
              <Button size="sm" variant="secondary" onClick={() => { onDeleteAgent(selectedNodeId); setSelectedNodeId(null); }} className="bg-card text-red-400">
                <Trash2 className="mr-1 h-3 w-3" /> Delete
              </Button>
            </>
          )}

          {selectedEdgeId && (
            <Button size="sm" variant="secondary" onClick={deleteSelectedEdge} className="bg-card text-red-400">
              <Trash2 className="mr-1 h-3 w-3" /> Remove Connection
            </Button>
          )}
        </div>
      )}

      {/* bottom-left zoom controls */}
      <div className="absolute bottom-4 left-4 z-10 flex gap-1">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 bg-card"
          onClick={() => setScale((s) => Math.min(2, s * 1.2))}
          title="Zoom in"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 bg-card"
          onClick={() => setScale((s) => Math.max(0.3, s * 0.833))}
          title="Zoom out"
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 bg-card"
          onClick={fitToView}
          title="Fit to view"
        >
          <FitView className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* hint */}
      {!readOnly && (
        <div className="absolute bottom-4 right-4 z-10 hidden md:block text-[10px] text-foreground/40 bg-card px-2 py-1 rounded pointer-events-none">
          drag to move · cmd/ctrl scroll to zoom · click to select · del to remove
        </div>
      )}

      {/* canvas */}
      <div
        style={{ cursor: canvasCursor, width: "100%", height: "100%", position: "relative" }}
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={handleCanvasClick}
        onWheel={handleWheel}
      >
        {/* transform group */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            transformOrigin: "0 0",
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
            width: svgSize.w,
            height: svgSize.h,
          }}
        >
          {/* dot grid background */}
          <svg
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
          >
            <defs>
              <pattern id="mentiko-dots" x="0" y="0" width="16" height="16" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="1" fill="currentColor" className="text-border/30" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#mentiko-dots)" />
          </svg>

          {/* SVG edge layer — parent is none so empty space stays pannable;
              individual hit paths restore pointer-events: stroke */}
          <svg
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" }}
          >
            <EdgeLayer
              edges={edges}
              nodeMap={nodeMap}
              nodeWidth={nodeWidth}
              nodeHeight={nodeHeight}
              selectedEdge={selectedEdgeId}
              onEdgeClick={handleEdgeClick}
              readOnly={readOnly}
            />
          </svg>

          {/* node divs */}
          {nodes.map((node) => (
            <AgentNode
              key={node.id}
              node={node}
              nodeWidth={nodeWidth}
              nodeHeight={nodeHeight}
              selected={selectedNodeId === node.id}
              dragging={draggingNodeId === node.id}
              hasBreakpoint={debugMode && breakpoints.has(node.id)}
              debugMode={debugMode}
              readOnly={readOnly}
              previewMode={previewMode}
              onMouseDown={(e) => handleNodeMouseDown(node.id, e)}
              onDoubleClick={() => onEditAgent(node.agent)}
              onClick={(e) => handleNodeClick(node.id, e)}
              onToggleBreakpoint={onToggleBreakpoint ? () => onToggleBreakpoint(node.id) : undefined}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
