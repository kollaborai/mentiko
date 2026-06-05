"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { useEditorStore } from "@/lib/ui/editor-store";
import { SearchNormalFilled } from "@aliimam/icons";
import { WaveSpinner } from "@/components/ui/wave-spinner";

export interface SearchResult {
  path: string;
  name: string;
  line: number;
  column: number;
  text: string;
  context: string;
}

interface SearchPanelProps {
  workspacePath: string;
}

export function SearchPanel({ workspacePath }: SearchPanelProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [regex, setRegex] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const activePaneId = useEditorStore((s) => s.activePaneId);
  const openFile = useEditorStore((s) => s.openFile);
  const pinFile = useEditorStore((s) => s.pinFile);
  const setFileLoading = useEditorStore((s) => s.setFileLoading);
  const setPendingReveal = useEditorStore((s) => s.setPendingReveal);

  // auto-focus when opened
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const doSearch = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const url = `/api/fs/search?workspace=${encodeURIComponent(workspacePath)}&query=${encodeURIComponent(q)}&regex=${regex}`;
      const res = await fetch(url);
      const raw = await res.json();
      if (res.ok) {
        const data = raw as { results?: SearchResult[] };
        if (data.results) setResults(data.results);
      }
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [workspacePath, regex]);

  // debounce search
  useEffect(() => {
    if (!query || query.length < 2) {
      setResults([]);
      return;
    }

    const timer = setTimeout(() => {
      doSearch(query);
    }, 300);

    return () => clearTimeout(timer);
  }, [query, regex, doSearch]);

  const handleResultClick = useCallback(
    async (result: SearchResult) => {
      if (!activePaneId) return;

      const ext = result.name.includes(".")
        ? result.name.slice(result.name.lastIndexOf("."))
        : "";

      // construct full path from relative path
      const fullPath = result.path.startsWith("/")
        ? result.path
        : `${workspacePath}/${result.path}`;

      // set loading state
      openFile(activePaneId, fullPath, result.name, ext, "");
      pinFile(fullPath);
      setFileLoading(fullPath, true);

      try {
        const res = await fetchWithNamespace(`/api/fs/file?path=${encodeURIComponent(fullPath)}`);
        const raw = await res.json();
        if (res.ok) {
          const data = raw as { content?: string };
          openFile(activePaneId, fullPath, result.name, ext, data.content ?? "");
          // trigger reveal after file loads
          setPendingReveal({ path: fullPath, line: result.line, column: result.column });
        }
      } catch {
        // silent
      } finally {
        setFileLoading(fullPath, false);
      }
    },
    [activePaneId, workspacePath, openFile, pinFile, setFileLoading, setPendingReveal, fetchWithNamespace]
  );

  // group results by file
  const grouped = results.reduce((acc, r) => {
    if (!acc[r.path]) acc[r.path] = [];
    acc[r.path].push(r);
    return acc;
  }, {} as Record<string, SearchResult[]>);

  const fileCount = Object.keys(grouped).length;
  const resultCount = results.length;

  // highlight matches in text
  const highlightMatch = (text: string, q: string) => {
    if (!q) return text;
    try {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = regex ? new RegExp(q, "gi") : new RegExp(escaped, "gi");
      const parts = text.split(pattern);
      const matches = text.match(pattern);
      const result: ReactNode[] = [];
      let i = 0;
      for (const part of parts) {
        if (part) result.push(part);
        if (matches && matches[i]) {
          result.push(
            <mark key={i} className="text-foreground bg-accent/50 rounded-sm">
              {matches[i]}
            </mark>
          );
          i++;
        }
      }
      return result;
    } catch {
      return text;
    }
  };

  return (
    <div className="flex flex-col h-full bg-muted">
      {/* search input */}
      <div className="flex items-center gap-2 px-3 py-2 shrink-0">
        <SearchNormalFilled className="h-3.5 w-3.5 text-foreground/30 shrink-0" />
        <input
          ref={inputRef}
          type="text"
          placeholder="search in files..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 bg-muted text-xs text-foreground placeholder:text-foreground/30 outline-none font-mono"
        />
        <button
          onClick={() => setRegex((v) => !v)}
          className={`text-[10px] px-1.5 py-0.5 rounded-sm transition-colors shrink-0 ${
            regex
              ? "bg-accent text-foreground"
              : "bg-transparent text-foreground/30 hover:text-foreground/50"
          }`}
        >
          .*
        </button>
        {loading && <WaveSpinner size="xs" color="muted" animation="ripple" />}
      </div>

      {/* results */}
      <div className="flex-1 overflow-y-auto">
        {query.length < 2 ? (
          <div className="px-3 py-4 text-xs text-foreground/30 text-center">
            type at least 2 characters
          </div>
        ) : loading && results.length === 0 ? (
          <div className="px-3 py-4 flex justify-center">
            <WaveSpinner size="sm" color="muted" animation="ripple" />
          </div>
        ) : resultCount === 0 ? (
          <div className="px-3 py-4 text-xs text-foreground/30 text-center">
            no results found
          </div>
        ) : (
          <>
            {/* result count header */}
            <div className="px-3 py-1.5 text-[10px] text-foreground/40 font-mono">
              {resultCount} result{resultCount !== 1 ? "s" : ""} in {fileCount} file{fileCount !== 1 ? "s" : ""}
            </div>

            {/* grouped results */}
            {Object.entries(grouped).map(([filePath, fileResults]) => (
              <div key={filePath}>
                {/* file header */}
                <div
                  className="px-3 py-1 bg-accent/20 text-[10px] text-foreground/50 font-mono truncate cursor-pointer hover:bg-accent/30 transition-colors"
                  onClick={() => fileResults[0] && handleResultClick(fileResults[0])}
                >
                  {filePath}
                </div>

                {/* file results */}
                {fileResults.map((r, idx) => (
                  <div
                    key={idx}
                    onClick={() => handleResultClick(r)}
                    className="px-3 py-1 text-xs font-mono hover:bg-accent transition-colors cursor-pointer border-l-2 border-transparent hover:border-foreground/20 overflow-hidden"
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-foreground/30 shrink-0 select-none">
                        {r.line}
                      </span>
                      <span className="flex-1 text-foreground/70 overflow-hidden text-ellipsis whitespace-nowrap block">
                        {highlightMatch(r.text, query)}
                      </span>
                    </div>
                    {r.context && (
                      <div className="ml-4 mt-0.5 text-foreground/30 text-[11px] overflow-hidden text-ellipsis">
                        {r.context}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
