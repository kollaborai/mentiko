"use client";

import { useState, useRef } from "react";
import { WebViewport, type WebViewportRef } from "@/components/ui/web-viewport";

export default function BrowserPage() {
  const [url, setUrl] = useState("");
  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  const viewportRef = useRef<WebViewportRef>(null);

  const handleGo = (e: React.FormEvent) => {
    e.preventDefault();
    let target = url.trim();
    if (!target) return;
    if (!target.startsWith("http://") && !target.startsWith("https://")) {
      target = `https://${target}`;
    }
    if (activeUrl) {
      viewportRef.current?.navigate(target);
    } else {
      setActiveUrl(target);
    }
    setUrl(target);
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* top bar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-foreground/5">
        <span className="text-sm font-medium text-foreground/50">browser</span>
        <form onSubmit={handleGo} className="flex-1 flex gap-2">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="type a URL and hit enter..."
            className="flex-1 bg-muted rounded px-3 py-1.5 text-sm font-mono text-foreground/70 focus:outline-none focus:ring-1 focus:ring-foreground/20"
            autoFocus
          />
          <button
            type="submit"
            className="px-4 py-1.5 text-sm bg-foreground/10 hover:bg-foreground/20 rounded transition-colors"
          >
            go
          </button>
        </form>
      </div>

      {/* viewport */}
      <div className="flex-1 min-h-0">
        {activeUrl ? (
          <WebViewport
            ref={viewportRef}
            url={activeUrl}
            mode="inline"
            width="100%"
            height="100%"
            onNavigate={(newUrl) => setUrl(newUrl)}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-foreground/20 text-sm">
            enter a URL above to start browsing
          </div>
        )}
      </div>
    </div>
  );
}
