"use client";

import dynamic from "next/dynamic";
import { useEditorStore, usePane, isDirty } from "@/lib/ui/editor-store";
import { useCallback, useEffect, useRef, useState } from "react";
import { getApiErrorMessage } from "@/lib/api/api-client";
import { WaveSpinner } from "@/components/ui/wave-spinner";
import { StatusBar } from "./status-bar";
import { getFileAccentColor } from "./file-tree";
import { Markdown } from "@/components/ui/markdown";
import type { editor } from "monaco-editor";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full">
      <WaveSpinner size="sm" color="primary" animation="ripple" />
    </div>
  ),
});

const MonacoDiffEditor = dynamic(
  () => import("@monaco-editor/react").then((mod) => ({ default: mod.DiffEditor })),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full">
        <WaveSpinner size="sm" color="primary" animation="ripple" />
      </div>
    ),
  },
);

function defineVoidTheme(monaco: typeof import("monaco-editor"), accent: string) {
  const hexToRgb = (hex: string) => {
    const h = hex.replace('#', '');
    return {
      r: parseInt(h.substring(0, 2), 16),
      g: parseInt(h.substring(2, 4), 16),
      b: parseInt(h.substring(4, 6), 16),
    };
  };
  const rgb = hexToRgb(accent);
  const a = (alpha: number) => {
    const r = Math.round(rgb.r * alpha + 14 * (1 - alpha));
    const g = Math.round(rgb.g * alpha + 14 * (1 - alpha));
    const b = Math.round(rgb.b * alpha + 20 * (1 - alpha));
    return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
  };

  monaco.editor.defineTheme("mentiko-void", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "4a4a55", fontStyle: "italic" },
      { token: "string", foreground: "e8b661" },
      { token: "keyword", foreground: "7eb8da" },
      { token: "number", foreground: "6dd4c8" },
      { token: "type", foreground: "7eb8da" },
      { token: "function", foreground: "e0e0e8" },
      { token: "variable", foreground: "c8c8d0" },
      { token: "operator", foreground: "ffffff66" },
      { token: "delimiter", foreground: "ffffff40" },
    ],
    colors: {
      "editor.background": "#0a0a0a",
      "editor.foreground": "#d4d4d4",
      "editor.lineHighlightBackground": a(0.06),
      "editor.selectionBackground": a(0.22),
      "editor.selectionHighlightBackground": a(0.10),
      "editor.inactiveSelectionBackground": a(0.08),
      "editorCursor.foreground": accent + "e0",
      "editorLineNumber.foreground": "#ffffff12",
      "editorLineNumber.activeForeground": accent + "80",
      "editorGutter.background": "#0a0a0a",
      "minimap.background": "#080808",
      "minimapSlider.background": accent + "18",
      "minimapSlider.hoverBackground": accent + "30",
      "minimapSlider.activeBackground": accent + "40",
      "scrollbar.shadow": "#00000000",
      "editorOverviewRuler.border": "#00000000",
      "editor.rangeHighlightBackground": a(0.04),
      "editorBracketMatch.background": a(0.12),
      "editorBracketMatch.border": accent + "30",
      "editorIndentGuide.background": "#ffffff08",
      "editorIndentGuide.activeBackground": "#ffffff15",
      "editorWidget.background": "#0a0a0a",
      "editorWidget.border": "#ffffff10",
      "input.background": "#080808",
      "input.border": "#ffffff10",
      "list.activeSelectionBackground": a(0.15),
      "list.hoverBackground": a(0.08),
    },
  });
}

const EXT_TO_LANG: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".js": "javascript",
  ".jsx": "javascriptreact",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".json": "json",
  ".jsonl": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".md": "markdown",
  ".mdx": "markdown",
  ".css": "css",
  ".scss": "scss",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".rb": "ruby",
  ".html": "html",
  ".svg": "xml",
  ".xml": "xml",
  ".sql": "sql",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".toml": "ini",
  ".ini": "ini",
  ".conf": "ini",
  ".txt": "plaintext",
};

interface EditorPaneProps {
  paneId: string;
  rootPath: string;
}

export function EditorPane({ paneId, rootPath }: EditorPaneProps) {
  const { activeFile, pane } = usePane(paneId);
  const updateContent = useEditorStore((s) => s.updateContent);
  const markSaved = useEditorStore((s) => s.markSaved);
  const closeFileAction = useEditorStore((s) => s.closeFile);
  const setActiveFileAction = useEditorStore((s) => s.setActiveFile);
  const pendingReveal = useEditorStore((s) => s.pendingReveal);
  const setPendingReveal = useEditorStore((s) => s.setPendingReveal);
  const editorConfig = useEditorStore((s) => s.editorConfig);

  const file = activeFile;

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [cursorLine, setCursorLine] = useState(1);
  const [cursorColumn, setCursorColumn] = useState(1);
  const [selectionLength, setSelectionLength] = useState(0);
  const [mdPreview, setMdPreview] = useState(true);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import("monaco-editor") | null>(null);

  const isMarkdown = file ? (file.ext === ".md" || file.ext === ".mdx") : false;

  // reset to preview mode when switching to a markdown file
  const prevPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (file && file.path !== prevPathRef.current) {
      prevPathRef.current = file.path;
      const isMd = file.ext === ".md" || file.ext === ".mdx";
      setMdPreview(isMd);
    }
  }, [file]);

  const accent = file ? getFileAccentColor(file.path, rootPath) : "#64748b";

  const handleBeforeMount = useCallback((monaco: typeof import("monaco-editor")) => {
    monacoRef.current = monaco;
    defineVoidTheme(monaco, accent);
  }, [accent]);

  // re-define theme when accent changes
  useEffect(() => {
    if (monacoRef.current) {
      defineVoidTheme(monacoRef.current, accent);
    }
  }, [accent]);

  const handleSave = useCallback(async () => {
    if (!file || !isDirty(file)) return;
    setSaving(true);
    setSaveError("");
    try {
      const res = await fetch(
        `/api/fs/file?path=${encodeURIComponent(file.path)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: file.content }),
        }
      );
      const raw = await res.json();
      if (res.ok) {
        markSaved(file.path, file.content);
        setSaveError("");
      } else {
        setSaveError(getApiErrorMessage(raw, "save failed"));
      }
    } catch {
      setSaveError("save failed");
    } finally {
      setSaving(false);
    }
  }, [file, markSaved]);

  // keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      // cmd+s save
      if (mod && e.key === "s") {
        e.preventDefault();
        handleSave();
        return;
      }

      // cmd+w close active tab
      if (mod && e.key === "w") {
        e.preventDefault();
        if (file?.path) {
          if (isDirty(file) && !window.confirm(`Discard unsaved changes to ${file.name}?`)) return;
          closeFileAction(paneId, file.path);
        }
        return;
      }

      // cmd+shift+[ previous tab
      if (mod && e.shiftKey && e.key === "[") {
        e.preventDefault();
        if (!pane) return;
        const idx = pane.openPaths.indexOf(file?.path ?? "");
        if (idx > 0) setActiveFileAction(paneId, pane.openPaths[idx - 1]);
        return;
      }

      // cmd+shift+] next tab
      if (mod && e.shiftKey && e.key === "]") {
        e.preventDefault();
        if (!pane) return;
        const idx = pane.openPaths.indexOf(file?.path ?? "");
        if (idx < pane.openPaths.length - 1) setActiveFileAction(paneId, pane.openPaths[idx + 1]);
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave, file, closeFileAction, setActiveFileAction, pane, paneId]);

  const handleEditorMount = useCallback(
    (editorInstance: editor.IStandaloneCodeEditor) => {
      editorRef.current = editorInstance;
      editorInstance.onDidChangeCursorPosition((e) => {
        setCursorLine(e.position.lineNumber);
        setCursorColumn(e.position.column);
      });
      editorInstance.onDidChangeCursorSelection(() => {
        const sel = editorInstance.getSelection();
        if (sel) {
          const text = editorInstance.getModel()?.getValueInRange(sel) ?? "";
          setSelectionLength(text.length);
        }
      });

      // check for pending reveal on mount
      if (pendingReveal && file && pendingReveal.path === file.path) {
        editorInstance.revealLineInCenter(pendingReveal.line);
        editorInstance.setPosition({
          lineNumber: pendingReveal.line,
          column: pendingReveal.column,
        });
        setPendingReveal(null);
      }
    },
    [file, pendingReveal, setPendingReveal]
  );

  // handle pending reveal when switching tabs (file path changes)
  useEffect(() => {
    if (!pendingReveal || !file || pendingReveal.path !== file.path) return;
    if (!editorRef.current) return;

    editorRef.current.revealLineInCenter(pendingReveal.line);
    editorRef.current.setPosition({
      lineNumber: pendingReveal.line,
      column: pendingReveal.column,
    });
    setPendingReveal(null);
  }, [file, file?.path, pendingReveal, setPendingReveal]);

  if (!file) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex flex-col items-center justify-center gap-4 relative">
          {/* subtle dot grid behind */}
          <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: "radial-gradient(circle, currentColor 1px, transparent 1px)", backgroundSize: "12px 12px" }} />
          <div className="relative flex flex-col items-center gap-3">
            <span className="text-5xl font-bold tracking-tighter text-white/[0.04] font-mono select-none">{"{ }"}</span>
            <div className="text-center space-y-1.5">
              <p className="text-[11px] text-white/20 font-mono">select a file to open</p>
              <div className="flex items-center gap-3 text-[10px] text-white/10">
                <span className="px-1.5 py-0.5 rounded bg-white/[0.03] shadow-[0_0_0_1px_rgba(255,255,255,0.04)]">cmd+p</span>
                <span>quick open</span>
                <span className="px-1.5 py-0.5 rounded bg-white/[0.03] shadow-[0_0_0_1px_rgba(255,255,255,0.04)]">cmd+\</span>
                <span>split</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (file.loading) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex items-center justify-center">
          <WaveSpinner size="sm" color="primary" animation="ripple" />
        </div>
      </div>
    );
  }

  const language = EXT_TO_LANG[file.ext] ?? "plaintext";

  const showMarkdownPreview = isMarkdown && mdPreview;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 relative overflow-hidden">
        {showMarkdownPreview ? (
          <div className="overflow-y-auto h-full">
            <div className="max-w-3xl mx-auto px-8 py-8">
              <Markdown content={file.content} />
            </div>
          </div>
        ) : file.originalContent !== undefined ? (
          <MonacoDiffEditor
            height="100%"
            language={language}
            original={file.originalContent}
            modified={file.content}
            beforeMount={handleBeforeMount}
            theme="mentiko-void"
            options={{
              fontSize: editorConfig.fontSize,
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
              lineHeight: 1.6,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              padding: { top: 8, bottom: 8 },
              smoothScrolling: true,
              renderWhitespace: editorConfig.renderWhitespace,
              ...(editorConfig.tabSize ? { tabSize: editorConfig.tabSize } : {}),
              lineNumbers: editorConfig.lineNumbers,
              overviewRulerBorder: false,
              readOnly: true,
              renderSideBySide: true,
            }}
          />
        ) : (
          <MonacoEditor
            height="100%"
            path={file.path}
            language={language}
            value={file.content}
            onChange={(val) => updateContent(file.path, val ?? "")}
            onMount={handleEditorMount}
            beforeMount={handleBeforeMount}
            theme="mentiko-void"
            options={{
              fontSize: editorConfig.fontSize,
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
              lineHeight: 1.6,
              minimap: { enabled: editorConfig.minimap, renderCharacters: false, showSlider: "always" },
              scrollBeyondLastLine: false,
              renderLineHighlight: "all",
              padding: { top: 8, bottom: 8 },
              smoothScrolling: true,
              cursorStyle: "line-thin",
              cursorSmoothCaretAnimation: "on",
              cursorBlinking: "phase",
              roundedSelection: true,
              renderWhitespace: editorConfig.renderWhitespace,
              tabSize: editorConfig.tabSize,
              wordWrap: editorConfig.wordWrap,
              lineNumbers: editorConfig.lineNumbers,
              overviewRulerBorder: false,
              hideCursorInOverviewRuler: true,
            }}
          />
        )}

        {/* markdown mode toggle */}
        {isMarkdown && (
          <button
            onClick={() => setMdPreview((v) => !v)}
            className="absolute top-2 right-4 z-10 px-2 py-0.5 rounded-md bg-white/5 shadow-[0_0_0_1px_rgba(255,255,255,0.06)] text-[9px] font-mono text-white/40 hover:text-white/60 hover:bg-white/8 transition-all cursor-pointer select-none"
          >
            {mdPreview ? "edit" : "preview"}
          </button>
        )}

        {/* floating save indicator - offset right when md toggle is present */}
        {file && isDirty(file) && (
          <div className={`absolute top-2 z-10 flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-amber-500/10 shadow-[0_0_0_1px_rgba(245,158,11,0.15)] text-[9px] font-mono text-amber-400/60 animate-in fade-in duration-300 ${isMarkdown ? "right-[72px]" : "right-4"}`}>
            <span className="w-1 h-1 rounded-full bg-amber-400/60 animate-pulse" />
            unsaved
          </div>
        )}
        {saving && (
          <div className={`absolute top-2 z-10 flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/5 shadow-[0_0_0_1px_rgba(255,255,255,0.06)] text-[9px] font-mono text-white/40 ${isMarkdown ? "right-[72px]" : "right-4"}`}>
            saving...
          </div>
        )}
        {!saving && saveError && (
          <div
            className={`absolute top-2 z-10 flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-red-500/10 shadow-[0_0_0_1px_rgba(239,68,68,0.2)] text-[9px] font-mono text-red-400/80 cursor-pointer ${isMarkdown ? "right-[72px]" : "right-4"}`}
            title={saveError}
            onClick={() => setSaveError("")}
          >
            ✕ {saveError.length > 40 ? saveError.slice(0, 40) + "…" : saveError}
          </div>
        )}
      </div>

      <StatusBar paneId={paneId} cursorLine={cursorLine} cursorColumn={cursorColumn} selectionLength={selectionLength} />
    </div>
  );
}
