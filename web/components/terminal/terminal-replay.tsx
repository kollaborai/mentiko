"use client";

/**
 * terminal-replay.tsx - Replay recorded JSONL terminal sessions
 *
 * Fetches a JSONL recording from the API, parses timestamped entries,
 * and feeds them through xterm.js at recorded speed.
 *
 * JSONL format (from pty-manager.mjs startLog):
 *   { t: <epoch_ms>, type: "start", name, cmd, cols, rows }
 *   { t: <epoch_ms>, type: "o", data: "<output>" }      output
 *   { t: <epoch_ms>, type: "i", data: "<input>" }        input
 *   { t: <epoch_ms>, type: "exit", exitCode }
 *
 * Controls: play/pause, seek slider, speed (1x/2x/4x/8x)
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { Terminal as XTerminal } from "@xterm/xterm";
import type { FitAddon as FitAddonType } from "@xterm/addon-fit";
import { Button } from "@/components/ui/button";
import {
  PlayFilled as Play,
  Pause,
  RotateRightFilled as RotateCcw,
  Gauge,
} from "@aliimam/icons";

// a single entry from the JSONL log
interface LogEntry {
  t: number;
  type: "start" | "o" | "i" | "exit";
  data?: string;
  name?: string;
  cmd?: string;
  cols?: number;
  rows?: number;
  exitCode?: number;
}

export type ReplayStatus = "loading" | "ready" | "playing" | "paused" | "ended" | "error";

interface TerminalReplayProps {
  session: string;
  /** specific recording filename (optional - uses most recent) */
  file?: string;
  /** API base URL */
  apiBase?: string;
  className?: string;
  onStatus?: (status: ReplayStatus) => void;
}

const SPEED_OPTIONS = [1, 2, 4, 8] as const;
type Speed = (typeof SPEED_OPTIONS)[number];

export function TerminalReplay({
  session,
  file,
  apiBase = "",
  className = "",
  onStatus,
}: TerminalReplayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerminal | null>(null);
  const fitAddonRef = useRef<FitAddonType | null>(null);
  const entriesRef = useRef<LogEntry[]>([]);
  const indexRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTimeRef = useRef(0);

  const [status, setStatus] = useState<ReplayStatus>("loading");
  const [speed, setSpeed] = useState<Speed>(1);
  const [progress, setProgress] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  const speedRef = useRef(speed);
  speedRef.current = speed;

  const updateStatus = useCallback(
    (s: ReplayStatus) => {
      setStatus(s);
      onStatus?.(s);
    },
    [onStatus]
  );

  // parse JSONL text into entries
  const parseJSONL = useCallback((text: string): LogEntry[] => {
    const entries: LogEntry[] = [];
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        entries.push(JSON.parse(trimmed));
      } catch {
        // skip malformed lines
      }
    }
    return entries;
  }, []);

  // initialize xterm and fetch recording
  useEffect(() => {
    if (!containerRef.current) return;

    let mounted = true;
    let term: XTerminal | null = null;
    let fitAddon: FitAddonType | null = null;

    async function init() {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");

      if (!mounted || !containerRef.current) return;

      // inject xterm CSS
      if (!document.querySelector("link[data-xterm-css]")) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.setAttribute("data-xterm-css", "1");
        link.href = "/xterm.css";
        document.head.appendChild(link);
      }

      term = new Terminal({
        cursorBlink: false,
        cursorStyle: "bar",
        fontSize: 11,
        fontFamily: "'Maple Mono', 'Maple Mono NF', 'SF Mono', 'Fira Code', monospace",
        lineHeight: 1.0,
        scrollback: 10000,
        disableStdin: true,
        allowProposedApi: true,
        theme: {
          background: "#1a1a1acc",
          foreground: "#e5e5e5",
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

      // addons
      try { const { WebLinksAddon } = await import("@xterm/addon-web-links"); term.loadAddon(new WebLinksAddon()); } catch {}
      try { const { SearchAddon } = await import("@xterm/addon-search"); term.loadAddon(new SearchAddon()); } catch {}
      try { const { ClipboardAddon } = await import("@xterm/addon-clipboard"); term.loadAddon(new ClipboardAddon()); } catch {}
      try { const { Unicode11Addon } = await import("@xterm/addon-unicode11"); term.loadAddon(new Unicode11Addon()); term.unicode.activeVersion = "11"; } catch {}
      try { const { ImageAddon } = await import("@xterm/addon-image"); term.loadAddon(new ImageAddon()); } catch {}
      try { const { SerializeAddon } = await import("@xterm/addon-serialize"); term.loadAddon(new SerializeAddon()); } catch {}

      fitAddon.fit();

      // fetch recording
      const url = file
        ? `${apiBase}/api/sessions/${encodeURIComponent(session)}/recording?file=${encodeURIComponent(file)}`
        : `${apiBase}/api/sessions/${encodeURIComponent(session)}/recording`;

      try {
        const res = await fetch(url);
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "fetch failed" }));
          term.writeln(`\x1b[31mrecording not found: ${err.error || res.statusText}\x1b[0m`);
          updateStatus("error");
          return;
        }

        const text = await res.text();
        const entries = parseJSONL(text);

        if (entries.length === 0) {
          term.writeln("\x1b[33mempty recording\x1b[0m");
          updateStatus("error");
          return;
        }

        entriesRef.current = entries;
        indexRef.current = 0;

        // apply start entry dimensions
        const startEntry = entries.find((e) => e.type === "start");
        if (startEntry?.cols && startEntry?.rows) {
          term.resize(startEntry.cols, startEntry.rows);
          fitAddon.fit();
        }

        // calculate total duration
        const firstT = entries[0].t;
        const lastT = entries[entries.length - 1].t;
        const duration = lastT - firstT;
        setTotalDuration(duration);
        startTimeRef.current = firstT;

        updateStatus("ready");
      } catch (err) {
        term.writeln(`\x1b[31mfailed to load recording: ${String(err)}\x1b[0m`);
        updateStatus("error");
      }
    }

    init();

    // handle resize
    const handleResize = () => {
      fitAddonRef.current?.fit();
    };

    let resizeObserver: ResizeObserver | null = null;
    if (containerRef.current) {
      resizeObserver = new ResizeObserver(handleResize);
      resizeObserver.observe(containerRef.current);
    }
    window.addEventListener("resize", handleResize);

    return () => {
      mounted = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", handleResize);
      term?.dispose();
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, file, apiBase]);

  // playback engine: schedule the next entry
  const scheduleNext = useCallback(() => {
    const entries = entriesRef.current;
    const idx = indexRef.current;
    const term = termRef.current;

    if (!term || idx >= entries.length) {
      updateStatus("ended");
      setProgress(100);
      return;
    }

    const entry = entries[idx];

    // write output entries to terminal
    if (entry.type === "o" && entry.data) {
      term.write(entry.data);
    } else if (entry.type === "i" && entry.data) {
      // optionally show input as highlighted
      // for now, skip input entries during replay
    } else if (entry.type === "exit") {
      term.writeln(
        `\x1b[90m\r\n--- session exited (code: ${entry.exitCode ?? "?"}) ---\x1b[0m`
      );
      indexRef.current = idx + 1;
      updateStatus("ended");
      setProgress(100);
      return;
    }

    // update progress
    const startT = startTimeRef.current;
    const duration = totalDuration || 1;
    const currentElapsed = entry.t - startT;
    setElapsed(currentElapsed);
    setProgress(Math.min(100, (currentElapsed / duration) * 100));

    indexRef.current = idx + 1;

    // schedule next entry with time delta
    if (idx + 1 < entries.length) {
      const nextEntry = entries[idx + 1];
      const delta = nextEntry.t - entry.t;
      // apply speed, cap minimum at 1ms to keep UI responsive
      const delay = Math.max(1, delta / speedRef.current);

      timerRef.current = setTimeout(scheduleNext, delay);
    } else {
      updateStatus("ended");
      setProgress(100);
    }
  }, [totalDuration, updateStatus]);

  // play
  const handlePlay = useCallback(() => {
    if (status === "ended") {
      // restart from beginning
      termRef.current?.reset();
      indexRef.current = 0;
      setElapsed(0);
      setProgress(0);
    }
    updateStatus("playing");
    scheduleNext();
  }, [status, updateStatus, scheduleNext]);

  // pause
  const handlePause = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    updateStatus("paused");
  }, [updateStatus]);

  // restart
  const handleRestart = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    termRef.current?.reset();
    indexRef.current = 0;
    setElapsed(0);
    setProgress(0);
    updateStatus("ready");
  }, [updateStatus]);

  // cycle speed
  const handleSpeedCycle = useCallback(() => {
    setSpeed((prev) => {
      const idx = SPEED_OPTIONS.indexOf(prev);
      return SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
    });
  }, []);

  // seek via slider
  const handleSeek = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const pct = parseFloat(e.target.value);
      const entries = entriesRef.current;
      if (entries.length === 0) return;

      // pause during seek
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      const startT = startTimeRef.current;
      const targetT = startT + (totalDuration * pct) / 100;

      // reset terminal and replay all entries up to target
      const term = termRef.current;
      if (!term) return;

      term.reset();

      // apply start entry dimensions
      const startEntry = entries.find((e2) => e2.type === "start");
      if (startEntry?.cols && startEntry?.rows) {
        term.resize(startEntry.cols, startEntry.rows);
      }

      let newIdx = 0;
      for (let i = 0; i < entries.length; i++) {
        if (entries[i].t > targetT) break;
        if (entries[i].type === "o" && entries[i].data) {
          term.write(entries[i].data!);
        }
        newIdx = i + 1;
      }

      indexRef.current = newIdx;
      setProgress(pct);
      setElapsed(targetT - startT);
      updateStatus("paused");
    },
    [totalDuration, updateStatus]
  );

  const formatTime = (ms: number): string => {
    const sec = Math.floor(ms / 1000);
    const min = Math.floor(sec / 60);
    const s = sec % 60;
    return `${min}:${s.toString().padStart(2, "0")}`;
  };

  const isPlaying = status === "playing";
  const canPlay = status === "ready" || status === "paused" || status === "ended";

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* terminal */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 bg-[#1a1a1a]"
      />

      {/* controls bar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-card shrink-0">
        {/* play/pause */}
        <div className="flex items-center gap-1">
          {isPlaying ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={handlePause}
            >
              <Pause className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={handlePlay}
              disabled={!canPlay}
            >
              <Play className="h-3.5 w-3.5" />
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={handleRestart}
          >
            <RotateCcw className="h-3 w-3" />
          </Button>
        </div>

        {/* time display */}
        <span className="text-[10px] font-mono text-foreground/50 w-20 shrink-0">
          {formatTime(elapsed)} / {formatTime(totalDuration)}
        </span>

        {/* seek slider */}
        <input
          type="range"
          min="0"
          max="100"
          step="0.1"
          value={progress}
          onChange={handleSeek}
          className="flex-1 h-1 appearance-none bg-foreground/10 rounded-sm cursor-pointer
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:w-2.5
            [&::-webkit-slider-thumb]:h-2.5
            [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-foreground/60
            [&::-moz-range-thumb]:w-2.5
            [&::-moz-range-thumb]:h-2.5
            [&::-moz-range-thumb]:rounded-full
            [&::-moz-range-thumb]:bg-foreground/60
            [&::-moz-range-thumb]:border-0"
        />

        {/* speed button */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[10px] font-mono shrink-0"
          onClick={handleSpeedCycle}
        >
          <Gauge className="h-3 w-3 mr-1" />
          {speed}x
        </Button>

        {/* status indicator */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div
            className={`w-1.5 h-1.5 rounded-full ${
              status === "playing"
                ? "bg-green-400 animate-pulse"
                : status === "paused"
                  ? "bg-amber-400"
                  : status === "ended"
                    ? "bg-foreground/20"
                    : status === "error"
                      ? "bg-red-400"
                      : "bg-foreground/20"
            }`}
          />
          <span className="text-[10px] text-foreground/50">
            {status === "loading"
              ? "loading"
              : status === "ready"
                ? "ready"
                : status === "playing"
                  ? "playing"
                  : status === "paused"
                    ? "paused"
                    : status === "ended"
                      ? "ended"
                      : "error"}
          </span>
        </div>
      </div>
    </div>
  );
}
