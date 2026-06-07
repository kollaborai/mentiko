"use client";

import { useEffect, useState } from "react";
import { CommandSquareFilled } from "@aliimam/icons";
import { unwrapApiData } from "@/lib/api/api-client";

export function SessionsIndicator() {
  const [activeCount, setActiveCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const fetchCount = async () => {
      try {
        const res = await fetch("/api/pty/sessions");
        if (!res.ok) return;
        const data = unwrapApiData<{ sessions?: { alive: boolean }[] }>(await res.json());
        if (!cancelled && Array.isArray(data.sessions)) {
          setActiveCount(data.sessions.filter((s: { alive: boolean }) => s.alive).length);
        }
      } catch {
        // pty-manager not running — stay at 0
      }
    };

    fetchCount();
    const interval = setInterval(fetchCount, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const handleClick = () => {
    window.dispatchEvent(new CustomEvent("toggle-terminal-panel"));
  };

  return (
    <button
      onClick={handleClick}
      data-testid="terminal-toggle"
      className="relative flex items-center justify-center w-8 h-8 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
      title={activeCount > 0 ? `${activeCount} active PTY session${activeCount !== 1 ? "s" : ""}` : "Open terminal"}
    >
      <CommandSquareFilled className="h-4 w-4" />
      {activeCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center h-4 min-w-4 px-0.5 rounded-full bg-orange-500 text-[10px] font-semibold text-white leading-none">
          {activeCount > 99 ? "99+" : activeCount}
        </span>
      )}
    </button>
  );
}
