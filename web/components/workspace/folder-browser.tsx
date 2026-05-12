"use client";

import { useState, useEffect } from "react";
import {
  HomeFilled as Home,
  ArrowRight2Filled as ChevronRight,
  ArrowLeft1Filled as ArrowLeft,
  FolderOpenFilled as FolderOpen,
  FolderAddFilled as FolderPlus,
  CloseCircleFilled as X,
  ArrowSwapFilled as ArrowUpDown,
  TrashFilled as Trash
} from "@aliimam/icons";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { getApiErrorMessage } from "@/lib/api-client";

interface DirEntry {
  name: string;
  mtime: number;
}

interface BrowseResult {
  path: string;
  parent: string | null;
  dirs: DirEntry[];
}

type SortKey = "name" | "date";
type SortDir = "asc" | "desc";

interface FolderBrowserProps {
  onSelect: (path: string) => void;
  initialPath?: string;
  defaultSortKey?: SortKey;
  defaultSortDir?: SortDir;
}

function formatDate(ms: number) {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function FolderBrowser({
  onSelect,
  initialPath,
  defaultSortKey = "name",
  defaultSortDir = "asc",
}: FolderBrowserProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [result, setResult] = useState<BrowseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>(defaultSortKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultSortDir);
  const [deleteConfirm, setDeleteConfirm] = useState<{ path: string; name: string; status: "confirm" | "not-empty" | "deleting" } | null>(null);

  const browse = async (p?: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetchWithNamespace(`/api/fs/browse${p ? `?path=${encodeURIComponent(p)}` : ""}`);
      const raw = await res.json();
      if (!res.ok) { setError(getApiErrorMessage(raw, "failed")); return; }
      const data = (raw.data ?? raw) as BrowseResult;
      setResult(data);
      setShowNewFolder(false);
      setNewFolderName("");
      setDeleteConfirm(null);
    } catch { setError("failed to browse"); }
    finally { setLoading(false); }
  };

  const createFolder = async () => {
    if (!result || !newFolderName.trim()) return;
    setCreatingFolder(true);
    setError("");
    try {
      const res = await fetchWithNamespace("/api/fs/mkdir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parent: result.path, name: newFolderName.trim() }),
      });
      const raw = await res.json();
      if (!res.ok) { setError(getApiErrorMessage(raw, "failed to create folder")); return; }
      const data = (raw.data ?? raw) as { path?: string };
      await browse(data.path);
    } catch { setError("failed to create folder"); }
    finally { setCreatingFolder(false); }
  };

  const deleteFolder = async (folderPath: string, name: string, force?: boolean) => {
    setDeleteConfirm({ path: folderPath, name, status: "deleting" });
    setError("");
    try {
      const res = await fetchWithNamespace("/api/fs/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: folderPath, ...(force && { force: true }) }),
      });
      if (!res.ok) {
        let msg = "";
        try {
          const raw = await res.json();
          msg = getApiErrorMessage(raw, "");
        } catch (jsonErr) {
          // fetchWithNamespace wraps json() with unwrapApiData which throws on errors
          msg = jsonErr instanceof Error ? jsonErr.message : String(jsonErr);
        }
        if (msg.toLowerCase().includes("not empty")) {
          setDeleteConfirm({ path: folderPath, name, status: "not-empty" });
          return;
        }
        setDeleteConfirm(null);
        setError(msg || "failed to delete folder");
        return;
      }
      setDeleteConfirm(null);
      await browse(result?.path);
    } catch (err) {
      // check if the error message itself indicates non-empty
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.toLowerCase().includes("not empty")) {
        setDeleteConfirm({ path: folderPath, name, status: "not-empty" });
        return;
      }
      setDeleteConfirm(null);
      setError(errMsg || "failed to delete folder");
    }
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      setSortDir(key === "date" ? "desc" : "asc");
    }
  };

  const sorted = result?.dirs.slice().sort((a, b) => {
    const mul = sortDir === "asc" ? 1 : -1;
    if (sortKey === "name") return mul * a.name.localeCompare(b.name);
    return mul * (a.mtime - b.mtime) || a.name.localeCompare(b.name);
  }) ?? [];

  useEffect(() => { browse(initialPath); }, [initialPath]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mt-2 border border-muted rounded-md overflow-hidden">
      <div className="flex items-center gap-1 px-2 py-1.5 bg-muted/50 border-b border-muted">
        <button type="button" onClick={() => browse(initialPath)} className="text-foreground/40 hover:text-foreground transition-colors shrink-0">
          <Home className="h-3 w-3" />
        </button>
        {result && result.path.split("/").filter(Boolean).map((seg, i, arr) => {
          const full = "/" + arr.slice(0, i + 1).join("/");
          const isLast = i === arr.length - 1;
          return (
            <span key={full} className="flex items-center gap-1">
              <ChevronRight className="h-2.5 w-2.5 text-foreground/20 shrink-0" />
              <button type="button" onClick={() => !isLast && browse(full)}
                className={`text-[10px] font-mono truncate max-w-[80px] transition-colors ${isLast ? "text-foreground/70" : "text-foreground/40 hover:text-foreground"}`}>
                {seg}
              </button>
            </span>
          );
        })}
        {loading && <span className="ml-auto text-[10px] text-foreground/30">loading...</span>}
        {!loading && result && (
          <button type="button" onClick={() => setShowNewFolder((v) => !v)}
            className="ml-auto text-foreground/30 hover:text-foreground transition-colors shrink-0"
            title="New folder">
            <FolderPlus className="h-3 w-3" />
          </button>
        )}
      </div>
      {showNewFolder && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 bg-muted/30 border-b border-muted">
          <FolderPlus className="h-3 w-3 text-foreground/30 shrink-0" />
          <input
            className="flex-1 bg-transparent text-xs font-mono outline-none placeholder:text-foreground/20"
            placeholder="folder name"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") createFolder(); if (e.key === "Escape") setShowNewFolder(false); }}
            autoFocus
          />
          <button type="button" onClick={createFolder} disabled={creatingFolder || !newFolderName.trim()}
            className="text-[10px] px-1.5 py-0.5 rounded bg-accent hover:bg-accent/80 text-foreground transition-colors disabled:opacity-30">
            {creatingFolder ? "..." : "create"}
          </button>
          <button type="button" onClick={() => { setShowNewFolder(false); setNewFolderName(""); }}
            className="text-foreground/30 hover:text-foreground transition-colors">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
      {result && sorted.length > 0 && (
        <div className="flex items-center px-3 py-1 bg-muted/20 border-b border-muted">
          <button type="button" onClick={() => toggleSort("name")}
            className={`flex items-center gap-1 text-[10px] transition-colors ${sortKey === "name" ? "text-foreground/70" : "text-foreground/30 hover:text-foreground/60"}`}>
            sort by name {sortKey === "name" && <span className="font-mono">{sortDir === "asc" ? "A-Z" : "Z-A"}</span>}
          </button>
          <button type="button" onClick={() => toggleSort("date")}
            className={`flex items-center gap-1 ml-auto text-[10px] transition-colors ${sortKey === "date" ? "text-foreground/70" : "text-foreground/30 hover:text-foreground/60"}`}>
            <ArrowUpDown className="h-2.5 w-2.5" />
            sort by date {sortKey === "date" && <span className="font-mono">{sortDir === "desc" ? "newest" : "oldest"}</span>}
          </button>
        </div>
      )}
      <div className="max-h-48 overflow-y-auto">
        {error && <p className="px-3 py-2 text-xs text-red-400">{error}</p>}
        {result && (
          <>
            {result.parent && (
              <button type="button" onClick={() => browse(result.parent!)}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-foreground/40 hover:bg-muted hover:text-foreground transition-colors">
                <ArrowLeft className="h-3 w-3 shrink-0" /><span className="font-mono">..</span>
              </button>
            )}
            {sorted.length === 0 && !showNewFolder && <p className="px-3 py-2 text-xs text-foreground/30">no subdirectories</p>}
            {sorted.map(({ name, mtime }) => {
              const full = `${result.path}/${name}`;
              const dc = deleteConfirm?.path === full ? deleteConfirm : null;
              return dc ? (
                <div key={name} className="px-3 py-1.5 bg-red-500/10">
                  {dc.status === "deleting" ? (
                    <span className="text-[10px] text-red-400/60 font-mono">deleting...</span>
                  ) : dc.status === "not-empty" ? (
                    <div className="space-y-1">
                      <span className="text-[10px] text-red-400 font-mono block">{name} is not empty</span>
                      <div className="flex items-center gap-1.5">
                        <button type="button" onClick={() => deleteFolder(full, name, true)}
                          className="px-2 py-0.5 text-[10px] font-mono bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 transition-colors">
                          delete anyway
                        </button>
                        <button type="button" onClick={() => { setDeleteConfirm(null); browse(full); }}
                          className="px-2 py-0.5 text-[10px] font-mono text-foreground/50 rounded hover:bg-foreground/5 transition-colors">
                          open folder
                        </button>
                        <button type="button" onClick={() => setDeleteConfirm(null)}
                          className="px-2 py-0.5 text-[10px] font-mono text-foreground/40 rounded hover:bg-foreground/5 transition-colors">
                          dismiss
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-red-400/80 truncate flex-1 font-mono">delete {name}?</span>
                      <button type="button" onClick={() => deleteFolder(full, name)}
                        className="px-2 py-0.5 text-[10px] font-mono bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 transition-colors">
                        yes
                      </button>
                      <button type="button" onClick={() => setDeleteConfirm(null)}
                        className="px-2 py-0.5 text-[10px] font-mono text-foreground/40 rounded hover:bg-foreground/5 transition-colors">
                        no
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div key={name} className="flex items-center group">
                  <button type="button" onClick={() => browse(full)}
                    className="flex items-center gap-2 flex-1 px-3 py-1.5 text-xs text-foreground/70 hover:bg-muted hover:text-foreground transition-colors min-w-0">
                    <FolderOpen className="h-3 w-3 shrink-0 text-foreground/30" />
                    <span className="font-mono truncate">{name}</span>
                    <span className="ml-auto text-[10px] text-foreground/30 shrink-0 pl-2">{formatDate(mtime)}</span>
                  </button>
                  <button type="button" onClick={() => setDeleteConfirm({ path: full, name, status: "confirm" })}
                    className="opacity-0 group-hover:opacity-100 px-2 py-1.5 text-foreground/20 hover:text-red-400 transition-all shrink-0"
                    title="Delete folder">
                    <Trash className="h-3 w-3" />
                  </button>
                  <button type="button" onClick={() => onSelect(full)}
                    className="opacity-0 group-hover:opacity-100 px-2 py-1.5 text-[10px] text-foreground/40 hover:text-foreground transition-all shrink-0">
                    select
                  </button>
                </div>
              );
            })}
          </>
        )}
      </div>
      {result && (
        <div className="px-2 py-1.5 border-t border-muted bg-muted/30 flex items-center justify-between">
          <span className="text-[10px] font-mono text-foreground/40 truncate">{result.path}</span>
          <button type="button" onClick={() => onSelect(result.path)}
            className="ml-2 shrink-0 text-[10px] px-2 py-0.5 rounded bg-accent hover:bg-accent/80 text-foreground transition-colors">
            select this folder
          </button>
        </div>
      )}
    </div>
  );
}
