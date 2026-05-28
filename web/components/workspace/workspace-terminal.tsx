"use client";

import { useEffect, useState, useCallback } from "react";
import { TerminalPanel } from "@/components/terminal/terminal-panel";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { getApiErrorMessage } from "@/lib/api-client";
import { CopyFilled as Copy, CheckFilled as Check } from "@aliimam/icons";
import type { Workspace } from "@/lib/workspace-storage";
import { getTerminalAuthCommand } from "@/lib/agent-provider-catalog";

interface AuthCommand {
  cli: string;
  label: string;
  cmd: string;
  description: string;
}

const AUTH_COMMANDS: AuthCommand[] = [
  {
    cli: "claude",
    label: "Claude Code",
    cmd: getTerminalAuthCommand("claude"),
    description: "Browser OAuth — opens claude.ai to authorize",
  },
  {
    cli: "gh",
    label: "GitHub CLI",
    cmd: "gh auth login",
    description: "Authenticate with GitHub (OAuth or PAT)",
  },
  {
    cli: "codex",
    label: "OpenAI Codex",
    cmd: getTerminalAuthCommand("codex"),
    description: "OpenAI OAuth flow",
  },
  {
    cli: "git",
    label: "Git Credentials",
    cmd: "git config --global credential.helper store",
    description: "Persist git credentials",
  },
];

export function WorkspaceTerminal({ workspace }: { workspace: Workspace }) {
  const [sessionName, setSessionName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  const ensureSession = useCallback(async () => {
    const name = `workspace-${workspace.id}`;
    try {
      // try to spawn a session in the workspace path
      const res = await fetch("/api/terminal/spawn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          cwd: workspace.path,
          workspaceId: workspace.id,
        }),
      });
      if (res.ok) {
        setSessionName(name);
      } else {
        // session might already exist
        const raw = await res.json().catch(() => ({}));
        const msg = getApiErrorMessage(raw, "failed to create terminal session");
        if (msg.includes("exists") || msg.includes("already")) {
          setSessionName(name);
        } else {
          setError(msg);
        }
      }
    } catch {
      // if spawn endpoint doesn't exist, still try to connect
      setSessionName(name);
    }
  }, [workspace.id, workspace.path]);

  useEffect(() => {
    queueMicrotask(() => ensureSession());
  }, [ensureSession]);

  const copyCmd = (cmd: string) => {
    copyToClipboard(cmd);
    setCopiedCmd(cmd);
    setTimeout(() => setCopiedCmd(null), 2000);
  };

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-xs text-red-400/70">{error}</p>
          <button
            onClick={ensureSession}
            className="mt-2 text-xs text-foreground/40 hover:text-foreground transition-colors"
          >
            retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* auth suggestions */}
      <div className="shrink-0 px-4 pt-4 pb-2">
        <p className="text-[10px] font-medium text-foreground/40 uppercase tracking-wider mb-2">
          Suggested Auth Commands
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {AUTH_COMMANDS.map((c) => (
            <div
              key={c.cmd}
              className="flex items-center justify-between gap-2 bg-card rounded-sm px-2.5 py-1.5 group"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-foreground/40">{c.label}</span>
                </div>
                <code className="text-[11px] font-mono text-foreground/80 truncate block">{c.cmd}</code>
              </div>
              <button
                type="button"
                onClick={() => copyCmd(c.cmd)}
                className="shrink-0 text-foreground/20 hover:text-foreground/60 transition-colors opacity-0 group-hover:opacity-100"
                title="Copy"
              >
                {copiedCmd === c.cmd ? (
                  <Check className="h-3 w-3 text-green-400" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </button>
            </div>
          ))}
        </div>
        <p className="mt-1.5 text-[10px] text-foreground/30">
          Copy a command and paste it in the terminal below. Auth state persists per workspace.
        </p>
      </div>

      {/* terminal area */}
      <div className="flex-1 min-h-0 px-4 pb-4">
        {!sessionName ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-foreground/30">connecting...</p>
          </div>
        ) : (
          <TerminalPanel
            session={sessionName}
            sessionAlive={true}
            className="h-full"
          />
        )}
      </div>
    </div>
  );
}
