"use client";

import { useRef, useCallback, useState, useEffect } from "react";
import { useEditorStore, usePane } from "@/lib/editor-store";
import { TabBar } from "./tab-bar";
import { EditorPane } from "./editor-pane";

interface WindowState {
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

interface FloatingWindowManagerProps {
  rootPath: string;
}

let zCounter = 1;

export function FloatingWindowManager({ rootPath }: FloatingWindowManagerProps) {
  const panes = useEditorStore((s) => s.panes);
  const activePaneId = useEditorStore((s) => s.activePaneId);
  const setActivePane = useEditorStore((s) => s.setActivePane);
  const splitRight = useEditorStore((s) => s.splitRight);
  const splitDown = useEditorStore((s) => s.splitDown);

  const containerRef = useRef<HTMLDivElement>(null);
  const [windows, setWindows] = useState<Map<string, WindowState>>(new Map());
  const cascadeIndex = useRef(0);

  // keyboard shortcuts: cmd+\ split right, cmd+shift+\ split down
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "\\") {
        e.preventDefault();
        if (e.shiftKey) {
          splitDown(activePaneId);
        } else {
          splitRight(activePaneId);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activePaneId, splitRight, splitDown]);

  // ensure every pane has a window state
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const cw = rect.width;
    const ch = rect.height;

    setWindows((prev) => {
      const next = new Map(prev);
      let changed = false;

      // remove stale windows
      for (const id of next.keys()) {
        if (!panes.find((p) => p.id === id)) {
          next.delete(id);
          changed = true;
        }
      }

      // add new windows
      for (const pane of panes) {
        if (!next.has(pane.id)) {
          const isFirst = next.size === 0 && !changed;
          let x: number, y: number, w: number, h: number;

          if (isFirst) {
            // centered, 70% x 80%
            w = Math.max(300, cw * 0.7);
            h = Math.max(200, ch * 0.8);
            x = (cw - w) / 2;
            y = (ch - h) / 2;
          } else {
            // cascade from top-left
            w = Math.max(300, cw * 0.55);
            h = Math.max(200, ch * 0.65);
            const offset = (cascadeIndex.current + 1) * 30;
            x = 40 + offset;
            y = 40 + offset;
            // wrap if it goes off-screen
            if (x + w > cw) x = 40;
            if (y + h > ch) y = 40;
            cascadeIndex.current++;
          }

          zCounter++;
          next.set(pane.id, { x, y, w, h, z: zCounter });
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [panes]);

  const bringToFront = useCallback((paneId: string) => {
    zCounter++;
    setWindows((prev) => {
      const ws = prev.get(paneId);
      if (!ws) return prev;
      const next = new Map(prev);
      next.set(paneId, { ...ws, z: zCounter });
      return next;
    });
    setActivePane(paneId);
  }, [setActivePane]);

  const updateWindow = useCallback((paneId: string, update: Partial<WindowState>) => {
    setWindows((prev) => {
      const ws = prev.get(paneId);
      if (!ws) return prev;
      const next = new Map(prev);
      next.set(paneId, { ...ws, ...update });
      return next;
    });
  }, []);

  return (
    <div
      ref={containerRef}
      className="flex-1 relative overflow-hidden"
    >
      {panes.map((pane) => {
        const ws = windows.get(pane.id);
        if (!ws) return null;
        const isActive = pane.id === activePaneId;

        return (
          <FloatingWindow
            key={pane.id}
            paneId={pane.id}
            rootPath={rootPath}
            isActive={isActive}
            windowState={ws}
            onBringToFront={() => bringToFront(pane.id)}
            onUpdateWindow={(update) => updateWindow(pane.id, update)}
          />
        );
      })}
    </div>
  );
}

interface FloatingWindowProps {
  paneId: string;
  rootPath: string;
  isActive: boolean;
  windowState: WindowState;
  onBringToFront: () => void;
  onUpdateWindow: (update: Partial<WindowState>) => void;
}

function FloatingWindow({
  paneId,
  rootPath,
  isActive,
  windowState,
  onBringToFront,
  onUpdateWindow,
}: FloatingWindowProps) {
  usePane(paneId);

  const MIN_W = 300;
  const MIN_H = 200;

  // drag handler
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      // ignore if clicking a button/input inside title bar
      if ((e.target as HTMLElement).closest("button, input, [role=button]")) return;

      e.preventDefault();
      onBringToFront();

      const startX = e.clientX;
      const startY = e.clientY;
      const origX = windowState.x;
      const origY = windowState.y;

      const onMove = (ev: MouseEvent) => {
        onUpdateWindow({
          x: origX + (ev.clientX - startX),
          y: origY + (ev.clientY - startY),
        });
      };

      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [windowState.x, windowState.y, onBringToFront, onUpdateWindow]
  );

  // resize handler factory
  const handleResizeStart = useCallback(
    (e: React.MouseEvent, edges: { top?: boolean; bottom?: boolean; left?: boolean; right?: boolean }) => {
      e.preventDefault();
      e.stopPropagation();
      onBringToFront();

      const startMX = e.clientX;
      const startMY = e.clientY;
      const origX = windowState.x;
      const origY = windowState.y;
      const origW = windowState.w;
      const origH = windowState.h;

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startMX;
        const dy = ev.clientY - startMY;

        let newX = origX;
        let newY = origY;
        let newW = origW;
        let newH = origH;

        if (edges.right) {
          newW = Math.max(MIN_W, origW + dx);
        }
        if (edges.bottom) {
          newH = Math.max(MIN_H, origH + dy);
        }
        if (edges.left) {
          const proposedW = origW - dx;
          if (proposedW >= MIN_W) {
            newW = proposedW;
            newX = origX + dx;
          } else {
            newW = MIN_W;
            newX = origX + (origW - MIN_W);
          }
        }
        if (edges.top) {
          const proposedH = origH - dy;
          if (proposedH >= MIN_H) {
            newH = proposedH;
            newY = origY + dy;
          } else {
            newH = MIN_H;
            newY = origY + (origH - MIN_H);
          }
        }

        onUpdateWindow({ x: newX, y: newY, w: newW, h: newH });
      };

      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [windowState.x, windowState.y, windowState.w, windowState.h, onBringToFront, onUpdateWindow]
  );

  return (
    <div
      data-pane-id={paneId}
      className="absolute flex flex-col overflow-hidden rounded-lg bg-[#0e0e0e] transition-shadow"
      style={{
        left: windowState.x,
        top: windowState.y,
        width: windowState.w,
        height: windowState.h,
        zIndex: windowState.z,
        boxShadow: isActive
          ? `0 0 0 1px rgba(255,255,255,0.1), 0 4px 24px rgba(0,0,0,0.4)`
          : `0 0 0 1px rgba(255,255,255,0.06)`,
      }}
      onMouseDown={() => onBringToFront()}
    >
      {/* accent top line */}
      <div
        className="absolute top-0 left-2 right-2 h-[1px] rounded-full"
        style={{ background: `rgba(255,255,255,0.06)` }}
      />

      {/* title bar - draggable */}
      <div
        className="flex items-center px-3 py-1.5 shrink-0 bg-[#0a0a0a]/60 cursor-grab active:cursor-grabbing select-none"
        onMouseDown={handleDragStart}
      >
        <TabBar paneId={paneId} rootPath={rootPath} />
      </div>

      {/* editor content */}
      <div className="flex-1 overflow-hidden">
        <EditorPane paneId={paneId} rootPath={rootPath} />
      </div>

      {/* resize handles - edges */}
      {/* top */}
      <div
        className="absolute top-0 left-2 right-2 h-1 cursor-ns-resize z-10"
        onMouseDown={(e) => handleResizeStart(e, { top: true })}
      />
      {/* bottom */}
      <div
        className="absolute bottom-0 left-2 right-2 h-1 cursor-ns-resize z-10"
        onMouseDown={(e) => handleResizeStart(e, { bottom: true })}
      />
      {/* left */}
      <div
        className="absolute top-2 bottom-2 left-0 w-1 cursor-ew-resize z-10"
        onMouseDown={(e) => handleResizeStart(e, { left: true })}
      />
      {/* right */}
      <div
        className="absolute top-2 bottom-2 right-0 w-1 cursor-ew-resize z-10"
        onMouseDown={(e) => handleResizeStart(e, { right: true })}
      />

      {/* resize handles - corners */}
      {/* top-left */}
      <div
        className="absolute top-0 left-0 w-3 h-3 cursor-nwse-resize z-20"
        onMouseDown={(e) => handleResizeStart(e, { top: true, left: true })}
      />
      {/* top-right */}
      <div
        className="absolute top-0 right-0 w-3 h-3 cursor-nesw-resize z-20"
        onMouseDown={(e) => handleResizeStart(e, { top: true, right: true })}
      />
      {/* bottom-left */}
      <div
        className="absolute bottom-0 left-0 w-3 h-3 cursor-nesw-resize z-20"
        onMouseDown={(e) => handleResizeStart(e, { bottom: true, left: true })}
      />
      {/* bottom-right */}
      <div
        className="absolute bottom-0 right-0 w-3 h-3 cursor-nwse-resize z-20"
        onMouseDown={(e) => handleResizeStart(e, { bottom: true, right: true })}
      />
    </div>
  );
}
