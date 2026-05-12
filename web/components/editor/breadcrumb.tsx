"use client";

import { ArrowRight1Filled } from "@aliimam/icons";
import { usePane } from "@/lib/editor-store";

interface BreadcrumbProps {
  paneId: string;
  rootPath: string;
}

export function Breadcrumb({ paneId, rootPath }: BreadcrumbProps) {
  const { activeFile } = usePane(paneId);
  const activeFilePath = activeFile?.path ?? null;

  if (!activeFilePath) return null;

  const relative = activeFilePath.startsWith(rootPath)
    ? activeFilePath.slice(rootPath.length + 1)
    : activeFilePath;

  const segments = relative.split("/");

  return (
    <div className="flex items-center gap-0.5 px-3 py-0.5 shrink-0 bg-transparent overflow-x-auto scrollbar-hide">
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1;
        return (
          <div key={i} className="flex items-center gap-0.5 shrink-0">
            {i > 0 && (
              <ArrowRight1Filled className="h-2.5 w-2.5 text-white/15 shrink-0" />
            )}
            <span
              className={`text-[10px] font-mono ${
                isLast
                  ? "text-white/50"
                  : "text-white/20 hover:text-white/35 cursor-default"
              }`}
            >
              {seg}
            </span>
          </div>
        );
      })}
    </div>
  );
}
