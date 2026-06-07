"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AttachCircleFilled,
  CloseCircleFilled,
  MaximizeFilled,
  RouteSquareFilled,
} from "@aliimam/icons";
import { cn } from "@/lib/utils";
import { FLOATING_SURFACE_Z } from "@/lib/ui/floating-surface-z";
import { PANEL_MODE_BACKGROUND_LAYERS } from "@/components/app-shell/panel-mode-background";
import {
  OPEN_FLOATING_APP_PANEL_EVENT,
  getFloatingPanelSrc,
  isFloatingPanelRoute,
  type FloatingAppPanelRequest,
} from "@/lib/ui/floating-app-panel-routing";

interface PanelGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface FloatingAppPanelState extends FloatingAppPanelRequest {
  id: string;
  src: string;
  geo: PanelGeometry;
  isPinned: boolean;
  zIndex: number;
}

const GEO_KEY = "floating-app-panel-geometry";
const PINNED_KEY = "floating-app-panel-pinned";
const DEFAULT_GEO: PanelGeometry = { x: -1, y: -1, w: 1120, h: 720 };
const MIN_W = 480;
const MIN_H = 320;
const MOBILE_BREAKPOINT = 640;
const PANEL_OFFSET = 28;
const PANEL_VISIBLE_OPACITY = 1;
const MONO_PANEL_SHINE_COLORS =
  "rgba(255,255,255,0.16), rgba(255,255,255,0.5), rgba(255,255,255,0.18)";
const DESKTOP_PATTERN_STYLE: React.CSSProperties = {
  backgroundColor: "#010101",
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function sanitizeGeo(input: Partial<PanelGeometry>): PanelGeometry {
  const viewportW = typeof window === "undefined" ? DEFAULT_GEO.w + 128 : window.innerWidth;
  const viewportH = typeof window === "undefined" ? DEFAULT_GEO.h + 128 : window.innerHeight;
  const maxW = Math.max(MIN_W, viewportW - 32);
  const maxH = Math.max(MIN_H, viewportH - 32);
  const w = Number.isFinite(input.w)
    ? clamp(input.w as number, MIN_W, maxW)
    : Math.min(DEFAULT_GEO.w, maxW);
  const h = Number.isFinite(input.h)
    ? clamp(input.h as number, MIN_H, maxH)
    : Math.min(DEFAULT_GEO.h, maxH);
  const maxX = Math.max(16, viewportW - w - 16);
  const maxY = Math.max(16, viewportH - h - 16);

  return {
    x: Number.isFinite(input.x) && (input.x as number) >= 0 ? clamp(input.x as number, 16, maxX) : DEFAULT_GEO.x,
    y: Number.isFinite(input.y) && (input.y as number) >= 0 ? clamp(input.y as number, 16, maxY) : DEFAULT_GEO.y,
    w,
    h,
  };
}

function clampLiveGeo(input: PanelGeometry): PanelGeometry {
  const next = sanitizeGeo(input);
  return {
    ...next,
    x: next.x < 0 ? 16 : next.x,
    y: next.y < 0 ? 16 : next.y,
  };
}

function loadGeo(): PanelGeometry {
  if (typeof window === "undefined") return DEFAULT_GEO;
  try {
    const stored = localStorage.getItem(GEO_KEY);
    return stored ? sanitizeGeo({ ...DEFAULT_GEO, ...JSON.parse(stored) }) : DEFAULT_GEO;
  } catch {
    return DEFAULT_GEO;
  }
}

function saveGeo(geo: PanelGeometry) {
  try {
    localStorage.setItem(GEO_KEY, JSON.stringify(geo));
  } catch {
    // ignore disabled storage
  }
}

function loadPinned() {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(PINNED_KEY) === "true";
  } catch {
    return false;
  }
}

function savePinned(pinned: boolean) {
  try {
    localStorage.setItem(PINNED_KEY, String(pinned));
  } catch {
    // ignore disabled storage
  }
}

function createInitialGeo(openPanelCount: number) {
  const stored = loadGeo();
  const offset = (openPanelCount % 8) * PANEL_OFFSET;
  const base = stored.x < 0 || stored.y < 0
    ? { x: 64, y: 64, w: DEFAULT_GEO.w, h: DEFAULT_GEO.h }
    : stored;

  return clampLiveGeo({
    ...base,
    x: base.x + offset,
    y: base.y + offset,
  });
}

export function FloatingAppPanels() {
  const [panels, setPanels] = useState<FloatingAppPanelState[]>([]);
  const [isMobile, setIsMobile] = useState(() => (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches
  ));
  const nextPanelIdRef = useRef(1);
  const nextZIndexRef = useRef(FLOATING_SURFACE_Z.appPanelBase);
  const dragState = useRef<{ x: number; y: number; panelX: number; panelY: number } | null>(null);
  const resizeState = useRef<{
    x: number;
    y: number;
    panelX: number;
    panelY: number;
    w: number;
    h: number;
    edge: string;
  } | null>(null);

  const nextZIndex = useCallback(() => {
    nextZIndexRef.current += 1;
    return nextZIndexRef.current;
  }, []);

  const focusPanel = useCallback((id: string) => {
    const zIndex = nextZIndex();
    setPanels((current) => current.map((panel) => (
      panel.id === id ? { ...panel, zIndex } : panel
    )));
  }, [nextZIndex]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    const onChange = (event: MediaQueryListEvent) => setIsMobile(event.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const handleOpen = (event: Event) => {
      const detail = (event as CustomEvent<FloatingAppPanelRequest>).detail;
      if (!detail?.href || !isFloatingPanelRoute(detail.href)) return;

      const src = getFloatingPanelSrc(detail.href);
      const zIndex = nextZIndex();
      setPanels((current) => {
        const existing = current.find((panel) => panel.src === src);
        if (existing) {
          return current.map((panel) => (
            panel.id === existing.id ? { ...panel, zIndex } : panel
          ));
        }

        return [
          ...current,
          {
            id: `app-panel-${nextPanelIdRef.current++}`,
            href: detail.href,
            title: detail.title || detail.href,
            src,
            geo: createInitialGeo(current.length),
            isPinned: loadPinned(),
            zIndex,
          },
        ];
      });
    };
    window.addEventListener(OPEN_FLOATING_APP_PANEL_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_FLOATING_APP_PANEL_EVENT, handleOpen);
  }, [nextZIndex]);

  const closePanel = useCallback((id: string) => {
    setPanels((current) => current.filter((panel) => panel.id !== id));
  }, []);

  const togglePinned = useCallback((id: string) => {
    const zIndex = nextZIndex();
    setPanels((current) => current.map((panel) => {
      if (panel.id !== id) return panel;
      const isPinned = !panel.isPinned;
      savePinned(isPinned);
      return { ...panel, isPinned, zIndex };
    }));
  }, [nextZIndex]);

  const openFullPage = useCallback((panel: FloatingAppPanelState) => {
    window.location.assign(panel.href);
  }, []);

  const startDrag = useCallback((event: React.MouseEvent, panel: FloatingAppPanelState) => {
    if (isMobile || (event.target as HTMLElement).closest("button, a")) return;
    const node = event.currentTarget.closest("[data-floating-app-panel]");
    if (!(node instanceof HTMLElement)) return;
    event.preventDefault();
    focusPanel(panel.id);
    const rect = node.getBoundingClientRect();
    dragState.current = {
      x: event.clientX,
      y: event.clientY,
      panelX: rect.left,
      panelY: rect.top,
    };
    const onMove = (moveEvent: MouseEvent) => {
      if (!dragState.current) return;
      const next = clampLiveGeo({
        ...panel.geo,
        x: dragState.current.panelX + (moveEvent.clientX - dragState.current.x),
        y: dragState.current.panelY + (moveEvent.clientY - dragState.current.y),
      });
      setPanels((current) => current.map((item) => (
        item.id === panel.id ? { ...item, geo: next } : item
      )));
      saveGeo(next);
    };
    const onUp = () => {
      dragState.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [focusPanel, isMobile]);

  const startResize = useCallback((event: React.MouseEvent, panel: FloatingAppPanelState, edge: string) => {
    if (isMobile) return;
    const node = event.currentTarget.closest("[data-floating-app-panel]");
    if (!(node instanceof HTMLElement)) return;
    event.preventDefault();
    event.stopPropagation();
    focusPanel(panel.id);
    const rect = node.getBoundingClientRect();
    resizeState.current = {
      x: event.clientX,
      y: event.clientY,
      panelX: rect.left,
      panelY: rect.top,
      w: rect.width,
      h: rect.height,
      edge,
    };
    const onMove = (moveEvent: MouseEvent) => {
      if (!resizeState.current) return;
      const dx = moveEvent.clientX - resizeState.current.x;
      const dy = moveEvent.clientY - resizeState.current.y;
      let nextX = resizeState.current.panelX;
      let nextY = resizeState.current.panelY;
      let nextW = resizeState.current.w;
      let nextH = resizeState.current.h;

      if (edge.includes("e")) nextW = Math.max(MIN_W, resizeState.current.w + dx);
      if (edge.includes("s")) nextH = Math.max(MIN_H, resizeState.current.h + dy);
      if (edge.includes("w")) {
        nextW = Math.max(MIN_W, resizeState.current.w - dx);
        nextX = resizeState.current.panelX + (resizeState.current.w - nextW);
      }
      if (edge.includes("n")) {
        nextH = Math.max(MIN_H, resizeState.current.h - dy);
        nextY = resizeState.current.panelY + (resizeState.current.h - nextH);
      }

      const next = clampLiveGeo({ x: nextX, y: nextY, w: nextW, h: nextH });
      setPanels((current) => current.map((item) => (
        item.id === panel.id ? { ...item, geo: next } : item
      )));
      saveGeo(next);
    };
    const onUp = () => {
      resizeState.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [focusPanel, isMobile]);

  const topUnpinnedPanel = panels.reduce<FloatingAppPanelState | null>((top, panel) => {
    if (panel.isPinned) return top;
    if (!top || panel.zIndex > top.zIndex) return panel;
    return top;
  }, null);

  const getPanelStyle = (panel: FloatingAppPanelState): React.CSSProperties => {
    if (isMobile) return { zIndex: panel.zIndex };
    if (panel.geo.x < 0) {
      return { top: "4rem", left: "4rem", right: "4rem", bottom: "4rem", zIndex: panel.zIndex };
    }
    return { left: panel.geo.x, top: panel.geo.y, width: panel.geo.w, height: panel.geo.h, zIndex: panel.zIndex };
  };

  return (
    <div data-source="components/floating-app-panels.tsx">
      <AnimatePresence>
        {panels.length > 0 && (
          <motion.div
            key="floating-app-panel-desktop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 overflow-hidden"
            data-floating-app-desktop=""
            style={{ ...DESKTOP_PATTERN_STYLE, zIndex: FLOATING_SURFACE_Z.appDesktop }}
          >
            {PANEL_MODE_BACKGROUND_LAYERS.map((layerStyle, index) => (
              <div
                key={index}
                className="absolute inset-0"
                data-floating-app-desktop-layer={index}
                style={layerStyle}
              />
            ))}
          </motion.div>
        )}

        {topUnpinnedPanel && (
          <motion.div
            key="floating-app-panel-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-transparent"
            style={{ zIndex: FLOATING_SURFACE_Z.appPanelBackdrop }}
            onClick={() => closePanel(topUnpinnedPanel.id)}
          />
        )}

        {panels.map((panel) => (
          <motion.div
            key={panel.id}
            data-floating-app-panel=""
            initial={{ opacity: 0, scale: 0.92, y: 18 }}
            animate={{ opacity: PANEL_VISIBLE_OPACITY, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 18 }}
            transition={{ type: "spring", stiffness: 400, damping: 30, mass: 0.8 }}
            className={cn(
              "fixed overflow-hidden rounded-xl",
              "bg-[#0e0e0e]/72 dark:bg-[#060606]/72 backdrop-blur-[1px]",
              "shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_20px_60px_rgba(0,0,0,0.6)]",
              isMobile && "inset-2",
            )}
            style={getPanelStyle(panel)}
            onMouseDown={() => focusPanel(panel.id)}
          >
          <div
            data-floating-app-panel-shine=""
            aria-hidden="true"
            className="absolute inset-0 rounded-[inherit] pointer-events-none z-[60]"
            style={{
              padding: "1px",
              backgroundImage: `radial-gradient(transparent, transparent, ${MONO_PANEL_SHINE_COLORS}, transparent, transparent)`,
              backgroundSize: "300% 300%",
              animation: "sb-shine-pulse 14s linear infinite",
              WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
              WebkitMaskComposite: "xor" as React.CSSProperties["WebkitMaskComposite"],
              mask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
              maskComposite: "exclude" as unknown as string,
            }}
          />

          <div
            data-floating-app-panel-grip=""
            className={cn(
              "absolute inset-x-0 top-0 z-40 flex h-16 items-start justify-between px-3 pb-8 pt-2",
              !isMobile && "cursor-grab active:cursor-grabbing",
            )}
            style={{
              background:
                "linear-gradient(to bottom, rgba(6,6,6,0.9) 0%, rgba(6,6,6,0.7) 46%, rgba(6,6,6,0) 100%)",
            }}
            onMouseDown={(event) => startDrag(event, panel)}
          >
            <div className="flex min-w-0 items-center gap-2">
              <RouteSquareFilled className="h-4 w-4 shrink-0 text-white/55" />
              <span className="truncate text-xs font-bold tracking-tight text-white/80">
                {panel.title}
              </span>
              <span className="hidden truncate font-mono text-[10px] text-white/25 sm:inline">
                {panel.href}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => togglePinned(panel.id)}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full transition-colors",
                  panel.isPinned
                    ? "bg-white/10 text-white/75"
                    : "text-white/30 hover:bg-white/5 hover:text-white/70",
                )}
                title={panel.isPinned ? "Unpin panel" : "Pin panel"}
              >
                <AttachCircleFilled className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => openFullPage(panel)}
                className="flex h-7 w-7 items-center justify-center rounded-full text-white/30 transition-colors hover:bg-white/5 hover:text-white/70"
                title="Open full page"
              >
                <MaximizeFilled className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => closePanel(panel.id)}
                className="flex h-7 w-7 items-center justify-center rounded-full text-white/30 transition-colors hover:bg-white/5 hover:text-white/70"
                title="Close panel"
              >
                <CloseCircleFilled className="h-4 w-4" />
              </button>
            </div>
          </div>

          <iframe
            key={panel.src}
            title={`${panel.title} panel`}
            src={panel.src}
            className="absolute inset-0 z-20 h-full w-full border-0 bg-transparent"
          />

          {!isMobile && (
            <>
              <div className="absolute left-4 right-4 top-0 z-50 h-2 cursor-ns-resize" onMouseDown={(e) => startResize(e, panel, "n")} />
              <div className="absolute bottom-0 left-4 right-4 z-50 h-2 cursor-ns-resize" onMouseDown={(e) => startResize(e, panel, "s")} />
              <div className="absolute bottom-4 top-4 left-0 z-50 w-2 cursor-ew-resize" onMouseDown={(e) => startResize(e, panel, "w")} />
              <div className="absolute bottom-4 top-4 right-0 z-50 w-2 cursor-ew-resize" onMouseDown={(e) => startResize(e, panel, "e")} />
              <div className="absolute top-0 left-0 z-50 h-4 w-4 cursor-nwse-resize" onMouseDown={(e) => startResize(e, panel, "nw")} />
              <div className="absolute top-0 right-0 z-50 h-4 w-4 cursor-nesw-resize" onMouseDown={(e) => startResize(e, panel, "ne")} />
              <div className="absolute bottom-0 left-0 z-50 h-4 w-4 cursor-nesw-resize" onMouseDown={(e) => startResize(e, panel, "sw")} />
              <div className="absolute bottom-0 right-0 z-50 h-4 w-4 cursor-nwse-resize" onMouseDown={(e) => startResize(e, panel, "se")} />
            </>
          )}
        </motion.div>
      ))}
    </AnimatePresence>
    </div>
  );
}
