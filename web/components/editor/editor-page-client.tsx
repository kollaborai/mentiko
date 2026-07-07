"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useWorkspace } from "@/lib/ui-context/workspace-context";
import { useEditorStore } from "@/lib/ui/editor-store";
import { FileTree } from "./file-tree";
import { SplitContainer } from "./split-container";
import { QuickOpen } from "./quick-open";
import { SearchPanel } from "./search-panel";
import { EditorConfigPanel } from "./editor-config";
import { TasksDbPanel } from "./tasks-db-panel";
import { DocumentFilled, SearchNormalFilled, SettingsFilled, SidebarLeftFilled } from "@aliimam/icons";

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

export function EditorPageClient() {
  const { workspaces, workspaceId } = useWorkspace();
  const setTreeWorkspacePath = useEditorStore((s) => s.setTreeWorkspacePath);
  const toggleSearchPanel = useEditorStore((s) => s.toggleSearchPanel);
  const sidebarView = useEditorStore((s) => s.sidebarView);
  const setSidebarView = useEditorStore((s) => s.setSidebarView);
  const [quickOpenVisible, setQuickOpenVisible] = useState(false);

  const currentWorkspace = workspaces.find((w) => w.id === workspaceId);
  const workspacePath = currentWorkspace?.path ?? "";

  useEffect(() => {
    if (workspacePath) setTreeWorkspacePath(workspacePath);
  }, [workspacePath, setTreeWorkspacePath]);

  // cmd+p quick open, cmd+shift+f search
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

  // sidebar collapsed state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

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
        no workspace selected
      </div>
    );
  }

  return (
    <div className="h-full flex overflow-hidden">
      {/* quick open overlay */}
      <QuickOpen
        open={quickOpenVisible}
        onClose={() => setQuickOpenVisible(false)}
        workspacePath={workspacePath}
      />

      {/* file tree sidebar */}
      <div
        className="flex flex-col bg-muted shrink-0 relative overflow-hidden transition-[width] duration-150"
        style={{ width: sidebarCollapsed ? 0 : sidebarWidth }}
      >
        {/* sidebar header with icons */}
        <div className="flex items-center justify-between px-3 py-2 shrink-0">
          <span className="text-[10px] font-mono text-foreground/40 uppercase tracking-wider truncate">
            {currentWorkspace?.name || "files"}
          </span>
          <div className="flex items-center gap-1">
            <SidebarIcon
              active={sidebarView === "files"}
              onClick={() => setSidebarView("files")}
              title="Explorer"
            >
              <DocumentFilled className="h-3.5 w-3.5" />
            </SidebarIcon>
            <SidebarIcon
              active={sidebarView === "search"}
              onClick={() => setSidebarView("search")}
              title="Search"
            >
              <SearchNormalFilled className="h-3.5 w-3.5" />
            </SidebarIcon>
            <SidebarIcon
              active={sidebarView === "config"}
              onClick={() => setSidebarView("config")}
              title="Settings"
            >
              <SettingsFilled className="h-3.5 w-3.5" />
            </SidebarIcon>
            <SidebarIcon
              active={sidebarView === "db"}
              onClick={() => setSidebarView("db")}
              title="Tasks DB"
            >
              <span className="font-mono text-[10px] font-semibold">db</span>
            </SidebarIcon>
            <SidebarIcon
              active={false}
              onClick={() => setSidebarCollapsed(true)}
              title="Hide sidebar"
            >
              <SidebarLeftFilled className="h-3.5 w-3.5" />
            </SidebarIcon>
          </div>
        </div>

        {/* sidebar content */}
        <div className="flex-1 overflow-hidden">
          {sidebarView === "files" && <FileTree workspacePath={workspacePath} />}
          {sidebarView === "search" && <SearchPanel workspacePath={workspacePath} />}
          {sidebarView === "config" && <EditorConfigPanel />}
          {sidebarView === "db" && <TasksDbPanel />}
        </div>

        {/* resize handle */}
        <div
          onMouseDown={onDragStart}
          className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-foreground/10 active:bg-foreground/15 transition-colors z-10"
        />
      </div>

      {/* show sidebar button when collapsed */}
      {sidebarCollapsed && (
        <button
          onClick={() => setSidebarCollapsed(false)}
          title="Show sidebar"
          className="flex items-center justify-center w-6 shrink-0 h-full text-foreground/20 hover:text-foreground/50 hover:bg-muted/50 transition-colors"
        >
          <SidebarLeftFilled className="h-3.5 w-3.5 rotate-180" />
        </button>
      )}

      {/* split pane editor */}
      <SplitContainer rootPath={workspacePath} />
    </div>
  );
}
