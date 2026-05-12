"use client";

import Link from "next/link";
import { MagicStarFilled as Sparkles } from "@aliimam/icons";
import { releases, markUpdatesRead } from "@/lib/releases";
import { useEffect } from "react";

const PREVIEW_COUNT = 3;

interface UpdatesWidgetProps {
  className?: string;
}

export function UpdatesWidget({ className }: UpdatesWidgetProps) {
  useEffect(() => {
    markUpdatesRead();
  }, []);

  const preview = releases.slice(0, PREVIEW_COUNT);

  return (
    <div className={className}>
      <div className="relative bg-background border border-border/40 rounded-xl p-4 h-full overflow-hidden">
        <div
          className="absolute -right-8 -bottom-8 pointer-events-none"
          style={{ color: "#f59e0b", opacity: 0.08 }}
        >
          <Sparkles className="h-56 w-56" />
        </div>
        <div className="relative z-10 flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 shrink-0" style={{ color: "#f59e0b" }} />
            <h2 className="text-sm font-bold tracking-tight">What&apos;s New</h2>
          </div>
          <Link
            href="/updates"
            className="text-[10px] text-foreground/40 hover:text-foreground transition-colors"
          >
            View all
          </Link>
        </div>

        <div className="relative z-10 space-y-2">
        {preview.map((release) => (
          <Link
            key={release.version}
            href={release.docsHref || "/updates"}
            className="flex items-start gap-2.5 rounded-sm p-2 hover:bg-accent transition-colors group"
          >
            <Sparkles className="h-3.5 w-3.5 text-foreground/30 shrink-0 mt-0.5 group-hover:text-foreground/60 transition-colors" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium truncate">{release.title}</span>
                <span className="text-[9px] font-mono text-foreground/30 shrink-0">{release.version}</span>
              </div>
              <p className="text-[10px] text-muted-foreground/70 leading-relaxed line-clamp-1 mt-0.5">
                {release.description}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
    </div>
  );
}
