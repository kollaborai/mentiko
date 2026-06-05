"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  CodeFilled,
  DocumentFilled,
  SearchNormalFilled,
  SettingsFilled,
  FilterFilled,
  CloseCircleFilled,
  AttachCircleFilled,
} from "@aliimam/icons";
import { unwrapApiData } from "@/lib/api/api-client";
import { FLOATING_SURFACE_Z } from "@/lib/ui/floating-surface-z";
import { cn } from "@/lib/utils";
import { useEditorStore, isDirty } from "@/lib/ui/editor-store";
import { useWorkspace } from "@/lib/ui-context/workspace-context";
import { usePillNavPreferences, getPillNavShineGradient } from "@/lib/ui/pill-nav-preferences";
import { FileTree } from "./file-tree";
import { SplitContainer } from "./split-container";
import { SearchPanel } from "./search-panel";
import { EditorConfigPanel } from "./editor-config";
import { GitPanel } from "./git-panel";
import { QuickOpen } from "./quick-open";

// ─── sidebar icon ────────────────────────────────────────────

function SidebarIcon({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "flex items-center justify-center w-7 h-7 rounded-full transition-colors",
        active
          ? "text-white/80 bg-white/10"
          : "text-white/30 hover:text-white/60 hover:bg-white/5",
      )}
    >
      {children}
    </button>
  );
}

// ─── pill position persistence ───────────────────────────────

const PINNED_KEY = "editor-overlay-pinned";
const SIDEBAR_W_KEY = "editor-overlay-sidebar-w";
const DEFAULT_SIDEBAR_W = 240;
const MIN_SIDEBAR_W = 140;
const MAX_SIDEBAR_W = 500;

const PANEL_BOUNDS_KEY = "editor-overlay-bounds";
const MIN_PANEL_W = 400;
const MIN_PANEL_H = 300;

interface PanelBounds {
  top: number;    // percent
  left: number;   // percent
  right: number;  // percent from right
  bottom: number; // percent from bottom
}

const DEFAULT_BOUNDS: PanelBounds = { top: 4, left: 4, right: 4, bottom: 4 };
const MOBILE_BOUNDS: PanelBounds = { top: 0, left: 0, right: 0, bottom: 0 };
const MOBILE_BREAKPOINT = 640;

function loadPanelBounds(): PanelBounds {
  if (typeof window === "undefined") return DEFAULT_BOUNDS;
  try {
    const s = localStorage.getItem(PANEL_BOUNDS_KEY);
    if (s) {
      const p = JSON.parse(s);
      if (typeof p.top === "number") return p;
    }
  } catch {}
  return DEFAULT_BOUNDS;
}

type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const CURSOR_MAP: Record<ResizeDir, string> = {
  n: "ns-resize", s: "ns-resize",
  e: "ew-resize", w: "ew-resize",
  ne: "nesw-resize", sw: "nesw-resize",
  nw: "nwse-resize", se: "nwse-resize",
};

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }

// ─── component ───────────────────────────────────────────────

export function FloatingCodePill() {
  const isOpen = useEditorStore((s) => s.isOverlayOpen);
  const openOverlay = useEditorStore((s) => s.openOverlay);
  const closeOverlay = useEditorStore((s) => s.closeOverlay);
  const fileCache = useEditorStore((s) => s.fileCache);
  const activePaneId = useEditorStore((s) => s.activePaneId);
  const setTreeWorkspacePath = useEditorStore((s) => s.setTreeWorkspacePath);
  const splitRight = useEditorStore((s) => s.splitRight);
  const sidebarView = useEditorStore((s) => s.sidebarView);
  const setSidebarView = useEditorStore((s) => s.setSidebarView);

  const { workspacePath } = useWorkspace();
  const { prefs: pillPrefs } = usePillNavPreferences();
  const shineColors = getPillNavShineGradient(pillPrefs);
  const [configRoot, setConfigRoot] = useState<string | null>(null);
  const [quickOpenVisible, setQuickOpenVisible] = useState(false);
  const [fileFilterOpen, setFileFilterOpen] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [sidebarW, setSidebarW] = useState(DEFAULT_SIDEBAR_W);
  const [isResizing, setIsResizing] = useState(false);
  const resizeStart = useRef<{ x: number; w: number } | null>(null);
  const [panelBounds, setPanelBounds] = useState<PanelBounds>(DEFAULT_BOUNDS);
  const [isPanelResizing, setIsPanelResizing] = useState(false);
  const panelResizeStart = useRef<{ x: number; y: number; bounds: PanelBounds; dir: ResizeDir } | null>(null);
  const [isPanelDragging, setIsPanelDragging] = useState(false);
  const panelDragStart = useRef<{ x: number; y: number; bounds: PanelBounds } | null>(null);
  const panelHasMoved = useRef(false);
  const [isPinned, setIsPinned] = useState(false);
  const [mounted, setMounted] = useState(false);

  const overlayRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(false);

  // hydrate from localStorage (standard React hydration pattern)
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    setMounted(true);
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    const applyViewportMode = (matches: boolean) => {
      setIsMobile(matches);
      setPanelBounds(matches ? MOBILE_BOUNDS : loadPanelBounds());
      if (matches) setSidebarVisible(false);
    };
    applyViewportMode(mq.matches);
    const onChange = (e: MediaQueryListEvent) => applyViewportMode(e.matches);
    mq.addEventListener("change", onChange);
    try {
      const sw = localStorage.getItem(SIDEBAR_W_KEY);
      if (sw) setSidebarW(clamp(parseInt(sw, 10), MIN_SIDEBAR_W, MAX_SIDEBAR_W));
    } catch {}
    try { setIsPinned(localStorage.getItem(PINNED_KEY) === "true"); } catch {}
    // hydrate overlay open state from localStorage (store defaults to false for SSR)
    try {
      if (localStorage.getItem("editor-overlay-open") === "true") openOverlay();
    } catch {}
    return () => mq.removeEventListener("change", onChange);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // fetch project root as fallback
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((raw) => {
        const data = unwrapApiData<{ root?: string }>(raw);
        if (data.root) setConfigRoot(data.root);
      })
      .catch(() => {});
  }, []);

  const projectRoot = workspacePath || configRoot;

  useEffect(() => {
    if (projectRoot) setTreeWorkspacePath(projectRoot);
  }, [projectRoot, setTreeWorkspacePath]);

  // keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // esc closes overlay
      if (e.key === "Escape" && isOpen) {
        e.preventDefault();
        closeOverlay();
        return;
      }
      // cmd+p quick open (only when overlay is open)
      if ((e.metaKey || e.ctrlKey) && e.key === "p" && isOpen) {
        e.preventDefault();
        setQuickOpenVisible((v) => !v);
        return;
      }
      // cmd+shift+e toggles overlay
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        if (isOpen) closeOverlay();
        else openOverlay();
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, closeOverlay, openOverlay]);

  // pin toggle
  const togglePin = useCallback(() => {
    setIsPinned(prev => {
      const next = !prev;
      try { localStorage.setItem(PINNED_KEY, String(next)); } catch {}
      return next;
    });
  }, []);

  // click outside to close (only when unpinned)
  useEffect(() => {
    if (!isOpen || isPinned) return;
    const handler = (e: MouseEvent) => {
      const overlay = overlayRef.current;
      if (!overlay) return;
      if (overlay.contains(e.target as Node)) return;
      const target = e.target as HTMLElement;
      if (target.closest("[data-pill-nav]") || target.closest("[data-terminal-panel]")) return;
      closeOverlay();
    };
    const timer = setTimeout(() => {
      window.addEventListener("mousedown", handler);
    }, 100);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousedown", handler);
    };
  }, [isOpen, isPinned, closeOverlay]);

  const dirtyCount = Array.from(fileCache.values()).filter(isDirty).length;

  // ─── sidebar resize ───────────────────────────────────────
  const handleResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeStart.current = { x: e.clientX, w: sidebarW };
    setIsResizing(true);
    try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch {}
  }, [sidebarW]);

  const handleResizeMove = useCallback((e: React.PointerEvent) => {
    if (!isResizing || !resizeStart.current) return;
    const dx = e.clientX - resizeStart.current.x;
    const newW = clamp(resizeStart.current.w + dx, MIN_SIDEBAR_W, MAX_SIDEBAR_W);
    setSidebarW(newW);
  }, [isResizing]);

  const handleResizeEnd = useCallback((e: React.PointerEvent) => {
    if (!isResizing) return;
    setIsResizing(false);
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
    try { localStorage.setItem(SIDEBAR_W_KEY, String(sidebarW)); } catch {}
    resizeStart.current = null;
  }, [isResizing, sidebarW]);

  // ─── panel resize ──────────────────────────────────────────
  const handlePanelResizeStart = useCallback((dir: ResizeDir) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    panelResizeStart.current = { x: e.clientX, y: e.clientY, bounds: { ...panelBounds }, dir };
    setIsPanelResizing(true);
    try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch {}
  }, [panelBounds]);

  const handlePanelResizeMove = useCallback((e: React.PointerEvent) => {
    if (!isPanelResizing || !panelResizeStart.current) return;
    const { x: sx, y: sy, bounds: ob, dir } = panelResizeStart.current;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const nb = { ...ob };

    // convert px delta to percent
    const dpx = (dx / w) * 100;
    const dpy = (dy / h) * 100;

    if (dir.includes("n")) nb.top = clamp(ob.top + dpy, 1, 100 - ob.bottom - (MIN_PANEL_H / h) * 100);
    if (dir.includes("s")) nb.bottom = clamp(ob.bottom - dpy, 1, 100 - ob.top - (MIN_PANEL_H / h) * 100);
    if (dir.includes("w")) nb.left = clamp(ob.left + dpx, 1, 100 - ob.right - (MIN_PANEL_W / w) * 100);
    if (dir.includes("e")) nb.right = clamp(ob.right - dpx, 1, 100 - ob.left - (MIN_PANEL_W / w) * 100);

    setPanelBounds(nb);
  }, [isPanelResizing]);

  const handlePanelResizeEnd = useCallback((e: React.PointerEvent) => {
    if (!isPanelResizing) return;
    setIsPanelResizing(false);
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
    try { localStorage.setItem(PANEL_BOUNDS_KEY, JSON.stringify(panelBounds)); } catch {}
    panelResizeStart.current = null;
  }, [isPanelResizing, panelBounds]);

  // ─── panel drag (by header) ────────────────────────────────
  const handlePanelDragStart = useCallback((e: React.PointerEvent) => {
    if (isMobile) return;
    // only drag from the header bar itself, not buttons/inputs
    if ((e.target as HTMLElement).closest("button, a, input")) return;
    e.preventDefault();
    panelDragStart.current = { x: e.clientX, y: e.clientY, bounds: { ...panelBounds } };
    panelHasMoved.current = false;
    setIsPanelDragging(true);
    try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch {}
  }, [panelBounds, isMobile]);

  const handlePanelDragMove = useCallback((e: React.PointerEvent) => {
    if (!isPanelDragging || !panelDragStart.current) return;
    const dx = e.clientX - panelDragStart.current.x;
    const dy = e.clientY - panelDragStart.current.y;
    if (!panelHasMoved.current && Math.abs(dx) + Math.abs(dy) < 4) return;
    panelHasMoved.current = true;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const ob = panelDragStart.current.bounds;
    const dpx = (dx / w) * 100;
    const dpy = (dy / h) * 100;
    setPanelBounds({
      top: clamp(ob.top + dpy, 0, 80),
      bottom: clamp(ob.bottom - dpy, 0, 80),
      left: clamp(ob.left + dpx, 0, 80),
      right: clamp(ob.right - dpx, 0, 80),
    });
  }, [isPanelDragging]);

  const handlePanelDragEnd = useCallback((e: React.PointerEvent) => {
    if (!isPanelDragging) return;
    setIsPanelDragging(false);
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
    try { localStorage.setItem(PANEL_BOUNDS_KEY, JSON.stringify(panelBounds)); } catch {}
    panelDragStart.current = null;
  }, [isPanelDragging, panelBounds]);

  if (!mounted) return null;

  return (
    <>
      {/* ── overlay ── */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* backdrop (hidden when pinned) */}
            {!isPinned && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 bg-black/40 backdrop-blur-[2px]"
                style={{ zIndex: FLOATING_SURFACE_Z.codeBackdrop }}
                onClick={closeOverlay}
              />
            )}

            {/* panel */}
            <motion.div
              ref={overlayRef}
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0, borderRadius: "12px" }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{
                type: "spring",
                stiffness: 400,
                damping: 30,
                mass: 0.8,
              }}
              className={cn(
                "fixed flex flex-col overflow-hidden",
                "bg-[#0e0e0e]/75 dark:bg-[#060606]/75 backdrop-blur-xl",
                "shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_20px_60px_rgba(0,0,0,0.6)]",
              )}
              style={{
                zIndex: FLOATING_SURFACE_Z.codePanel,
                top: `${panelBounds.top}%`,
                left: `${panelBounds.left}%`,
                right: `${panelBounds.right}%`,
                bottom: `${panelBounds.bottom}%`,
              }}
            >
              {/* resize handles - edges + corners (hidden on mobile) */}
              {!isMobile && (["n", "s", "e", "w", "nw", "ne", "sw", "se"] as ResizeDir[]).map((dir) => (
                <div
                  key={dir}
                  onPointerDown={handlePanelResizeStart(dir)}
                  onPointerMove={handlePanelResizeMove}
                  onPointerUp={handlePanelResizeEnd}
                  onPointerCancel={handlePanelResizeEnd}
                  style={{ cursor: CURSOR_MAP[dir] }}
                  className={cn(
                    "absolute z-30 hover:bg-cyan-400/10 transition-colors",
                    // edge strips - 8px wide hit area
                    dir === "n" && "-top-1 left-3 right-3 h-2",
                    dir === "s" && "-bottom-1 left-3 right-3 h-2",
                    dir === "w" && "-left-1 top-3 bottom-3 w-2",
                    dir === "e" && "-right-1 top-3 bottom-3 w-2",
                    // corner squares - 16px hit area
                    dir === "nw" && "-top-1 -left-1 w-4 h-4 rounded-tl-xl",
                    dir === "ne" && "-top-1 -right-1 w-4 h-4 rounded-tr-xl",
                    dir === "sw" && "-bottom-1 -left-1 w-4 h-4 rounded-bl-xl",
                    dir === "se" && "-bottom-1 -right-1 w-4 h-4 rounded-br-xl",
                  )}
                />
              ))}

              {/* shine border on panel */}
              <div
                aria-hidden="true"
                className="absolute inset-0 rounded-[inherit] pointer-events-none z-40"
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

              {/* ── header (draggable) ── */}
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                onPointerDown={handlePanelDragStart}
                onPointerMove={handlePanelDragMove}
                onPointerUp={handlePanelDragEnd}
                onPointerCancel={handlePanelDragEnd}
                className={cn(
                  "flex items-center justify-between px-3 sm:px-4 py-2 shrink-0 relative z-20",
                  !isMobile && (isPanelDragging ? "cursor-grabbing" : "cursor-grab"),
                )}
              >
                <div className="flex items-center gap-2 sm:gap-3">
                  {isMobile && (
                    <button
                      onClick={() => setSidebarVisible(v => !v)}
                      className="flex items-center justify-center w-8 h-8 rounded-full text-white/40 hover:text-white/70 hover:bg-white/10 transition-colors"
                      title="Toggle file tree"
                    >
                      <DocumentFilled className="h-4 w-4" />
                    </button>
                  )}
                  <div className="flex items-center gap-2">
                    <CodeFilled className="h-4 w-4 text-cyan-400/80" />
                    <span className="text-xs font-bold tracking-tight text-white/80">Code</span>
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/60 animate-pulse" />
                  </div>
                  {projectRoot && (
                    <span className="text-[10px] text-white/20 font-mono">
                      {projectRoot.split("/").slice(-2).join("/")}
                    </span>
                  )}
                  {dirtyCount > 0 && (
                    <span className="text-[10px] text-amber-400/60 font-mono">
                      {dirtyCount} unsaved
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-white/15 font-mono hidden sm:inline">cmd+shift+e</span>
                  <button
                    onClick={togglePin}
                    className={cn(
                      "hidden sm:flex items-center justify-center w-6 h-6 rounded-full transition-colors",
                      isPinned
                        ? "text-cyan-400/80 bg-cyan-400/10 hover:bg-cyan-400/20"
                        : "text-white/30 hover:text-white/60 hover:bg-white/5",
                    )}
                    title={isPinned ? "Unpin (click outside will close)" : "Pin (stay open while navigating)"}
                  >
                    <AttachCircleFilled className="h-4 w-4" style={isPinned ? { transform: "rotate(45deg)" } : undefined} />
                  </button>
                  <button
                    onClick={() => splitRight(activePaneId)}
                    className="hidden sm:flex items-center justify-center w-6 h-6 rounded-full text-white/30 hover:text-white/60 hover:bg-white/5 transition-colors"
                    title="Split editor right (Cmd+\)"
                  >
                    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <rect x="1" y="2" width="14" height="12" rx="2" />
                      <line x1="8" y1="2" x2="8" y2="14" />
                    </svg>
                  </button>
                  <button
                    onClick={closeOverlay}
                    className="flex items-center justify-center w-8 h-8 sm:w-6 sm:h-6 rounded-full text-white/30 hover:text-white/60 hover:bg-white/5 transition-colors"
                    title="Close (Esc)"
                  >
                    <CloseCircleFilled className="h-5 w-5 sm:h-4 sm:w-4" />
                  </button>
                </div>
              </motion.div>

              {/* ── body ── */}
              <div className={cn("flex flex-1 overflow-hidden relative z-20", isMobile && "flex-col")}>
                {projectRoot ? (
                  <>
                    {/* sidebar / file panel */}
                    {isMobile ? (
                      /* mobile: file tree as collapsible top panel */
                      sidebarVisible && (
                        <div className="flex flex-col shrink-0 max-h-[40%] overflow-hidden" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                          <div className="flex items-center gap-0.5 px-3 py-1 shrink-0">
                            <SidebarIcon active={sidebarView === "files"} onClick={() => setSidebarView("files")} title="Explorer">
                              <DocumentFilled className="h-3.5 w-3.5" />
                            </SidebarIcon>
                            <SidebarIcon active={sidebarView === "search"} onClick={() => setSidebarView("search")} title="Search">
                              <SearchNormalFilled className="h-3.5 w-3.5" />
                            </SidebarIcon>
                            <SidebarIcon active={sidebarView === "config"} onClick={() => setSidebarView("config")} title="Settings">
                              <SettingsFilled className="h-3.5 w-3.5" />
                            </SidebarIcon>
                            <SidebarIcon active={fileFilterOpen} onClick={() => setFileFilterOpen((v) => !v)} title="Filter files">
                              <FilterFilled className="h-3.5 w-3.5" />
                            </SidebarIcon>
                            <SidebarIcon active={sidebarView === "git"} onClick={() => setSidebarView("git")} title="Source Control">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                                <circle cx="6" cy="6" r="2.5" stroke="currentColor" strokeWidth="2"/>
                                <circle cx="6" cy="18" r="2.5" stroke="currentColor" strokeWidth="2"/>
                                <circle cx="18" cy="6" r="2.5" stroke="currentColor" strokeWidth="2"/>
                                <line x1="6" y1="8.5" x2="6" y2="15.5" stroke="currentColor" strokeWidth="2"/>
                                <path d="M6 8.5 C6 12 18 12 18 8.5" stroke="currentColor" strokeWidth="2" fill="none"/>
                              </svg>
                            </SidebarIcon>
                          </div>
                          <div className="flex-1 overflow-y-auto overflow-x-hidden">
                            {sidebarView === "files" && <FileTree workspacePath={projectRoot} filterOpen={fileFilterOpen} onFileSelect={() => setSidebarVisible(false)} />}
                            {sidebarView === "search" && <SearchPanel workspacePath={projectRoot} />}
                            {sidebarView === "config" && <EditorConfigPanel />}
                            {sidebarView === "git" && <GitPanel workspacePath={projectRoot} />}
                          </div>
                        </div>
                      )
                    ) : (
                      /* desktop: sidebar left */
                      <>
                        <motion.div
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: sidebarVisible ? 1 : 0, x: 0, width: sidebarVisible ? sidebarW : 0 }}
                          transition={{ type: "spring", stiffness: 400, damping: 30 }}
                          className="shrink-0 flex flex-col overflow-hidden"
                        >
                          <div className="flex items-center gap-0.5 px-3 py-1 shrink-0">
                            <SidebarIcon active={sidebarView === "files"} onClick={() => setSidebarView("files")} title="Explorer">
                              <DocumentFilled className="h-3.5 w-3.5" />
                            </SidebarIcon>
                            <SidebarIcon active={sidebarView === "search"} onClick={() => setSidebarView("search")} title="Search">
                              <SearchNormalFilled className="h-3.5 w-3.5" />
                            </SidebarIcon>
                            <SidebarIcon active={sidebarView === "config"} onClick={() => setSidebarView("config")} title="Settings">
                              <SettingsFilled className="h-3.5 w-3.5" />
                            </SidebarIcon>
                            <SidebarIcon active={fileFilterOpen} onClick={() => setFileFilterOpen((v) => !v)} title="Filter files">
                              <FilterFilled className="h-3.5 w-3.5" />
                            </SidebarIcon>
                            <SidebarIcon active={sidebarView === "git"} onClick={() => setSidebarView("git")} title="Source Control">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                                <circle cx="6" cy="6" r="2.5" stroke="currentColor" strokeWidth="2"/>
                                <circle cx="6" cy="18" r="2.5" stroke="currentColor" strokeWidth="2"/>
                                <circle cx="18" cy="6" r="2.5" stroke="currentColor" strokeWidth="2"/>
                                <line x1="6" y1="8.5" x2="6" y2="15.5" stroke="currentColor" strokeWidth="2"/>
                                <path d="M6 8.5 C6 12 18 12 18 8.5" stroke="currentColor" strokeWidth="2" fill="none"/>
                              </svg>
                            </SidebarIcon>
                          </div>
                          <div className="flex-1 overflow-y-auto overflow-x-hidden">
                            {sidebarView === "files" && <FileTree workspacePath={projectRoot} filterOpen={fileFilterOpen} />}
                            {sidebarView === "search" && <SearchPanel workspacePath={projectRoot} />}
                            {sidebarView === "config" && <EditorConfigPanel />}
                            {sidebarView === "git" && <GitPanel workspacePath={projectRoot} />}
                          </div>
                        </motion.div>

                        {/* resize handle (only when sidebar visible) */}
                        {sidebarVisible && <div
                          onPointerDown={handleResizeStart}
                          onPointerMove={handleResizeMove}
                          onPointerUp={handleResizeEnd}
                          onPointerCancel={handleResizeEnd}
                          className={cn(
                            "w-1 shrink-0 cursor-col-resize group/resize relative",
                            "hover:bg-cyan-400/20 active:bg-cyan-400/30 transition-colors",
                            isResizing && "bg-cyan-400/30",
                          )}
                        >
                          <div className={cn(
                            "absolute inset-y-0 left-0 w-px",
                            isResizing ? "bg-cyan-400/40" : "bg-white/[0.04] group-hover/resize:bg-cyan-400/20",
                            "transition-colors",
                          )} />
                        </div>}
                      </>
                    )}

                    {/* editor area */}
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.2 }}
                      className="flex-1 flex flex-col min-w-0 overflow-hidden"
                    >
                      {!isMobile && !sidebarVisible && (
                        <div className="shrink-0 flex items-center">
                          <button
                            onClick={() => setSidebarVisible(true)}
                            className="flex items-center justify-center w-7 h-7 shrink-0 ml-1 rounded-full text-cyan-400/80 bg-cyan-400/10 hover:bg-cyan-400/20 transition-colors"
                            title="Show sidebar"
                          >
                            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
                              <rect x="1" y="2" width="14" height="12" rx="2" />
                              <line x1="5.5" y1="2" x2="5.5" y2="14" />
                            </svg>
                          </button>
                        </div>
                      )}
                      <SplitContainer rootPath={projectRoot} />
                    </motion.div>
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-center">
                    <p className="text-xs text-white/20">no workspace selected</p>
                  </div>
                )}
              </div>

              {/* quick open */}
              {projectRoot && (
                <QuickOpen
                  open={quickOpenVisible}
                  onClose={() => setQuickOpenVisible(false)}
                  workspacePath={projectRoot}
                />
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
