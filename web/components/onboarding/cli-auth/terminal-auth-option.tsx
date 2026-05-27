"use client";

import { useState, useCallback } from "react";
import { CommandSquareFilled } from "@aliimam/icons";

const AUTH_COMMANDS: Record<string, string> = {
  claude: "claude auth login",
  codex: "codex auth login",
  gemini: "gemini auth login",
  kollab: "kollab --login openai",
  aider: "aider --help", // aider has no login, but users might want to verify install
};

export function getTerminalAuthCommand(tool: string): string {
  return AUTH_COMMANDS[tool] || `${tool} auth login`;
}

interface TerminalAuthOptionProps {
  tool: string;
}

export function TerminalAuthOption({ tool }: TerminalAuthOptionProps) {
  const [started, setStarted] = useState(false);

  const launch = useCallback(async () => {
    const cmd = getTerminalAuthCommand(tool);
    try {
      const sessionName = `cli-auth-${tool}-${Date.now()}`;
      const res = await fetch("/api/terminal/spawn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: sessionName }),
      });
      if (!res.ok) return;

      await fetch(`/api/agents/${encodeURIComponent(sessionName)}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: `${cmd}\n` }),
      });

      window.dispatchEvent(
        new CustomEvent("open-terminal-session", {
          detail: { session: sessionName },
        })
      );
      setStarted(true);
    } catch {
      // terminal not available
    }
  }, [tool]);

  if (started) {
    return (
      <div
        className="flex items-center gap-2 text-xs text-foreground/50 bg-muted/30 rounded-md px-3 py-2"
        data-source="components/onboarding/cli-auth/terminal-auth-option.tsx"
      >
        <span className="text-green-400">*</span>
        complete the flow in the terminal
        <button
          type="button"
          onClick={launch}
          className="ml-auto text-[10px] text-foreground/30 hover:text-foreground transition-colors"
        >
          relaunch
        </button>
      </div>
    );
  }

  return (
    <div
      className="bg-muted/30 rounded-md p-3 space-y-3"
      data-source="components/onboarding/cli-auth/terminal-auth-option.tsx"
    >
      <p className="text-[10px] text-foreground/40">
        opens a terminal running{" "}
        <span className="font-mono">{getTerminalAuthCommand(tool)}</span>
      </p>
      <button
        type="button"
        onClick={launch}
        className="flex items-center gap-2 px-3 py-2 rounded-md bg-card hover:bg-accent text-xs transition-colors w-full"
      >
        <CommandSquareFilled className="h-4 w-4 text-foreground/50" />
        open terminal & sign in
      </button>
    </div>
  );
}
