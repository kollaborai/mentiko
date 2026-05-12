"use client";

import { useEffect, useState } from "react";
import { useEditorStore } from "@/lib/editor-store";
import { useWorkspace } from "@/lib/workspace-context";
import { unwrapApiData } from "@/lib/api-client";
import { FileTree } from "./file-tree";
import { FloatingWindowManager } from "./floating-window-manager";
import { QuickOpen } from "./quick-open";
import { SearchPanel } from "./search-panel";
import { EditorConfigPanel } from "./editor-config";
import { GitPanel } from "./git-panel";
import { DocumentFilled, SearchNormalFilled, SettingsFilled, FilterFilled } from "@aliimam/icons";
import { FloatingFileSidebar } from "./floating-sidebar";

const DEFAULT_SIDEBAR_W = 240;

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
      className={`flex items-center justify-center w-7 h-7 rounded-full transition-colors ${
        active
          ? "text-white/80 bg-white/10"
          : "text-white/30 hover:text-white/60 hover:bg-white/5"
      }`}
    >
      {children}
    </button>
  );
}

export function CodeEditorClient() {
  const setTreeWorkspacePath = useEditorStore((s) => s.setTreeWorkspacePath);
  const toggleSearchPanel = useEditorStore((s) => s.toggleSearchPanel);
  const sidebarView = useEditorStore((s) => s.sidebarView);
  const setSidebarView = useEditorStore((s) => s.setSidebarView);
  const { workspacePath } = useWorkspace();
  const [configRoot, setConfigRoot] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [quickOpenVisible, setQuickOpenVisible] = useState(false);
  const [fileFilterOpen, setFileFilterOpen] = useState(false);

  // fetch config root as fallback
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((raw) => {
        const data = unwrapApiData<{ root?: string }>(raw);
        if (data.root) setConfigRoot(data.root);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // use active workspace path if available, fall back to config root
  const projectRoot = workspacePath || configRoot;

  useEffect(() => {
    if (projectRoot) setTreeWorkspacePath(projectRoot);
  }, [projectRoot, setTreeWorkspacePath]);

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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-foreground/30">
        loading...
      </div>
    );
  }

  if (!projectRoot) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-foreground/30">
        could not resolve project root
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <QuickOpen
        open={quickOpenVisible}
        onClose={() => setQuickOpenVisible(false)}
        workspacePath={projectRoot}
      />

      {/* page header - pill nav inspired */}
      <div className="flex items-center gap-3 px-4 py-2 shrink-0">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#1a1a1a]/80 shadow-[0_0_0_1px_rgba(255,255,255,0.06)]">
          <h1 className="text-sm font-bold tracking-tight">Code</h1>
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/60 animate-pulse" />
          <span className="text-[10px] text-white/25 font-mono">{projectRoot.split("/").slice(-2).join("/")}</span>
        </div>
      </div>

      <div
        className="flex flex-1 overflow-hidden gap-2 p-2"
      >
      {/* floating sidebar with pill nav physics */}
      <FloatingFileSidebar
        width={DEFAULT_SIDEBAR_W}
        collapsedContent={
          <>
            <DocumentFilled className="h-3.5 w-3.5 text-white/50" />
            <span className="text-[9px] font-mono text-white/30">files</span>
          </>
        }
      >
        {/* sidebar icons */}
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
            {/* inline git branch SVG — @aliimam/icons has no git icon */}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <circle cx="6" cy="6" r="2.5" stroke="currentColor" strokeWidth="2"/>
              <circle cx="6" cy="18" r="2.5" stroke="currentColor" strokeWidth="2"/>
              <circle cx="18" cy="6" r="2.5" stroke="currentColor" strokeWidth="2"/>
              <line x1="6" y1="8.5" x2="6" y2="15.5" stroke="currentColor" strokeWidth="2"/>
              <path d="M6 8.5 C6 12 18 12 18 8.5" stroke="currentColor" strokeWidth="2" fill="none"/>
            </svg>
          </SidebarIcon>
        </div>

        {/* sidebar content */}
        {sidebarView === "files" && <FileTree workspacePath={projectRoot} filterOpen={fileFilterOpen} />}
        {sidebarView === "search" && <SearchPanel workspacePath={projectRoot} />}
        {sidebarView === "config" && <EditorConfigPanel />}
        {sidebarView === "git" && <GitPanel workspacePath={projectRoot} />}
      </FloatingFileSidebar>

      <FloatingWindowManager rootPath={projectRoot} />
      </div>
    </div>
  );
}
