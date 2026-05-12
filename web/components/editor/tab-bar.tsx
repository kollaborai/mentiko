"use client";

import { useState, useRef, useCallback } from "react";
import { CloseCircleFilled, ArrowRight1Filled } from "@aliimam/icons";
import { useEditorStore, usePane, isDirty } from "@/lib/editor-store";
import { getFileAccentColor } from "./file-tree";

interface TabBarProps {
  paneId: string;
  rootPath: string;
}

export function TabBar({ paneId, rootPath }: TabBarProps) {
  const { openFiles, activeFile, pane } = usePane(paneId);
  const setActiveFile = useEditorStore((s) => s.setActiveFile);
  const pinFile = useEditorStore((s) => s.pinFile);
  const closeFile = useEditorStore((s) => s.closeFile);
  const markSaved = useEditorStore((s) => s.markSaved);
  const reorderFiles = useEditorStore((s) => s.reorderFiles);

  const handleSave = useCallback(async (filePath: string, content: string) => {
    try {
      const res = await fetch(`/api/fs/file?path=${encodeURIComponent(filePath)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (res.ok) markSaved(filePath, content);
    } catch {}
  }, [markSaved]);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const tabRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLDivElement>, index: number) => {
      setDragIndex(index);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(index));
    },
    []
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>, index: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dragIndex === null || dragIndex === index) {
        setDropTarget(null);
        return;
      }

      const rect = e.currentTarget.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      const insertAt = e.clientX < midX ? index : index + 1;
      setDropTarget(insertAt);
    },
    [dragIndex]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>, index: number) => {
      e.preventDefault();
      if (dragIndex === null) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      let toIndex = e.clientX < midX ? index : index + 1;

      // adjust for removal shift
      if (dragIndex < toIndex) toIndex--;

      if (dragIndex !== toIndex) {
        reorderFiles(paneId, dragIndex, toIndex);
      }

      setDragIndex(null);
      setDropTarget(null);
    },
    [dragIndex, paneId, reorderFiles]
  );

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDropTarget(null);
  }, []);

  if (!pane || openFiles.length === 0) return null;

  return (
    <div
      className="flex items-center gap-0 overflow-x-auto flex-1 min-w-0 scrollbar-hide"
      onDragOver={(e) => e.preventDefault()}
    >
      {openFiles.map((file, index) => {
        const isActive = activeFile?.path === file.path;
        const dirty = isDirty(file);
        const accent = getFileAccentColor(file.path, rootPath);
        const isDragging = dragIndex === index;
        const showDropBefore = dropTarget === index;
        const showDropAfter =
          dropTarget === index + 1 && index === openFiles.length - 1;

        // full breadcrumb path
        const rel = file.path.startsWith(rootPath)
          ? file.path.slice(rootPath.length + 1)
          : file.path;
        const display = rel;

        return (
          <div
            key={file.path}
            ref={(el) => {
              if (el) tabRefs.current.set(index, el);
              else tabRefs.current.delete(index);
            }}
            role="button"
            tabIndex={0}
            draggable
            onDragStart={(e) => handleDragStart(e, index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDrop={(e) => handleDrop(e, index)}
            onDragEnd={handleDragEnd}
            onClick={() => setActiveFile(paneId, file.path)}
            onDoubleClick={() => pinFile(file.path)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setActiveFile(paneId, file.path);
            }}
            className={`relative flex items-center gap-1 px-2 py-0.5 text-[9px] shrink-0 cursor-pointer transition-all rounded-md group ${
              isDragging ? "opacity-40" : ""
            } ${
              isActive
                ? "text-white/80"
                : "text-white/30 hover:text-white/50 hover:bg-white/4"
            }`}
            style={
              isActive
                ? {
                    background: `${accent}0a`,
                    boxShadow: `0 0 0 1px ${accent}15`,
                  }
                : undefined
            }
          >
            {showDropBefore && (
              <div className="absolute left-0 top-1 bottom-1 w-0.5 bg-white/40 rounded-full" />
            )}
            {dirty && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400/70 shrink-0" />
            )}
            <span
              className={`flex items-center gap-0.5 font-mono ${!file.pinned ? "italic" : ""}`}
            >
              {display.split("/").map((seg, si, arr) => (
                <span
                  key={si}
                  className="flex items-center gap-0.5 shrink-0"
                >
                  {si > 0 && (
                    <ArrowRight1Filled className="h-2 w-2 text-white/15 shrink-0" />
                  )}
                  <span
                    className={
                      si === arr.length - 1
                        ? "text-white/70"
                        : "text-white/30"
                    }
                  >
                    {seg}
                  </span>
                </span>
              ))}
            </span>
            {dirty && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleSave(file.path, file.content);
                }}
                className="shrink-0 opacity-0 group-hover:opacity-80 hover:opacity-100 transition-all text-amber-400/70 hover:text-amber-400"
                title="Save (Cmd+S)"
              >
                <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M3 3h7l3 3v7H3V3z" />
                  <path d="M5 3v3h5V3" />
                  <path d="M5 9h6v4H5V9z" />
                </svg>
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (
                  dirty &&
                  !window.confirm(
                    `Discard unsaved changes to ${file.name}?`
                  )
                )
                  return;
                closeFile(paneId, file.path);
              }}
              className="shrink-0 opacity-0 group-hover:opacity-60 hover:opacity-100 transition-all"
            >
              <CloseCircleFilled className="h-3 w-3" />
            </button>
            {showDropAfter && (
              <div className="absolute right-0 top-1 bottom-1 w-0.5 bg-white/40 rounded-full" />
            )}
          </div>
        );
      })}
    </div>
  );
}
