"use client";

/**
 * terminal-viewer.tsx - xterm.js terminal with WebSocket connection
 *
 * Connects to ws-terminal bridge server, attaches to a PTY session,
 * and renders live terminal output using xterm.js.
 *
 * Props:
 *   session   - PTY session name to attach to
 *   wsUrl     - WebSocket URL (default: ws://localhost:3099)
 *   readOnly  - disable keyboard input (default: false)
 *   onStatus  - callback for connection status changes
 */

import { useEffect, useRef, useCallback, useState } from "react";
import type { Terminal as XTerminal } from "@xterm/xterm";
import type { FitAddon as FitAddonType } from "@xterm/addon-fit";


export type TerminalStatus =
  | "connecting"
  | "attached"
  | "disconnected"
  | "error";

interface TerminalViewerProps {
  session: string;
  wsUrl?: string;
  readOnly?: boolean;
  className?: string;
  contentClassName?: string;
  onStatus?: (status: TerminalStatus, message?: string) => void;
  onActivity?: (activity: { type: string; at: number }) => void;
  onRefreshToken?: () => Promise<string | null>;
}

export function TerminalViewer({
  session,
  wsUrl = "ws://localhost:3099",
  readOnly = false,
  className = "",
  contentClassName = "",
  onStatus,
  onActivity,
  onRefreshToken,
}: TerminalViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerminal | null>(null);
  const fitAddonRef = useRef<FitAddonType | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const onActivityRef = useRef(onActivity);
  onActivityRef.current = onActivity;
  const [status, setStatus] = useState<TerminalStatus>("connecting");

  const updateStatus = useCallback(
    (s: TerminalStatus, msg?: string) => {
      setStatus(s);
      onStatus?.(s, msg);
    },
    [onStatus]
  );

  useEffect(() => {
    if (!containerRef.current) return;

    let mounted = true;
    let term: XTerminal | null = null;
    let fitAddon: FitAddonType | null = null;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelay = 1000; // exponential backoff: 1s, 2s, 4s, 8s... cap 30s
    let sessionExited = false; // true when PTY session itself ended (no reconnect)

    async function init() {
      // dynamic imports -- xterm is client-only, can't SSR
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");

      if (!mounted || !containerRef.current) return;

      // inject Maple Mono font-face (self-hosted, no install needed)
      if (!document.querySelector('style[data-maple-mono]')) {
        const style = document.createElement("style");
        style.setAttribute("data-maple-mono", "1");
        style.textContent = `
          @font-face {
            font-family: 'Maple Mono';
            src: url('/fonts/MapleMono-NF-Regular.ttf') format('truetype');
            font-weight: 400;
            font-style: normal;
            font-display: swap;
          }
          @font-face {
            font-family: 'Maple Mono';
            src: url('/fonts/MapleMono-NF-Bold.ttf') format('truetype');
            font-weight: 700;
            font-style: normal;
            font-display: swap;
          }
        `;
        document.head.appendChild(style);
        // wait for font to load before xterm measures character width
        await document.fonts.load('11px "Maple Mono"');
      }

      // inject xterm CSS via link element (avoid TS module resolution issues)
      if (!document.querySelector('link[data-xterm-css]')) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.setAttribute("data-xterm-css", "1");
        link.href = "/xterm.css";
        document.head.appendChild(link);
      }

      term = new Terminal({
        cursorBlink: true,
        cursorStyle: "bar",
        fontSize: 11,
        fontFamily: "'Maple Mono', 'Maple Mono NF', 'SF Mono', 'Fira Code', monospace",
        lineHeight: 1.0,
        scrollback: 10000,
        allowProposedApi: true,
        // match the design system dark background
        theme: {
          background: "#1a1a1acc", // close to oklch(0.13 0 0)
          foreground: "#e5e5e5", // close to oklch(0.92 0 0)
          cursor: "#e5e5e5",
          cursorAccent: "#1a1a1a",
          selectionBackground: "#404040",
          selectionForeground: "#e5e5e5",
          black: "#1a1a1a",
          red: "#f87171",
          green: "#4ade80",
          yellow: "#fbbf24",
          blue: "#60a5fa",
          magenta: "#c084fc",
          cyan: "#22d3ee",
          white: "#e5e5e5",
          brightBlack: "#525252",
          brightRed: "#fca5a5",
          brightGreen: "#86efac",
          brightYellow: "#fcd34d",
          brightBlue: "#93c5fd",
          brightMagenta: "#d8b4fe",
          brightCyan: "#67e8f9",
          brightWhite: "#fafafa",
        },
      });

      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      termRef.current = term;
      fitAddonRef.current = fitAddon;

      term.open(containerRef.current);

      // addons: load all in parallel, each non-fatal
      try { const { WebLinksAddon } = await import("@xterm/addon-web-links"); term.loadAddon(new WebLinksAddon()); } catch {}
      try { const { SearchAddon } = await import("@xterm/addon-search"); term.loadAddon(new SearchAddon()); } catch {}
      try { const { ClipboardAddon } = await import("@xterm/addon-clipboard"); term.loadAddon(new ClipboardAddon()); } catch {}
      try { const { Unicode11Addon } = await import("@xterm/addon-unicode11"); term.loadAddon(new Unicode11Addon()); term.unicode.activeVersion = "11"; } catch {}
      try { const { ImageAddon } = await import("@xterm/addon-image"); term.loadAddon(new ImageAddon()); } catch {}
      try { const { SerializeAddon } = await import("@xterm/addon-serialize"); term.loadAddon(new SerializeAddon()); } catch {}

      // defer fit two frames so flex layout has fully settled
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (mounted && fitAddonRef.current) {
            fitAddonRef.current.fit();
          }
        });
      });

      // connect (or reconnect) WebSocket
      // isFirst: true on initial connect (token already in wsUrl), false on reconnect (need fresh token)
      async function connectWs(isFirst: boolean = true) {
        if (!mounted || !term) return;
        let url = wsUrl;
        // tokens are single-use -- only fetch a fresh one on reconnect
        if (!isFirst && onRefreshToken) {
          const freshToken = await onRefreshToken();
          if (!mounted || !term) return; // unmounted during async fetch
          if (freshToken) {
            const base = wsUrl.split("?")[0];
            url = `${base}?token=${freshToken}`;
          }
        }
        if (!mounted || !term) return;
        const newWs = new WebSocket(url);
        ws = newWs;
        wsRef.current = ws;

        ws.onopen = () => {
          if (!mounted) return;
          updateStatus("connecting");
          fitAddon?.fit();
          const dims = fitAddon?.proposeDimensions();
          ws!.send(
            JSON.stringify({
              type: "attach",
              session,
              cols: dims?.cols,
              rows: dims?.rows,
            })
          );
        };

        ws.onmessage = (event) => {
          if (!mounted || !term) return;

          let msg: { type: string; data?: string; cols?: number; rows?: number; message?: string };
          try {
            msg = JSON.parse(event.data);
          } catch {
            return;
          }

          switch (msg.type) {
            case "attached":
              reconnectDelay = 1000; // reset backoff on successful attach
              updateStatus("attached");
              fitAddon?.fit();
              {
                const dims = fitAddon?.proposeDimensions();
                if (dims && ws?.readyState === WebSocket.OPEN) {
                  ws.send(
                    JSON.stringify({
                      type: "resize",
                      cols: dims.cols,
                      rows: dims.rows,
                    })
                  );
                }
              }
              break;

            case "data":
              if (msg.data) {
                term.write(msg.data);
              }
              break;

            case "activity":
              if (msg.data && onActivityRef.current) {
                onActivityRef.current(msg.data as unknown as { type: string; at: number });
              }
              break;

            case "exit":
              sessionExited = true;
              updateStatus("disconnected", "session exited");
              break;

            case "error":
              updateStatus("error", msg.message || "unknown error");
              break;
          }
        };

        ws.onclose = () => {
          if (!mounted) return;
          if (sessionExited) {
            updateStatus("disconnected", "session exited");
            return;
          }
          // unexpected close (network drop, app nap, etc) - reconnect with backoff
          updateStatus("connecting");
          reconnectTimer = setTimeout(() => {
            if (mounted && !sessionExited) connectWs(false);
          }, reconnectDelay);
          reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
        };

        ws.onerror = () => {
          if (!mounted) return;
          // onclose will fire after onerror, reconnect happens there
        };
      }

      connectWs();

      // forward keyboard input to PTY
      if (!readOnly) {
        term.onData((data) => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "input", data }));
          }
        });
      }
    }

    init();

    // handle resize
    const handleResize = () => {
      if (fitAddonRef.current && termRef.current) {
        fitAddonRef.current.fit();
        const dims = fitAddonRef.current.proposeDimensions();
        if (dims && wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: "resize",
              cols: dims.cols,
              rows: dims.rows,
            })
          );
        }
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }
    window.addEventListener("resize", handleResize);

    return () => {
      mounted = false;
      sessionExited = true; // prevent any reconnect attempts
      if (reconnectTimer) clearTimeout(reconnectTimer);
      resizeObserver.disconnect();
      window.removeEventListener("resize", handleResize);
      if (ws) {
        ws.close();
        wsRef.current = null;
      }
      if (term) {
        term.dispose();
        termRef.current = null;
      }
    };
  }, [session, wsUrl, readOnly, updateStatus]);

  return (
    <div className={`absolute inset-0 ${className}`} data-status={status}>
      <div className={`absolute overflow-hidden ${contentClassName || "inset-0"}`}>
        <div ref={containerRef} className="absolute inset-0 overflow-hidden" />
      </div>
      {(status === "disconnected" || status === "error") && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#1a1a1a]/80 pointer-events-none">
          <p className="text-xs text-foreground/40">
            {status === "error" ? "connection failed" : "session disconnected"}
          </p>
        </div>
      )}
    </div>
  );
}
