"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./markdown.module.css";

let mermaidPromise: Promise<typeof import("mermaid")> | null = null;

function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => {
      m.default.initialize({
        startOnLoad: false,
        theme: "dark",
        themeVariables: {
          darkMode: true,
          background: "#0a0a0a",
          primaryColor: "#1a1a2e",
          primaryTextColor: "rgba(255,255,255,0.8)",
          primaryBorderColor: "rgba(255,255,255,0.1)",
          lineColor: "rgba(255,255,255,0.2)",
          secondaryColor: "#16213e",
          tertiaryColor: "#0f3460",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
          fontSize: "12px",
        },
      });
      return m;
    });
  }
  return mermaidPromise;
}

let renderCounter = 0;

interface MermaidBlockProps {
  source: string;
}

export function MermaidBlock({ source }: MermaidBlockProps) {
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [editing, setEditing] = useState(false);
  const [editSource, setEditSource] = useState(source);
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const renderDiagram = useCallback(async (src: string) => {
    try {
      const m = await loadMermaid();
      const id = `mermaid-${++renderCounter}`;
      const { svg: rendered } = await m.default.render(id, src);
      setSvg(rendered);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "invalid mermaid syntax");
    }
  }, []);

  // initial render
  useEffect(() => {
    renderDiagram(source);
  }, [source, renderDiagram]);

  // debounced live preview during editing
  useEffect(() => {
    if (!editing) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      renderDiagram(editSource);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [editSource, editing, renderDiagram]);

  // click outside to exit edit mode
  useEffect(() => {
    if (!editing) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setEditing(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [editing]);

  // escape to exit edit mode
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setEditing(false);
    }
  }, []);

  // focus textarea when entering edit mode
  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [editing]);

  if (editing) {
    return (
      <div ref={containerRef} className={styles.mermaidContainer}>
        <div className={styles.mermaidEditor}>
          <textarea
            ref={textareaRef}
            className={styles.mermaidTextarea}
            value={editSource}
            onChange={(e) => setEditSource(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={editSource.split("\n").length + 1}
          />
          {error ? (
            <div className={styles.mermaidError}>{error}</div>
          ) : svg ? (
            <div
              className={styles.mermaidPreview}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : null}
          <div className={styles.mermaidHint}>esc to close editor</div>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={styles.mermaidContainer}>
      {error ? (
        <div className={styles.mermaidError}>{error}</div>
      ) : svg ? (
        <div
          className={styles.mermaidSvg}
          onClick={() => {
            setEditSource(source);
            setEditing(true);
          }}
          title="click to edit"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className={styles.mermaidPreview}>
          <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 11 }}>
            loading diagram...
          </span>
        </div>
      )}
    </div>
  );
}
