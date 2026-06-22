"use client";

import { Suspense, useCallback, useRef, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import {
  RefreshCircleFilled,
  MaximizeFilled,
  RouteSquareFilled,
  GlobalFilled,
} from "@aliimam/icons";
import { OPEN_FLOATING_APP_PANEL_EVENT } from "@/lib/ui/floating-app-panel-routing";

const DEFAULT_PORT = 3001;

// detect whether we're rendered inside a floating panel iframe (SSR-safe,
// no setState-in-effect) so we can hide the "open in panel" action there.
function subscribeEmbedded() {
  return () => {};
}
function embeddedSnapshot(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}
function embeddedServerSnapshot(): boolean {
  return false;
}

function PreviewInner() {
  const searchParams = useSearchParams();
  const paramPort = Number(searchParams.get("port"));
  const portFromUrl = Number.isInteger(paramPort) && paramPort > 0 ? paramPort : DEFAULT_PORT;

  const [port, setPort] = useState(() => portFromUrl);
  const [portInput, setPortInput] = useState(() => String(portFromUrl));
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const embedded = useSyncExternalStore(subscribeEmbedded, embeddedSnapshot, embeddedServerSnapshot);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const reload = useCallback(() => {
    setLoading(true);
    setReloadKey((k) => k + 1);
  }, []);

  const applyPort = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const next = Number(portInput.trim());
      if (!Number.isInteger(next) || next <= 0) return;
      setPort(next);
      setLoading(true);
      setReloadKey((k) => k + 1);
    },
    [portInput],
  );

  const openInPanel = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent(OPEN_FLOATING_APP_PANEL_EVENT, {
        detail: { href: `/preview?port=${port}`, title: `Preview :${port}` },
      }),
    );
  }, [port]);

  const src = `/api/preview/${port}/`;

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* toolbar */}
      <div className="flex items-center gap-2 border-b border-foreground/5 px-3 py-2">
        <span className="hidden text-sm font-medium text-foreground/50 sm:inline">preview</span>

        <form onSubmit={applyPort} className="flex items-center gap-1.5">
          <div className="flex items-center gap-1.5 rounded bg-muted px-2 py-1">
            <GlobalFilled className="h-3 w-3 shrink-0 text-foreground/30" />
            <span className="font-mono text-xs text-foreground/40">localhost:</span>
            <input
              type="text"
              inputMode="numeric"
              value={portInput}
              onChange={(e) => setPortInput(e.target.value)}
              className="w-16 bg-transparent font-mono text-xs text-foreground/70 outline-none"
              aria-label="Preview port"
            />
          </div>
          <button
            type="submit"
            className="rounded bg-foreground/10 px-3 py-1 text-xs transition-colors hover:bg-foreground/20"
          >
            go
          </button>
        </form>

        <button
          type="button"
          onClick={reload}
          className="rounded p-1.5 transition-colors hover:bg-muted"
          title="Refresh preview"
        >
          <RefreshCircleFilled
            className={`h-4 w-4 text-foreground/50 ${loading ? "animate-spin" : ""}`}
          />
        </button>

        <div className="flex-1" />

        {!embedded && (
          <button
            type="button"
            onClick={openInPanel}
            className="flex items-center gap-1.5 rounded px-2 py-1.5 text-xs text-foreground/50 transition-colors hover:bg-muted hover:text-foreground/70"
            title="Open as floating panel"
          >
            <RouteSquareFilled className="h-4 w-4" />
            <span className="hidden sm:inline">Panel</span>
          </button>
        )}
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 rounded px-2 py-1.5 text-xs text-foreground/50 transition-colors hover:bg-muted hover:text-foreground/70"
          title="Open preview in a new tab"
        >
          <MaximizeFilled className="h-4 w-4" />
          <span className="hidden sm:inline">Open</span>
        </a>
      </div>

      {/* viewport */}
      <div className="relative min-h-0 flex-1 bg-white">
        <iframe
          key={`${port}:${reloadKey}`}
          ref={iframeRef}
          src={src}
          onLoad={() => setLoading(false)}
          className="h-full w-full border-0"
          title={`Preview on port ${port}`}
        />
        {loading && (
          <div className="absolute left-0 right-0 top-0 h-0.5 overflow-hidden">
            <div className="h-full animate-pulse bg-amber-400/70" />
          </div>
        )}
      </div>
    </div>
  );
}

export default function PreviewPage() {
  return (
    <Suspense fallback={null}>
      <PreviewInner />
    </Suspense>
  );
}
