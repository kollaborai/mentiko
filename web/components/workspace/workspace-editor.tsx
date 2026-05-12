"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useEditorStore } from "@/lib/editor-store";
import { FileTree } from "@/components/editor/file-tree";
import { SplitContainer } from "@/components/editor/split-container";
import { QuickOpen } from "@/components/editor/quick-open";
import { SearchPanel } from "@/components/editor/search-panel";
import { EditorConfigPanel } from "@/components/editor/editor-config";
import { DocumentFilled as Files, SearchNormalFilled as Search, Setting3Filled as Settings } from "@aliimam/icons";
import type { Workspace } from "@/lib/workspace-storage";

const SIDEBAR_KEY = "editor-sidebar-width";
const MIN_W = 180;
const MAX_W = 500;
const DEFAULT_W = 240;

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
      className={`p-1 rounded-sm transition-colors ${
        active
          ? "text-foreground bg-accent"
          : "text-foreground/30 hover:text-foreground/50"
      }`}
    >
      {children}
    </button>
  );
}

export function WorkspaceEditor({ workspace }: { workspace: Workspace }) {
  const setTreeWorkspacePath = useEditorStore((s) => s.setTreeWorkspacePath);
  const toggleSearchPanel = useEditorStore((s) => s.toggleSearchPanel);
  const sidebarView = useEditorStore((s) => s.sidebarView);
  const setSidebarView = useEditorStore((s) => s.setSidebarView);
  const [quickOpenVisible, setQuickOpenVisible] = useState(false);

  const workspacePath = workspace.path;

  useEffect(() => {
    if (workspacePath) setTreeWorkspacePath(workspacePath);
  }, [workspacePath, setTreeWorkspacePath]);

  // keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault();
        setQuickOpenVisible((v) => !v);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        toggleSearchPanel();
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggleSearchPanel]);

  // resizable sidebar
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_W);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(DEFAULT_W);

  useEffect(() => {
    const saved = localStorage.getItem(SIDEBAR_KEY);
    if (saved) {
      const w = parseInt(saved, 10);
      if (w >= MIN_W && w <= MAX_W) queueMicrotask(() => setSidebarWidth(w));
    }
  }, []);

  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      startX.current = e.clientX;
      startW.current = sidebarWidth;

      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const delta = ev.clientX - startX.current;
        const next = Math.min(MAX_W, Math.max(MIN_W, startW.current + delta));
        setSidebarWidth(next);
      };

      const onUp = () => {
        dragging.current = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        setSidebarWidth((w) => {
          localStorage.setItem(SIDEBAR_KEY, String(w));
          return w;
        });
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [sidebarWidth]
  );

  if (!workspacePath) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-foreground/30">
        no workspace path configured
      </div>
    );
  }

  return (
    <div className="h-full flex overflow-hidden">
      <QuickOpen
        open={quickOpenVisible}
        onClose={() => setQuickOpenVisible(false)}
        workspacePath={workspacePath}
      />

      {/* sidebar */}
      <div
        className="flex flex-col bg-muted shrink-0 relative overflow-hidden"
        style={{ width: sidebarWidth }}
      >
        <div className="flex items-center justify-between px-3 py-2 shrink-0">
          <span className="text-[10px] font-mono text-foreground/40 uppercase tracking-wider truncate">
            {workspace.name || "files"}
          </span>
          <div className="flex items-center gap-1">
            <SidebarIcon
              active={sidebarView === "files"}
              onClick={() => setSidebarView("files")}
              title="Explorer"
            >
              <Files className="h-3.5 w-3.5" />
            </SidebarIcon>
            <SidebarIcon
              active={sidebarView === "search"}
              onClick={() => setSidebarView("search")}
              title="Search"
            >
              <Search className="h-3.5 w-3.5" />
            </SidebarIcon>
            <SidebarIcon
              active={sidebarView === "config"}
              onClick={() => setSidebarView("config")}
              title="Settings"
            >
              <Settings className="h-3.5 w-3.5" />
            </SidebarIcon>
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          {sidebarView === "files" && <FileTree workspacePath={workspacePath} />}
          {sidebarView === "search" && <SearchPanel workspacePath={workspacePath} />}
          {sidebarView === "config" && <EditorConfigPanel />}
        </div>

        <div
          onMouseDown={onDragStart}
          className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-foreground/10 active:bg-foreground/15 transition-colors z-10"
        />
      </div>

      {/* editor panes */}
      <SplitContainer rootPath={workspacePath} />
    </div>
  );
}
