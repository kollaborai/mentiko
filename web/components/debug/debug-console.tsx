"use client";

import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { SendFilled, ArrowDown2Filled, ArrowUp2Filled } from "@aliimam/icons";
import { TerminalIcon } from "@/components/ui/terminal-icon";

interface ConsoleEntry {
  id: string;
  type: "command" | "response" | "error";
  text: string;
  timestamp: Date;
}

interface DebugConsoleProps {
  onCommand: (command: string) => Promise<string>;
  className?: string;
}

export function DebugConsole({ onCommand, className = "" }: DebugConsoleProps) {
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [collapsed, setCollapsed] = useState(false);
  const [executing, setExecuting] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  // auto-scroll to bottom on new entries
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [entries]);

  const focusInput = () => inputRef.current?.focus();

  const addEntry = (type: ConsoleEntry["type"], text: string) => {
    const entry: ConsoleEntry = {
      id: `${Date.now()}-${Math.random()}`,
      type,
      text,
      timestamp: new Date(),
    };
    setEntries((prev) => [...prev, entry]);
  };

  const executeCommand = async (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) return;

    // add to history
    setHistory((prev) => {
      const filtered = prev.filter((h) => h !== trimmed);
      return [...filtered, trimmed];
    });
    setHistoryIndex(-1);

    // show command
    addEntry("command", trimmed);
    setInput("");
    setExecuting(true);

    try {
      const response = await onCommand(trimmed);
      addEntry("response", response || "(no response)");
    } catch (err) {
      addEntry("error", err instanceof Error ? err.message : "command failed");
    } finally {
      setExecuting(false);
      focusInput();
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      executeCommand(input);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length === 0) return;
      const newIndex = historyIndex < 0 ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(newIndex);
      setInput(history[newIndex]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex < 0) return;
      const newIndex = Math.min(history.length - 1, historyIndex + 1);
      setHistoryIndex(newIndex);
      setInput(history[newIndex]);
      if (newIndex === history.length - 1) {
        setHistoryIndex(-1);
        setInput("");
      }
    }
  };

  const getEntryColor = (type: ConsoleEntry["type"]) => {
    switch (type) {
      case "command":
        return "text-amber-400";
      case "response":
        return "text-green-400";
      case "error":
        return "text-red-400";
    }
  };

  const getEntryIcon = (type: ConsoleEntry["type"]) => {
    switch (type) {
      case "command":
        return ">";
      case "response":
        return "";
      case "error":
        return "!";
    }
  };

  return (
    <div className={`bg-muted/40 ${collapsed ? "h-9" : "h-48"} ${className}`}>
      {/* header */}
      <div className="flex items-center justify-between mx-3 py-1.5 border-b border-border">
        <div className="flex items-center gap-2">
        <TerminalIcon className="h-3 w-3 text-foreground/40" />
          <span className="text-[10px] uppercase tracking-wide text-foreground/40">debug console</span>
          {entries.length > 0 && (
            <span className="text-[9px] text-foreground/30">
              {entries.filter((e) => e.type === "command").length} commands
            </span>
          )}
        </div>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="text-foreground/30 hover:text-foreground/50"
        >
          {collapsed ? (
            <ArrowUp2Filled className="h-3 w-3" />
          ) : (
            <ArrowDown2Filled className="h-3 w-3" />
          )}
        </button>
      </div>

      {!collapsed && (
        <>
          {/* output */}
          <div
            ref={outputRef}
            className="px-3 py-2 h-36 overflow-y-auto font-mono text-[10px] space-y-1"
          >
            {entries.length === 0 ? (
              <p className="text-foreground/20 italic">
                type commands: step, pause, resume, inspect [agent], breakpoint [agent]
              </p>
            ) : (
              entries.map((entry) => (
                <div key={entry.id} className={`flex items-start gap-1.5 ${getEntryColor(entry.type)}`}>
                  <span className="shrink-0 text-foreground/30">
                    {getEntryIcon(entry.type)}
                  </span>
                  <span className="break-all">{entry.text}</span>
                </div>
              ))
            )}
            {executing && (
              <div className="text-foreground/30 animate-pulse">executing...</div>
            )}
          </div>

          {/* input */}
          <div className="flex items-center gap-2 px-3 pb-2">
            <span className="text-amber-400/50 text-[10px] font-mono">→</span>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={focusInput}
              placeholder="command..."
              disabled={executing}
              className="flex-1 bg-muted/5 border border-border rounded px-2 py-1 text-[10px] text-foreground/70 placeholder:text-foreground/20 focus:outline-none disabled:opacity-50"
            />
            <button
              onClick={() => executeCommand(input)}
              disabled={executing || !input.trim()}
              className="p-1.5 rounded bg-muted/5 hover:bg-muted/10 disabled:opacity-30"
            >
              <SendFilled className="h-3 w-3 text-foreground/40" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
