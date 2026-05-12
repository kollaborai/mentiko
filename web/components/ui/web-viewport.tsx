"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from "react";
import {
  ArrowLeft2Filled,
  ArrowRight2Filled,
  CloseCircleFilled,
  RefreshCircleFilled,
  GlobalFilled,
} from "@aliimam/icons";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

// ── types ─────────────────────────────────────────────────────────────

export interface ViewportState {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface WebViewportRef {
  navigate: (url: string) => void;
  back: () => void;
  forward: () => void;
  refresh: () => void;
  getState: () => ViewportState;
  /** capture the iframe as a base64 PNG (same-origin only) */
  screenshot: () => Promise<string | null>;
  /** get text content of the iframe document */
  getDOM: () => string | null;
}

export interface WebViewportProps {
  /** initial URL to load */
  url: string;
  /** display mode */
  mode?: "modal" | "panel" | "inline";
  /** viewport dimensions (for inline/panel) */
  width?: number | string;
  height?: number | string;
  /** called when the viewport navigates */
  onNavigate?: (url: string) => void;
  /** called when page finishes loading */
  onLoad?: (state: ViewportState) => void;
  /** called when user closes the viewport (modal mode) */
  onClose?: () => void;
  /** modal open state (modal mode only) */
  open?: boolean;
  /** optional class for the container */
  className?: string;
}

// ── proxy URL builder ─────────────────────────────────────────────────

function proxyUrl(url: string): string {
  return `/api/system/web-proxy?url=${encodeURIComponent(url)}`;
}

// ── browser chrome (address bar + nav) ────────────────────────────────

function BrowserChrome({
  state,
  onBack,
  onForward,
  onRefresh,
  onClose,
  onNavigate,
}: {
  state: ViewportState;
  onBack: () => void;
  onForward: () => void;
  onRefresh: () => void;
  onClose?: () => void;
  onNavigate: (url: string) => void;
}) {
  const [editingUrl, setEditingUrl] = useState(false);
  const [urlInput, setUrlInput] = useState(state.url);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editingUrl) setUrlInput(state.url);
  }, [state.url, editingUrl]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let url = urlInput.trim();
    if (!url) return;
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = `https://${url}`;
    }
    onNavigate(url);
    setEditingUrl(false);
  };

  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 bg-card border-b border-foreground/5 rounded-t-md">
      {/* nav buttons */}
      <button
        type="button"
        onClick={onBack}
        disabled={!state.canGoBack}
        className="p-1 rounded hover:bg-muted disabled:opacity-20 transition-colors"
        title="Back"
      >
        <ArrowLeft2Filled className="h-3.5 w-3.5 text-foreground/50" />
      </button>
      <button
        type="button"
        onClick={onForward}
        disabled={!state.canGoForward}
        className="p-1 rounded hover:bg-muted disabled:opacity-20 transition-colors"
        title="Forward"
      >
        <ArrowRight2Filled className="h-3.5 w-3.5 text-foreground/50" />
      </button>
      <button
        type="button"
        onClick={onRefresh}
        className="p-1 rounded hover:bg-muted transition-colors"
        title="Refresh"
      >
        <RefreshCircleFilled className={`h-3.5 w-3.5 text-foreground/50 ${state.loading ? "animate-spin" : ""}`} />
      </button>

      {/* address bar */}
      <form onSubmit={handleSubmit} className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 bg-muted rounded px-2 py-1">
          <GlobalFilled className="h-3 w-3 text-foreground/30 shrink-0" />
          {editingUrl ? (
            <input
              ref={inputRef}
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onBlur={() => setEditingUrl(false)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditingUrl(false);
              }}
              className="flex-1 bg-transparent text-xs font-mono text-foreground/70 outline-none min-w-0"
              autoFocus
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setEditingUrl(true);
                setUrlInput(state.url);
                setTimeout(() => inputRef.current?.select(), 0);
              }}
              className="flex-1 text-left text-xs font-mono text-foreground/50 truncate min-w-0"
            >
              {state.url || "about:blank"}
            </button>
          )}
          {state.loading && (
            <div className="h-2.5 w-2.5 border border-foreground/20 border-t-foreground/60 rounded-full animate-spin shrink-0" />
          )}
        </div>
      </form>

      {/* close button */}
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded hover:bg-muted transition-colors"
          title="Close"
        >
          <CloseCircleFilled className="h-3.5 w-3.5 text-foreground/40" />
        </button>
      )}
    </div>
  );
}

// ── main viewport component ───────────────────────────────────────────

export const WebViewport = forwardRef<WebViewportRef, WebViewportProps>(
  function WebViewport(
    {
      url: initialUrl,
      mode = "inline",
      width = "100%",
      height = 600,
      onNavigate,
      onLoad,
      onClose,
      open,
      className,
    },
    ref
  ) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [state, setState] = useState<ViewportState>({
      url: initialUrl,
      title: "",
      loading: true,
      canGoBack: false,
      canGoForward: false,
    });
    const historyRef = useRef<string[]>([initialUrl]);
    const historyIndexRef = useRef(0);

    // listen for postMessage from the proxied page
    useEffect(() => {
      function handleMessage(e: MessageEvent) {
        if (!e.data || typeof e.data.type !== "string") return;
        if (!e.data.type.startsWith("viewport-")) return;

        switch (e.data.type) {
          case "viewport-loaded":
            setState((prev) => ({
              ...prev,
              url: e.data.url || prev.url,
              title: e.data.title || "",
              loading: false,
            }));
            break;

          case "viewport-navigate": {
            const newUrl = e.data.url;
            if (newUrl) {
              // update history
              historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
              historyRef.current.push(newUrl);
              historyIndexRef.current = historyRef.current.length - 1;

              setState((prev) => ({
                ...prev,
                url: newUrl,
                loading: true,
                canGoBack: historyIndexRef.current > 0,
                canGoForward: false,
              }));
              onNavigate?.(newUrl);
            }
            break;
          }

          case "viewport-title":
            setState((prev) => ({ ...prev, title: e.data.title || prev.title }));
            break;
        }
      }

      window.addEventListener("message", handleMessage);
      return () => window.removeEventListener("message", handleMessage);
    }, [onNavigate]);

    // fire onLoad when loading completes
    useEffect(() => {
      if (!state.loading && onLoad) {
        onLoad(state);
      }
    }, [state.loading]); // eslint-disable-line react-hooks/exhaustive-deps

    const navigate = useCallback((url: string) => {
      historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
      historyRef.current.push(url);
      historyIndexRef.current = historyRef.current.length - 1;

      setState({
        url,
        title: "",
        loading: true,
        canGoBack: historyIndexRef.current > 0,
        canGoForward: false,
      });

      if (iframeRef.current) {
        iframeRef.current.src = proxyUrl(url);
      }
      onNavigate?.(url);
    }, [onNavigate]);

    const back = useCallback(() => {
      if (historyIndexRef.current <= 0) return;
      historyIndexRef.current--;
      const url = historyRef.current[historyIndexRef.current];
      setState((prev) => ({
        ...prev,
        url,
        loading: true,
        canGoBack: historyIndexRef.current > 0,
        canGoForward: true,
      }));
      if (iframeRef.current) {
        iframeRef.current.src = proxyUrl(url);
      }
    }, []);

    const forward = useCallback(() => {
      if (historyIndexRef.current >= historyRef.current.length - 1) return;
      historyIndexRef.current++;
      const url = historyRef.current[historyIndexRef.current];
      setState((prev) => ({
        ...prev,
        url,
        loading: true,
        canGoBack: true,
        canGoForward: historyIndexRef.current < historyRef.current.length - 1,
      }));
      if (iframeRef.current) {
        iframeRef.current.src = proxyUrl(url);
      }
    }, []);

    const refresh = useCallback(() => {
      setState((prev) => ({ ...prev, loading: true }));
      if (iframeRef.current) {
        iframeRef.current.src = proxyUrl(state.url);
      }
    }, [state.url]);

    const screenshot = useCallback(async (): Promise<string | null> => {
      // canvas capture only works for same-origin content
      // since we proxy everything through our domain, this should work
      try {
        const iframe = iframeRef.current;
        if (!iframe) return null;

        const canvas = document.createElement("canvas");
        canvas.width = iframe.clientWidth;
        canvas.height = iframe.clientHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;

        // html2canvas approach -- draw iframe content to canvas
        // this works because the content is same-origin (proxied)
        const iframeDoc = iframe.contentDocument;
        if (!iframeDoc) return null;

        // use the serializer approach: serialize to SVG foreignObject
        const html = iframeDoc.documentElement.outerHTML;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}">
          <foreignObject width="100%" height="100%">
            <div xmlns="http://www.w3.org/1999/xhtml">${html}</div>
          </foreignObject>
        </svg>`;

        const img = new Image();
        const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(blob);

        return new Promise((resolve) => {
          img.onload = () => {
            ctx.drawImage(img, 0, 0);
            URL.revokeObjectURL(url);
            resolve(canvas.toDataURL("image/png"));
          };
          img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve(null);
          };
          img.src = url;
        });
      } catch {
        return null;
      }
    }, []);

    const getDOM = useCallback((): string | null => {
      try {
        const iframe = iframeRef.current;
        if (!iframe) return null;
        const doc = iframe.contentDocument;
        if (!doc) return null;
        // return text content for AI consumption
        return doc.body?.innerText ?? doc.documentElement.textContent ?? null;
      } catch {
        return null;
      }
    }, []);

    // expose ref API for programmatic control
    useImperativeHandle(ref, () => ({
      navigate,
      back,
      forward,
      refresh,
      getState: () => state,
      screenshot,
      getDOM,
    }), [navigate, back, forward, refresh, state, screenshot, getDOM]);

    // handle iframe load event (fallback for pages that don't run our injected script)
    const handleIframeLoad = useCallback(() => {
      setState((prev) => {
        if (prev.loading) {
          return { ...prev, loading: false };
        }
        return prev;
      });
    }, []);

    const browserContent = (
      <div
        className={`flex flex-col rounded-md border border-foreground/10 overflow-hidden bg-background ${className ?? ""}`}
        style={mode === "inline" ? { width, height } : undefined}
      >
        <BrowserChrome
          state={state}
          onBack={back}
          onForward={forward}
          onRefresh={refresh}
          onClose={onClose}
          onNavigate={navigate}
        />
        <div className="flex-1 relative bg-white">
          <iframe
            ref={iframeRef}
            src={proxyUrl(state.url)}
            className="w-full h-full border-0"
            onLoad={handleIframeLoad}
            title={state.title || "Web Viewport"}
            style={{ minHeight: mode === "inline" ? undefined : "100%" }}
          />
          {state.loading && (
            <div className="absolute top-0 left-0 right-0 h-0.5">
              <div className="h-full bg-blue-400/60 animate-pulse" />
            </div>
          )}
        </div>
      </div>
    );

    // modal mode wraps in Dialog
    if (mode === "modal") {
      return (
        <Dialog open={open ?? true} onOpenChange={(o) => { if (!o) onClose?.(); }}>
          <DialogContent
            showCloseButton={false}
            className="max-w-4xl w-[90vw] h-[80vh] p-0 gap-0 overflow-hidden"
          >
            <DialogTitle className="sr-only">
              {state.title || "Web Browser"}
            </DialogTitle>
            {browserContent}
          </DialogContent>
        </Dialog>
      );
    }

    // panel mode
    if (mode === "panel") {
      return (
        <div className="h-full" style={{ width: width ?? 480 }}>
          {browserContent}
        </div>
      );
    }

    // inline mode (default)
    return browserContent;
  }
);
