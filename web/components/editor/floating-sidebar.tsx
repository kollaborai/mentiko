"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { usePillNavPreferences, COLOR_SCHEME_GRADIENTS } from "@/lib/pill-nav-preferences";

// ─── types ──────────────────────────────────────────────────

type SnapSide = "left" | "right";

interface SidebarPosition {
  side: SnapSide;
  offsetY: number; // percent from top (0-100)
}

// ─── constants ──────────────────────────────────────────────

const STORAGE_KEY = "mentiko-sidebar-position";
const COLLAPSED_KEY = "mentiko-sidebar-collapsed";
const EDGE_PULL_THRESHOLD = 300;

function loadPosition(): SidebarPosition {
  if (typeof window === "undefined") return { side: "left", offsetY: 5 };
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return { side: "left", offsetY: 5 };
}

function savePosition(pos: SidebarPosition) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pos)); } catch {}
}

function loadCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try { return localStorage.getItem(COLLAPSED_KEY) === "true"; } catch { return false; }
}

function saveCollapsed(v: boolean) {
  try { localStorage.setItem(COLLAPSED_KEY, String(v)); } catch {}
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

// ─── snap logic (left/right only) ───────────────────────────

function snapToSide(x: number, y: number): SidebarPosition {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const side: SnapSide = x < w / 2 ? "left" : "right";
  const offsetY = clamp((y / h) * 100, 2, 85);
  return { side, offsetY };
}

function getDockedStyle(pos: SidebarPosition): React.CSSProperties {
  if (pos.side === "left") {
    return {
      left: 8,
      top: `${pos.offsetY}%`,
      borderRadius: "12px",
    };
  }
  return {
    right: 8,
    top: `${pos.offsetY}%`,
    borderRadius: "12px",
  };
}

// ─── edge proximity (left/right only) ───────────────────────

function getEdgeProximity(x: number) {
  const w = window.innerWidth;
  const dLeft = x;
  const dRight = w - x;
  const nearest = dLeft < dRight ? "left" : "right";
  const dist = Math.min(dLeft, dRight);
  const pull = dist < EDGE_PULL_THRESHOLD ? 1 - (dist / EDGE_PULL_THRESHOLD) : 0;
  return { side: nearest as SnapSide, pull };
}

// ─── liquid deformation ─────────────────────────────────────

function getLiquidStyle(pull: number, side: SnapSide): React.CSSProperties {
  if (pull === 0) return {};
  const p = pull * pull;
  const stretchX = 1 + p * 0.15;
  const squishY = 1 - p * 0.05;
  const flat = `${Math.round(12 - p * 10)}px`;
  const round = `${Math.round(12 + p * 4)}px`;

  let borderRadius: string;
  if (side === "left") {
    borderRadius = `${flat} ${round} ${round} ${flat}`;
  } else {
    borderRadius = `${round} ${flat} ${flat} ${round}`;
  }

  return {
    borderRadius,
    transform: `scale(${stretchX.toFixed(3)}, ${squishY.toFixed(3)})`,
    filter: pull > 0.8 ? "blur(0.5px) brightness(1.05)" : undefined,
  };
}

// ─── edge glow ──────────────────────────────────────────────

function getEdgeGlowStyle(
  side: SnapSide,
  pull: number,
  dragY: number,
): React.CSSProperties {
  const opacity = pull * 0.5;
  const spread = 60 + pull * 100;
  const thickness = 2 + pull * 4;
  const gradient = "radial-gradient(ellipse at center, rgba(120,200,220,0.4) 0%, rgba(120,200,220,0.1) 40%, transparent 70%)";

  const base: React.CSSProperties = { opacity, position: "fixed", pointerEvents: "none", zIndex: 9998 };

  if (side === "left") {
    return { ...base, left: 0, top: dragY - spread, width: thickness, height: spread * 2, background: gradient };
  }
  return { ...base, right: 0, top: dragY - spread, width: thickness, height: spread * 2, background: gradient };
}

// ─── animated border ────────────────────────────────────────

function ShineBorder() {
  const { prefs } = usePillNavPreferences();
  const colors = COLOR_SCHEME_GRADIENTS[prefs.colorScheme] || COLOR_SCHEME_GRADIENTS.rainbow;
  // build conic gradient from scheme colors with low opacity
  const stops = colors.split(", ").map((c, i, arr) => {
    const alpha = i === 0 || i === arr.length - 1 ? 0.2 : 0.15 - (i * 0.02);
    return `${c}${Math.round(Math.max(alpha, 0.08) * 255).toString(16).padStart(2, "0")}`;
  });
  stops.push(stops[0]); // close the loop
  return (
    <div
      className="absolute inset-0 rounded-xl pointer-events-none z-20"
      style={{
        background: `conic-gradient(from 0deg, ${stops.join(", ")})`,
        mask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
        maskComposite: "exclude",
        WebkitMaskComposite: "xor",
        padding: "1px",
        animation: "sidebarRainbow 8s linear infinite",
      }}
    />
  );
}

// ─── component ──────────────────────────────────────────────

interface FloatingFileSidebarProps {
  children: React.ReactNode;
  width: number;
  collapsed?: boolean;
  onCollapse?: () => void;
  onExpand?: () => void;
  collapsedContent?: React.ReactNode;
}

export function FloatingFileSidebar({
  children,
  width,
  collapsed: externalCollapsed,
  onCollapse,
  onExpand,
  collapsedContent,
}: FloatingFileSidebarProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<SidebarPosition>({ side: "left", offsetY: 5 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [edgeProximity, setEdgeProximityState] = useState<{ side: SnapSide; pull: number }>({ side: "left", pull: 0 });
  const [isSnapping, setIsSnapping] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const dragStart = useRef<{ x: number; y: number; panelLeft: number; panelTop: number } | null>(null);
  const hasMoved = useRef(false);

  const collapsed = externalCollapsed ?? isCollapsed;

  // hydrate from localStorage
  useEffect(() => { setPosition(loadPosition()); }, []);
  useEffect(() => { setIsCollapsed(loadCollapsed()); }, []);

  // ─── drag handlers ────────────────────────────────────────

  const beginDrag = useCallback((clientX: number, clientY: number) => {
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    dragStart.current = {
      x: clientX,
      y: clientY,
      panelLeft: rect.left,
      panelTop: rect.top,
    };
    hasMoved.current = false;
    setIsDragging(true);
    setIsSnapping(false);
  }, []);

  const moveDrag = useCallback((clientX: number, clientY: number) => {
    if (!dragStart.current) return;
    const dx = clientX - dragStart.current.x;
    const dy = clientY - dragStart.current.y;
    if (!hasMoved.current && Math.abs(dx) + Math.abs(dy) < 8) return;
    hasMoved.current = true;
    const newLeft = dragStart.current.panelLeft + dx;
    const newTop = dragStart.current.panelTop + dy;
    setDragPos({ x: newLeft, y: newTop });
    const prox = getEdgeProximity(newLeft + width / 2);
    setEdgeProximityState({ side: prox.side, pull: prox.pull });
  }, [width]);

  const endDrag = useCallback(() => {
    setIsDragging(false);
    if (hasMoved.current && dragPos) {
      const newPos = snapToSide(dragPos.x, dragPos.y);
      setIsSnapping(true);
      setPosition(newPos);
      savePosition(newPos);
      setTimeout(() => {
        setIsSnapping(false);
        setEdgeProximityState({ side: newPos.side, pull: 0 });
      }, 500);
    }
    setDragPos(null);
    dragStart.current = null;
  }, [dragPos]);

  // pointer handlers
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // only drag from the chrome bar, not from content
    if ((e.target as HTMLElement).closest("[data-sidebar-content]")) return;
    if ((e.target as HTMLElement).closest("button")) return;
    if ((e.target as HTMLElement).closest("input")) return;
    e.preventDefault();
    beginDrag(e.clientX, e.clientY);
    try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch {}
  }, [beginDrag]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    moveDrag(e.clientX, e.clientY);
  }, [isDragging, moveDrag]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    endDrag();
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
  }, [isDragging, endDrag]);

  // safety: reset stuck drag after 3s
  useEffect(() => {
    if (!isDragging) return;
    const safety = setTimeout(() => {
      setIsDragging(false);
      setDragPos(null);
      dragStart.current = null;
    }, 3000);
    return () => clearTimeout(safety);
  }, [isDragging]);

  // collapse/expand
  const handleCollapse = useCallback(() => {
    setIsCollapsed(true);
    saveCollapsed(true);
    onCollapse?.();
  }, [onCollapse]);

  const handleExpand = useCallback(() => {
    setIsCollapsed(false);
    saveCollapsed(false);
    onExpand?.();
  }, [onExpand]);

  // ─── style computation ────────────────────────────────────

  const liquidStyle = isDragging ? getLiquidStyle(edgeProximity.pull, edgeProximity.side) : {};

  const style: React.CSSProperties = isDragging && dragPos
    ? {
        position: "fixed",
        left: dragPos.x,
        top: dragPos.y,
        width,
        borderRadius: liquidStyle.borderRadius || "12px",
        transform: liquidStyle.transform,
        filter: liquidStyle.filter,
        zIndex: 9999,
        transition: "border-radius 0.08s ease-out, filter 0.08s ease-out",
        willChange: "left, top, transform",
      }
    : {
        position: "fixed",
        ...getDockedStyle(position),
        width: collapsed ? "auto" : width,
        zIndex: 50,
        transition: isSnapping
          ? "all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)"
          : "all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
      };

  // ─── render ───────────────────────────────────────────────

  if (collapsed) {
    return (
      <div
        ref={panelRef}
        style={style}
        className={cn(
          "flex items-center gap-1.5 px-2.5 py-1.5",
          "bg-transparent backdrop-blur-md cursor-grab",
          isDragging ? "cursor-grabbing shadow-[0_0_20px_rgba(120,200,220,0.1)]" : "shadow-[0_0_0_1px_rgba(255,255,255,0.06)]",
          "touch-manipulation select-none",
        )}
        onClick={handleExpand}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <ShineBorder />
        {collapsedContent}
      </div>
    );
  }

  return (
    <>
      {/* keyframe for rainbow border rotation */}
      <style>{`
        @keyframes sidebarRainbow {
          from { filter: hue-rotate(0deg); }
          to { filter: hue-rotate(360deg); }
        }
      `}</style>

      {/* edge glow while dragging */}
      {isDragging && edgeProximity.pull > 0.2 && dragPos && panelRef.current && (
        <div
          className="fixed pointer-events-none z-[9998]"
          style={{
            ...getEdgeGlowStyle(edgeProximity.side, edgeProximity.pull, dragPos.y + (panelRef.current?.getBoundingClientRect().height ?? 200) / 2),
            transition: "opacity 0.15s ease",
          }}
        />
      )}

      <div
        ref={panelRef}
        style={style}
        className={cn(
          "flex flex-col max-h-[85vh] overflow-hidden",
          "bg-transparent backdrop-blur-md",
          "touch-manipulation",
          isDragging
            ? "cursor-grabbing shadow-[0_0_30px_rgba(120,200,220,0.08)]"
            : "shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_8px_32px_rgba(0,0,0,0.4)]",
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <ShineBorder />

        {/* drag handle / chrome bar */}
        <div className="flex items-center justify-between px-3 py-1.5 shrink-0 cursor-grab active:cursor-grabbing select-none">
          <div className="flex items-center gap-1">
            {/* 3 subtle grip dots */}
            <div className="flex gap-0.5 mr-1.5">
              <span className="w-1 h-1 rounded-full bg-white/10" />
              <span className="w-1 h-1 rounded-full bg-white/10" />
              <span className="w-1 h-1 rounded-full bg-white/10" />
            </div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); handleCollapse(); }}
            className="flex items-center justify-center w-5 h-5 rounded-full text-white/20 hover:text-white/50 hover:bg-white/5 transition-colors"
            title="Collapse to pill"
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><line x1="1" y1="4" x2="7" y2="4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>

        {/* content */}
        <div data-sidebar-content className="flex-1 overflow-y-auto overflow-x-hidden">
          {children}
        </div>
      </div>
    </>
  );
}
