"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useEditorStore } from "@/lib/editor-store";
import { unwrapApiData } from "@/lib/api-client";

interface FlatFile {
  name: string;
  path: string;
  ext: string;
  relativePath: string;
}

function flattenTree(
  nodes: Array<{ name: string; path: string; type: string; children?: unknown[]; ext?: string }>,
  rootPath: string
): FlatFile[] {
  const result: FlatFile[] = [];
  function walk(items: typeof nodes) {
    for (const node of items) {
      if (node.type === "file") {
        const rel = node.path.startsWith(rootPath)
          ? node.path.slice(rootPath.length + 1)
          : node.path;
        result.push({
          name: node.name,
          path: node.path,
          ext: (node.ext as string) || "",
          relativePath: rel,
        });
      }
      if (node.type === "dir" && Array.isArray(node.children)) {
        walk(node.children as typeof nodes);
      }
    }
  }
  walk(nodes);
  return result;
}

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

interface QuickOpenProps {
  open: boolean;
  onClose: () => void;
  workspacePath: string;
}

export function QuickOpen({ open, onClose, workspacePath }: QuickOpenProps) {
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<FlatFile[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const activePaneId = useEditorStore((s) => s.activePaneId);
  const openFile = useEditorStore((s) => s.openFile);
  const pinFile = useEditorStore((s) => s.pinFile);
  const setFileLoading = useEditorStore((s) => s.setFileLoading);

  useEffect(() => {
    if (!open || !workspacePath) return;
    setQuery("");
    setSelectedIndex(0);
    fetch(`/api/fs/tree?workspace=${encodeURIComponent(workspacePath)}`)
      .then((r) => r.json())
      .then((raw) => {
        const data = unwrapApiData<{ tree?: Array<{ name: string; path: string; type: string; children?: unknown[]; ext?: string }> }>(raw);
        if (data.tree) setFiles(flattenTree(data.tree, workspacePath));
      })
      .catch(() => {});
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open, workspacePath]);

  const filtered = query
    ? files.filter((f) => fuzzyMatch(query, f.relativePath))
    : files;

  const handleSelect = useCallback(
    async (file: FlatFile) => {
      if (!activePaneId) return;
      onClose();
      openFile(activePaneId, file.path, file.name, file.ext, "");
      pinFile(file.path);
      setFileLoading(file.path, true);
      try {
        const res = await fetch(
          `/api/fs/file?path=${encodeURIComponent(file.path)}`
        );
        const raw = await res.json();
        if (res.ok) {
          const data = unwrapApiData<{ content?: string }>(raw);
          openFile(activePaneId, file.path, file.name, file.ext, data.content ?? "");
        }
      } catch {
        // silent
      } finally {
        setFileLoading(file.path, false);
      }
    },
    [onClose, activePaneId, openFile, pinFile, setFileLoading]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" && filtered[selectedIndex]) {
        handleSelect(filtered[selectedIndex]);
        return;
      }
    },
    [onClose, filtered, selectedIndex, handleSelect]
  );

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={onClose}
    >
      <div
        className="w-[560px] max-h-[400px] bg-card rounded-md overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          placeholder="type to search files..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedIndex(0);
          }}
          onKeyDown={handleKeyDown}
          className="w-full h-10 px-4 text-sm bg-card text-foreground placeholder:text-foreground/30 outline-none"
        />
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto"
        >
          {filtered.slice(0, 50).map((file, i) => (
            <div
              key={file.path}
              role="button"
              tabIndex={0}
              onClick={() => handleSelect(file)}
              onMouseEnter={() => setSelectedIndex(i)}
              className={`flex items-center gap-3 px-4 py-1.5 cursor-pointer transition-colors ${
                i === selectedIndex ? "bg-accent" : ""
              }`}
            >
              <FileTypeIcon ext={file.ext} />
              <div className="flex items-baseline gap-2 min-w-0">
                <span className="text-sm text-foreground truncate">
                  {file.name}
                </span>
                <span className="text-[11px] text-foreground/30 font-mono truncate">
                  {file.relativePath}
                </span>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="px-4 py-6 text-xs text-foreground/30 text-center">
              no files found
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const EXT_COLORS: Record<string, string> = {
  ".ts": "text-blue-400",
  ".tsx": "text-blue-400",
  ".js": "text-yellow-400",
  ".jsx": "text-yellow-400",
  ".mjs": "text-yellow-400",
  ".json": "text-amber-300",
  ".yaml": "text-rose-300",
  ".yml": "text-rose-300",
  ".md": "text-foreground/50",
  ".mdx": "text-foreground/50",
  ".css": "text-purple-400",
  ".scss": "text-pink-400",
  ".html": "text-orange-400",
  ".py": "text-green-400",
  ".go": "text-cyan-400",
  ".rs": "text-orange-300",
  ".sh": "text-green-300",
  ".bash": "text-green-300",
  ".sql": "text-sky-300",
  ".svg": "text-amber-400",
};

const EXT_LABELS: Record<string, string> = {
  ".ts": "TS",
  ".tsx": "TX",
  ".js": "JS",
  ".jsx": "JX",
  ".json": "{}",
  ".yaml": "YM",
  ".yml": "YM",
  ".md": "MD",
  ".css": "CS",
  ".py": "PY",
  ".go": "GO",
  ".rs": "RS",
  ".sh": "SH",
  ".html": "<>",
  ".sql": "SQ",
};

export function FileTypeIcon({ ext, size = "sm" }: { ext: string; size?: "sm" | "xs" }) {
  const color = EXT_COLORS[ext] || "text-foreground/30";
  const label = EXT_LABELS[ext] || "";
  const dim = size === "sm" ? "w-4 h-4" : "w-3.5 h-3.5";
  const fontSize = size === "sm" ? "text-[7px]" : "text-[6px]";

  if (label) {
    return (
      <span
        className={`${dim} flex items-center justify-center shrink-0 ${color} ${fontSize} font-bold leading-none`}
      >
        {label}
      </span>
    );
  }

  return (
    <span className={`${dim} flex items-center justify-center shrink-0 ${color}`}>
      <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
        <path d="M3 1h7l4 4v10H3V1zm7 0v4h4" />
      </svg>
    </span>
  );
}
