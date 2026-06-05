"use client";

import { useState, useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { unwrapApiData } from "@/lib/api/api-client";
import {
  FolderFilled,
  FolderOpenFilled,
  ArrowDown1Filled,
  LocationCrossFilled,
  AddFilled,
  FolderAddFilled,
} from "@aliimam/icons";
import { useEditorStore } from "@/lib/ui/editor-store";
import { WaveSpinner } from "@/components/ui/wave-spinner";
import { FileTypeIcon } from "./quick-open";

interface FileNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: FileNode[];
  ext?: string;
}

interface FileTreeProps {
  workspacePath: string;
  filterOpen?: boolean;
  onFileSelect?: () => void;
}

// folder color palette - deterministic by name
const FOLDER_COLORS: Record<string, string> = {
  bin: "#f59e0b",
  chains: "#3b82f6",
  docs: "#22c55e",
  lib: "#38bdf8",
  web: "#06b6d4",
  tests: "#eab308",
  scripts: "#f97316",
  public: "#64748b",
  memory: "#ec4899",
  namespaces: "#8b5cf6",
  agents: "#14b8a6",
  templates: "#f472b6",
  workspace: "#6366f1",
  examples: "#84cc16",
  src: "#06b6d4",
  components: "#3b82f6",
  app: "#22c55e",
  api: "#f59e0b",
  hooks: "#a855f7",
  utils: "#64748b",
  config: "#f97316",
  node_modules: "#374151",
};

export function getFolderColor(name: string): string {
  const lower = name.toLowerCase();
  return FOLDER_COLORS[lower] || "#64748b";
}

export function getFileAccentColor(filePath: string, rootPath: string): string {
  const rel = filePath.startsWith(rootPath) ? filePath.slice(rootPath.length + 1) : filePath;
  const firstFolder = rel.split("/")[0];
  return getFolderColor(firstFolder);
}

// depth background - each level slightly brighter
function depthBg(depth: number): string {
  if (depth <= 0) return "transparent";
  const alpha = Math.min(depth * 0.025, 0.1);
  return `rgba(255,255,255,${alpha})`;
}

const EXPANDED_KEY = "editor-expanded-folders";

function loadExpanded(workspace: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const saved = localStorage.getItem(`${EXPANDED_KEY}-${workspace}`);
    if (saved) return new Set(JSON.parse(saved));
  } catch {}
  return new Set();
}

function saveExpanded(workspace: string, expanded: Set<string>) {
  try {
    localStorage.setItem(`${EXPANDED_KEY}-${workspace}`, JSON.stringify([...expanded]));
  } catch {}
}

// collect all ancestor folder paths for a file path within a tree
function getAncestorPaths(filePath: string, tree: FileNode[]): string[] {
  const result: string[] = [];
  function walk(nodes: FileNode[], path: string[]): boolean {
    for (const node of nodes) {
      if (node.path === filePath) {
        result.push(...path);
        return true;
      }
      if (node.type === "dir" && node.children) {
        if (walk(node.children, [...path, node.path])) return true;
      }
    }
    return false;
  }
  walk(tree, []);
  return result;
}

export function FileTree({ workspacePath, filterOpen: externalFilterOpen, onFileSelect }: FileTreeProps) {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [initialized, setInitialized] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [panelHeights, setPanelHeights] = useState<Map<string, number>>(new Map());
  const [gitStatus, setGitStatus] = useState<Record<string, string>>({});
  const filterRef = useRef<HTMLInputElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const filterOpen = externalFilterOpen ?? false;

  const activePaneId = useEditorStore((s) => s.activePaneId);
  const panes = useEditorStore((s) => s.panes);
  const openFile = useEditorStore((s) => s.openFile);
  const pinFile = useEditorStore((s) => s.pinFile);
  const setActiveFile = useEditorStore((s) => s.setActiveFile);
  const setFileLoading = useEditorStore((s) => s.setFileLoading);

  const activePane = panes.find((p) => p.id === activePaneId);
  const activeFilePath = activePane?.activePath ?? null;

  // hydrate expanded state from localStorage
  useEffect(() => {
    const saved = loadExpanded(workspacePath);
    if (saved.size > 0) setExpanded(saved);
  }, [workspacePath]);

  // persist expanded state
  useEffect(() => {
    if (initialized) saveExpanded(workspacePath, expanded);
  }, [expanded, workspacePath, initialized]);

  const fetchTree = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/fs/tree?workspace=${encodeURIComponent(workspacePath)}`
      );
      const raw = await res.json();
      if (!res.ok) {
        setError((typeof raw === "object" && raw && "error" in raw && typeof raw.error === "string") ? raw.error : "Failed to load");
        return;
      }
      const data = unwrapApiData<{ tree?: FileNode[] }>(raw);
      setTree(data.tree || []);
      if (!initialized) setInitialized(true);
    } catch {
      setError("Failed to load file tree");
    } finally {
      setLoading(false);
    }
  }, [workspacePath, initialized]);

  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  const toggleExpand = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const collapseAll = useCallback(() => {
    setExpanded(new Set());
  }, []);

  const revealActiveFile = useCallback(() => {
    if (!activeFilePath || tree.length === 0) return;
    const ancestors = getAncestorPaths(activeFilePath, tree);
    if (ancestors.length > 0) {
      setExpanded((prev) => {
        const next = new Set(prev);
        for (const p of ancestors) next.add(p);
        return next;
      });
    }
    // scroll to active file after state update
    requestAnimationFrame(() => {
      const el = treeRef.current?.querySelector('[data-active="true"]');
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }, [activeFilePath, tree]);

  const handleFileClick = useCallback(
    async (node: FileNode) => {
      if (node.type === "dir") {
        toggleExpand(node.path);
        return;
      }

      if (!activePaneId) return;

      const alreadyInPane = activePane?.openPaths.includes(node.path);
      if (alreadyInPane) {
        setActiveFile(activePaneId, node.path);
        onFileSelect?.();
        return;
      }

      openFile(activePaneId, node.path, node.name, node.ext || "", "");
      setFileLoading(node.path, true);
      onFileSelect?.();

      try {
        const res = await fetch(
          `/api/fs/file?path=${encodeURIComponent(node.path)}`
        );
        const raw = await res.json();
        if (res.ok) {
          const data = unwrapApiData<{ content?: string }>(raw);
          openFile(activePaneId, node.path, node.name, node.ext || "", data.content ?? "");
        }
      } catch {
        // leave empty
      } finally {
        setFileLoading(node.path, false);
      }
    },
    [activePaneId, activePane, openFile, setActiveFile, setFileLoading, toggleExpand]
  );

  const handleFileDoubleClick = useCallback(
    (node: FileNode) => {
      if (node.type === "file") pinFile(node.path);
    },
    [pinFile]
  );

  // context menu
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: FileNode; parentPath: string } | null>(null);

  const handleContextMenu = useCallback((e: ReactMouseEvent, node: FileNode, parentPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, node, parentPath });
  }, []);

  // close context menu on click elsewhere or Escape
  useEffect(() => {
    if (!contextMenu) return;
    const onClick = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setContextMenu(null); };
    window.addEventListener("click", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [contextMenu]);

  // inline create state
  const [inlineCreate, setInlineCreate] = useState<{ parentDir: string; type: "file" | "dir" } | null>(null);
  const inlineRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inlineCreate) {
      // focus on next tick after render
      requestAnimationFrame(() => inlineRef.current?.focus());
    }
  }, [inlineCreate]);

  const refreshGitStatus = useCallback(() => {
    if (!workspacePath) return;
    fetch(`/api/fs/git-status?workspace=${encodeURIComponent(workspacePath)}`)
      .then((r) => r.json())
      .then((raw) => {
        const data = unwrapApiData<{ status?: Record<string, string> }>(raw);
        if (data.status) setGitStatus(data.status);
      })
      .catch(() => {});
  }, [workspacePath]);

  // fetch git status on mount
  useEffect(() => {
    refreshGitStatus();
  }, [refreshGitStatus]);

  const commitInlineCreate = useCallback(async (name: string) => {
    if (!inlineCreate || !name.trim()) {
      setInlineCreate(null);
      return;
    }
    const path = `${inlineCreate.parentDir}/${name.trim()}`;
    try {
      await fetch("/api/fs/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, type: inlineCreate.type }) });
      fetchTree();
      refreshGitStatus();
    } catch {}
    setInlineCreate(null);
  }, [inlineCreate, fetchTree, refreshGitStatus]);

  const handleCreateFile = useCallback((parentDir: string) => {
    setInlineCreate({ parentDir, type: "file" });
    setContextMenu(null);
    // expand parent so the input is visible
    if (parentDir !== workspacePath) {
      setExpanded((prev) => new Set([...prev, parentDir]));
    }
  }, [workspacePath]);

  const handleCreateFolder = useCallback((parentDir: string) => {
    setInlineCreate({ parentDir, type: "dir" });
    setContextMenu(null);
    if (parentDir !== workspacePath) {
      setExpanded((prev) => new Set([...prev, parentDir]));
    }
  }, [workspacePath]);

  // inline rename state
  const [inlineRename, setInlineRename] = useState<{ path: string; name: string } | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inlineRename) requestAnimationFrame(() => {
      renameRef.current?.focus();
      // select the name without extension for convenience
      const dot = inlineRename.name.lastIndexOf(".");
      renameRef.current?.setSelectionRange(0, dot > 0 ? dot : inlineRename.name.length);
    });
  }, [inlineRename]);

  const commitRename = useCallback(async (newName: string) => {
    if (!inlineRename || !newName.trim() || newName.trim() === inlineRename.name) {
      setInlineRename(null);
      return;
    }
    const dir = inlineRename.path.slice(0, inlineRename.path.length - inlineRename.name.length);
    const newPath = `${dir}${newName.trim()}`;
    try {
      await fetch("/api/fs/rename", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ oldPath: inlineRename.path, newPath }) });
      fetchTree();
      refreshGitStatus();
    } catch {}
    setInlineRename(null);
  }, [inlineRename, fetchTree, refreshGitStatus]);

  const handleRename = useCallback((oldPath: string, currentName: string) => {
    setInlineRename({ path: oldPath, name: currentName });
    setContextMenu(null);
  }, []);

  // inline delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState<{ path: string; name: string } | null>(null);

  const handleDelete = useCallback((path: string, name: string) => {
    setDeleteConfirm({ path, name });
    setContextMenu(null);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!deleteConfirm) return;
    try {
      await fetch("/api/fs/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: deleteConfirm.path }) });
      fetchTree();
      refreshGitStatus();
    } catch {}
    setDeleteConfirm(null);
  }, [deleteConfirm, fetchTree]);

  // focus filter input when opened
  useEffect(() => {
    if (filterOpen) filterRef.current?.focus();
  }, [filterOpen]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <WaveSpinner size="sm" color="primary" animation="ripple" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-3 py-3 text-xs text-white/30">{error}</div>
    );
  }

  // separate dirs and files at root level
  const dirs = tree.filter((n) => n.type === "dir");
  const files = tree.filter((n) => n.type === "file");

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* filter input - controlled by icon strip */}
      {filterOpen && (
        <div className="px-2 pt-1 pb-1 shrink-0 animate-in slide-in-from-top-1 duration-150">
          <input
            ref={filterRef}
            type="text"
            placeholder="filter..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setSearchQuery(""); }}
            className="w-full h-5 px-2 text-[10px] font-mono bg-white/[0.03] rounded-md text-white/70 placeholder:text-white/20 outline-none shadow-[0_0_0_1px_rgba(255,255,255,0.06)] focus:shadow-[0_0_0_1px_rgba(255,255,255,0.12)] transition-shadow"
          />
        </div>
      )}

      {/* tree toolbar */}
      <div className="flex items-center gap-1 px-2 py-0.5 shrink-0">
        <button
          onClick={() => handleCreateFile(workspacePath)}
          className="flex items-center justify-center w-5 h-5 rounded-sm text-white/25 hover:text-white/50 hover:bg-white/[0.04] transition-colors"
          title="New file"
        >
          <AddFilled className="h-3 w-3" />
        </button>
        <button
          onClick={() => handleCreateFolder(workspacePath)}
          className="flex items-center justify-center w-5 h-5 rounded-sm text-white/25 hover:text-white/50 hover:bg-white/[0.04] transition-colors"
          title="New folder"
        >
          <FolderAddFilled className="h-3 w-3" />
        </button>
        <button
          onClick={collapseAll}
          className="flex items-center justify-center w-5 h-5 rounded-sm text-white/25 hover:text-white/50 hover:bg-white/[0.04] transition-colors"
          title="Collapse all"
        >
          <ArrowDown1Filled className="h-3 w-3 rotate-90" />
        </button>
        {activeFilePath && (
          <button
            onClick={revealActiveFile}
            className="flex items-center justify-center w-5 h-5 rounded-sm text-white/25 hover:text-white/50 hover:bg-white/[0.04] transition-colors"
            title="Reveal active file"
          >
            <LocationCrossFilled className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* accordion folders */}
      <div ref={treeRef} className="flex-1 overflow-y-auto px-1 pb-1">
        {/* inline delete confirmation */}
        {deleteConfirm && (
          <div className="flex items-center gap-1.5 px-2 py-1 mb-0.5 bg-red-500/10 rounded">
            <span className="text-[10px] text-red-400/80 truncate flex-1">delete {deleteConfirm.name}?</span>
            <button
              onClick={confirmDelete}
              className="px-2 py-0.5 text-[10px] font-mono bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 transition-colors"
              autoFocus
            >
              yes
            </button>
            <button
              onClick={() => setDeleteConfirm(null)}
              className="px-2 py-0.5 text-[10px] font-mono text-white/40 rounded hover:bg-white/5 transition-colors"
            >
              no
            </button>
          </div>
        )}

        {/* inline rename input */}
        {inlineRename && (
          <div className="flex items-center gap-1.5 px-2 py-0.5 mb-0.5">
            <span className="text-[10px] text-white/30 shrink-0">rename</span>
            <input
              ref={renameRef}
              type="text"
              defaultValue={inlineRename.name}
              className="flex-1 h-5 px-1.5 text-[11px] font-mono bg-white/[0.06] rounded text-white/80 placeholder:text-white/25 outline-none shadow-[0_0_0_1px_rgba(56,189,248,0.4)] focus:shadow-[0_0_0_1px_rgba(56,189,248,0.6)]"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  commitRename((e.target as HTMLInputElement).value);
                } else if (e.key === "Escape") {
                  setInlineRename(null);
                }
              }}
              onBlur={(e) => commitRename(e.target.value)}
            />
          </div>
        )}

        {/* inline create input */}
        {inlineCreate && (
          <div className="flex items-center gap-1.5 px-2 py-0.5 mb-0.5">
            {inlineCreate.type === "dir" ? (
              <FolderFilled className="h-3 w-3 shrink-0 text-white/40" />
            ) : (
              <span className="w-3 h-3 shrink-0 flex items-center justify-center text-[9px] text-white/40">F</span>
            )}
            <input
              ref={inlineRef}
              type="text"
              placeholder={inlineCreate.type === "dir" ? "folder name..." : "file name..."}
              className="flex-1 h-5 px-1.5 text-[11px] font-mono bg-white/[0.06] rounded text-white/80 placeholder:text-white/25 outline-none shadow-[0_0_0_1px_rgba(56,189,248,0.4)] focus:shadow-[0_0_0_1px_rgba(56,189,248,0.6)]"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  commitInlineCreate((e.target as HTMLInputElement).value);
                } else if (e.key === "Escape") {
                  setInlineCreate(null);
                }
              }}
              onBlur={(e) => {
                // commit on blur if there's a value, otherwise cancel
                const val = e.target.value.trim();
                if (val) {
                  commitInlineCreate(val);
                } else {
                  setInlineCreate(null);
                }
              }}
            />
          </div>
        )}

        {dirs.map((dir) => (
          <AccordionFolder
            key={dir.path}
            node={dir}
            depth={0}
            expanded={expanded}
            activeFilePath={activeFilePath}
            searchQuery={searchQuery}
            panelHeights={panelHeights}
            setPanelHeights={setPanelHeights}
            gitStatus={gitStatus}
            workspacePath={workspacePath}
            onClick={handleFileClick}
            onDoubleClick={handleFileDoubleClick}
            onContextMenu={handleContextMenu}
          />
        ))}

        {/* root-level files */}
        {files.length > 0 && (
          <div className="mt-1">
            {files
              .filter((f) => matchesSearch(f, searchQuery))
              .map((file) => (
                <FileItem
                  key={file.path}
                  node={file}
                  depth={0}
                  isActive={activeFilePath === file.path}
                  gitIndicator={gitStatus[file.path.startsWith(workspacePath) ? file.path.slice(workspacePath.length + 1) : file.path]}
                  onClick={handleFileClick}
                  onDoubleClick={handleFileDoubleClick}
                  onContextMenu={(e) => handleContextMenu(e, file, workspacePath)}
                />
              ))}
          </div>
        )}
      </div>

      {/* context menu - portal to body to avoid transform offset */}
      {contextMenu && createPortal(
        <div
          className="fixed z-[9999] min-w-[140px] py-1 rounded-md bg-[#1a1a1a] shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_8px_24px_rgba(0,0,0,0.5)]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.node.type === "dir" && (
            <>
              <ContextMenuItem label="New file" onClick={() => handleCreateFile(contextMenu.node.path)} />
              <ContextMenuItem label="New folder" onClick={() => handleCreateFolder(contextMenu.node.path)} />
              <div className="h-px mx-2 my-1 bg-white/[0.06]" />
            </>
          )}
          <ContextMenuItem label="Rename" onClick={() => handleRename(contextMenu.node.path, contextMenu.node.name)} />
          <ContextMenuItem label="Delete" onClick={() => handleDelete(contextMenu.node.path, contextMenu.node.name)} danger />
        </div>,
        document.body
      )}
    </div>
  );
}

function ContextMenuItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-1 text-[11px] font-mono transition-colors ${
        danger
          ? "text-red-400/70 hover:text-red-400 hover:bg-red-400/10"
          : "text-white/60 hover:text-white/80 hover:bg-white/[0.06]"
      }`}
    >
      {label}
    </button>
  );
}

function matchesSearch(node: FileNode, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (node.name.toLowerCase().includes(q)) return true;
  if (node.type === "dir" && node.children) {
    return node.children.some((child) => matchesSearch(child, q));
  }
  return false;
}

// ── accordion folder ──

interface AccordionFolderProps {
  node: FileNode;
  depth: number;
  expanded: Set<string>;
  activeFilePath: string | null;
  searchQuery: string;
  panelHeights: Map<string, number>;
  setPanelHeights: React.Dispatch<React.SetStateAction<Map<string, number>>>;
  gitStatus: Record<string, string>;
  workspacePath: string;
  onClick: (node: FileNode) => void;
  onDoubleClick: (node: FileNode) => void;
  onContextMenu: (e: ReactMouseEvent, node: FileNode, parentPath: string) => void;
}

function AccordionFolder({
  node,
  depth,
  expanded,
  activeFilePath,
  searchQuery,
  panelHeights,
  setPanelHeights,
  gitStatus,
  workspacePath,
  onClick,
  onDoubleClick,
  onContextMenu,
}: AccordionFolderProps) {
  const manuallyOpen = expanded.has(node.path);
  const autoExpand = searchQuery.length > 0 && matchesSearch(node, searchQuery);
  const isOpen = manuallyOpen || autoExpand;
  const color = getFolderColor(node.name);
  const childCount = node.children?.length ?? 0;
  const contentRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  if (searchQuery && !matchesSearch(node, searchQuery)) return null;

  const childDirs = node.children?.filter((c) => c.type === "dir") ?? [];
  const childFiles = node.children?.filter((c) => c.type === "file") ?? [];

  // only constrain height on top-level folders (depth 0)
  // nested folders flow naturally within their parent
  const isTopLevel = depth === 0;
  const defaultMaxH = Math.min(Math.max(childCount * 26, 60), 200);
  const maxH = panelHeights.get(node.path) ?? defaultMaxH;

  const handleResizeStart = (e: ReactMouseEvent) => {
    if (!isTopLevel) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { startY: e.clientY, startH: maxH };

    const onMove = (me: globalThis.MouseEvent) => {
      if (!dragRef.current) return;
      const delta = me.clientY - dragRef.current.startY;
      const newH = Math.max(40, dragRef.current.startH + delta);
      setPanelHeights((prev) => {
        const next = new Map(prev);
        next.set(node.path, newH);
        return next;
      });
    };

    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  return (
    <div className="mb-0.5">
      {/* folder header */}
      <button
        onClick={() => onClick(node)}
        onContextMenu={(e) => onContextMenu(e, node, node.path)}
        className="flex items-center gap-2 w-full px-2 py-0.5 rounded-md transition-all hover:bg-white/[0.04] group"
        style={{ paddingLeft: 8 }}
      >
        <span className="shrink-0" style={{ color }}>
          {isOpen
            ? <FolderOpenFilled className="h-3.5 w-3.5" />
            : <FolderFilled className="h-3.5 w-3.5" />
          }
        </span>
        <span className="text-[11px] font-mono truncate text-white/60 group-hover:text-white/80 transition-colors">
          {node.name}
        </span>
        <span className="text-[9px] font-mono text-white/15 ml-auto shrink-0">{childCount}</span>
      </button>

      {/* expanded content */}
      {isOpen && (
        <div className="mx-1 mt-0.5">
          <div
            ref={contentRef}
            className={isTopLevel ? "overflow-y-auto overflow-x-hidden rounded-t-md" : "overflow-x-hidden"}
            style={{
              ...(isTopLevel ? { maxHeight: maxH } : {}),
              background: depthBg(depth + 1),
            }}
          >
            {childDirs.map((dir) => (
              <AccordionFolder
                key={dir.path}
                node={dir}
                depth={depth + 1}
                expanded={expanded}
                activeFilePath={activeFilePath}
                searchQuery={searchQuery}
                panelHeights={panelHeights}
                setPanelHeights={setPanelHeights}
                gitStatus={gitStatus}
                workspacePath={workspacePath}
                onClick={onClick}
                onDoubleClick={onDoubleClick}
                onContextMenu={onContextMenu}
              />
            ))}
            {childFiles
              .filter((f) => matchesSearch(f, searchQuery))
              .map((file) => (
                <FileItem
                  key={file.path}
                  node={file}
                  depth={depth + 1}
                  isActive={activeFilePath === file.path}
                  gitIndicator={gitStatus[file.path.startsWith(workspacePath) ? file.path.slice(workspacePath.length + 1) : file.path]}
                  onClick={onClick}
                  onDoubleClick={onDoubleClick}
                  onContextMenu={(e) => onContextMenu(e, file, node.path)}
                />
              ))}
          </div>
          {/* resize handle - only for top-level folders */}
          {isTopLevel && (
            <div
              onMouseDown={handleResizeStart}
              className="h-1.5 cursor-row-resize rounded-b-md flex items-center justify-center hover:bg-white/[0.06] transition-colors"
            >
              <div className="w-8 h-px" style={{ background: "rgba(255,255,255,0.15)" }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── file item ──

const GIT_STATUS_COLORS: Record<string, string> = {
  M: "#e5a50a",  // modified - amber
  A: "#22c55e",  // added - green
  D: "#ef4444",  // deleted - red
  "?": "#6b7280", // untracked - gray
  R: "#3b82f6",  // renamed - blue
};

interface FileItemProps {
  node: FileNode;
  depth: number;
  isActive: boolean;
  gitIndicator?: string;
  onClick: (node: FileNode) => void;
  onDoubleClick: (node: FileNode) => void;
  onContextMenu?: (e: ReactMouseEvent) => void;
}

function FileItem({ node, isActive, gitIndicator, onClick, onDoubleClick, onContextMenu }: FileItemProps) {
  const gitColor = gitIndicator ? GIT_STATUS_COLORS[gitIndicator] : undefined;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onClick(node)}
      onDoubleClick={() => onDoubleClick(node)}
      onContextMenu={onContextMenu}
      onKeyDown={(e) => { if (e.key === "Enter") onClick(node); }}
      data-active={isActive || undefined}
      className={`flex items-center gap-1.5 py-1 px-2 cursor-pointer transition-all relative rounded-sm ${
        isActive ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"
      }`}
      style={{ paddingLeft: 8 }}
    >
      {isActive && (
        <span className="absolute left-0.5 top-1.5 bottom-1.5 w-[2px] rounded-r bg-[rgba(39,201,63,0.5)]" />
      )}
      <span className="shrink-0">
        <FileTypeIcon ext={node.ext || ""} size="xs" />
      </span>
      <span
        className={`text-[11px] font-mono truncate ${isActive ? "text-white/80" : "text-white/55"}`}
        style={gitColor ? { color: gitColor } : undefined}
      >
        {node.name}
      </span>
      {gitIndicator && (
        <span
          className="text-[8px] font-mono ml-auto shrink-0 font-bold"
          style={{ color: gitColor }}
        >
          {gitIndicator}
        </span>
      )}
    </div>
  );
}
