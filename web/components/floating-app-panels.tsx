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
import { usePillNavPreferences, COLOR_SCHEME_GRADIENTS } from "@/lib/pill-nav-preferences";
import { FLOATING_SURFACE_Z } from "@/lib/floating-surface-z";
import {
  OPEN_FLOATING_APP_PANEL_EVENT,
  getFloatingPanelSrc,
  isFloatingPanelRoute,
  type FloatingAppPanelRequest,
} from "@/lib/floating-app-panel-routing";

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
const DESKTOP_PATTERN_STYLE: React.CSSProperties = {
  backgroundColor: "#030304",
  backgroundImage: [
    "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.15) 1px, transparent 0)",
    "radial-gradient(circle at 18% 14%, rgba(91,158,245,0.08), transparent 34%)",
    "radial-gradient(circle at 82% 88%, rgba(176,126,232,0.08), transparent 32%)",
  ].join(", "),
  backgroundSize: "18px 18px, 100% 100%, 100% 100%",
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function sanitizeGeo(input: Partial<PanelGeometry>): PanelGeometry {
  const viewportW = typeof window === "undefined" ? DEFAULT_GEO.w + 128 : window.innerWidth;
  const viewportH = typeof window === "undefined" ? DEFAULT_GEO.h + 128 : window.innerHeight;
  const w = Number.isFinite(input.w) ? Math.max(MIN_W, input.w as number) : DEFAULT_GEO.w;
  const h = Number.isFinite(input.h) ? Math.max(MIN_H, input.h as number) : DEFAULT_GEO.h;
  const maxX = Math.max(16, viewportW - 160);
  const maxY = Math.max(16, viewportH - 120);

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
  const { prefs: pillPrefs } = usePillNavPreferences();
  const shineColors = COLOR_SCHEME_GRADIENTS[pillPrefs.colorScheme] || COLOR_SCHEME_GRADIENTS.rainbow;

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
    <AnimatePresence>
      {panels.length > 0 && (
        <motion.div
          key="floating-app-panel-desktop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0"
          data-floating-app-desktop=""
          style={{ ...DESKTOP_PATTERN_STYLE, zIndex: FLOATING_SURFACE_Z.appDesktop }}
        />
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
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 18 }}
          transition={{ type: "spring", stiffness: 400, damping: 30, mass: 0.8 }}
          className={cn(
            "fixed flex flex-col overflow-hidden rounded-xl",
            "bg-[#0e0e0e]/85 dark:bg-[#060606]/85 backdrop-blur-xl",
            "shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_20px_60px_rgba(0,0,0,0.6)]",
            isMobile && "inset-2",
          )}
          style={getPanelStyle(panel)}
          onMouseDown={() => focusPanel(panel.id)}
        >
          <div
            aria-hidden="true"
            className="absolute inset-0 rounded-[inherit] pointer-events-none z-30"
            style={{
              padding: "1px",
              backgroundImage: `radial-gradient(transparent, transparent, ${shineColors}, transparent, transparent)`,
              backgroundSize: "300% 300%",
              animation: "sb-shine-pulse 14s linear infinite",
              WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
              WebkitMaskComposite: "xor" as React.CSSProperties["WebkitMaskComposite"],
              mask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
              maskComposite: "exclude" as unknown as string,
            }}
          />

          <div
            className={cn(
              "relative z-40 flex shrink-0 items-center justify-between px-3 py-2",
              !isMobile && "cursor-grab active:cursor-grabbing",
            )}
            style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
            onMouseDown={(event) => startDrag(event, panel)}
          >
            <div className="flex min-w-0 items-center gap-2">
              <RouteSquareFilled className="h-4 w-4 shrink-0 text-[#5b9ef5]" />
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
                    ? "bg-[#5b9ef5]/10 text-[#5b9ef5]"
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
            className="relative z-20 flex-1 border-0 bg-background"
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
  );
}
