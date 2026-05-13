"use client";

import { useState, useEffect } from "react";
import { TerminalViewer } from "@/components/terminal/terminal-viewer";
import { CommandSquareFilled as Terminal, RefreshFilled as RefreshCw, CopyFilled as Copy, CheckFilled as Check } from "@aliimam/icons";
import { Button } from "@/components/ui/button";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { getApiErrorMessage, unwrapApiData } from "@/lib/api-client";
import { getTerminalWsBaseUrl } from "@/lib/terminal-ws-url";

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
    cmd: "claude login",
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
    cmd: "codex auth login",
    description: "OpenAI OAuth flow",
  },
  {
    cli: "git",
    label: "Git Credentials",
    cmd: "git config --global credential.helper store",
    description: "Persist git credentials",
  },
];

interface WorkspaceTerminalProps {
  workspaceId: string;
  workspacePath?: string;
  installedClis?: string[];
}

export function WorkspaceTerminal({
  workspaceId,
  workspacePath,
  installedClis,
}: WorkspaceTerminalProps) {
  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const [sessionName, setSessionName] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "spawning" | "ready" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  const safeId = workspaceId.replace(/[^a-zA-Z0-9\-_]/g, "-").slice(0, 50);
  const name = `ws-auth-${safeId}`;

  const spawn = async () => {
    setStatus("spawning");
    setErrorMsg("");
    try {
      // get ws token
      const tokenRes = await fetch("/api/terminal/token");
      const tokenData = unwrapApiData<{ token?: string }>(await tokenRes.json());
      if (!tokenData.token) {
        setErrorMsg("ws-terminal server not running. Start it with: npm run ws:terminal");
        setStatus("error");
        return;
      }

      // spawn session
      const spawnRes = await fetch("/api/terminal/spawn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, cwd: workspacePath, workspaceId }),
      });
      const spawnRaw = await spawnRes.json();
      const spawnData = unwrapApiData<{ name?: string }>(spawnRaw);
      if (!spawnRes.ok) {
        setErrorMsg(getApiErrorMessage(spawnRaw, "Failed to spawn terminal"));
        setStatus("error");
        return;
      }

      const base = await getTerminalWsBaseUrl();
      setWsUrl(`${base}?token=${tokenData.token}`);
      setSessionName(spawnData.name || name);
      setStatus("ready");
    } catch {
      setErrorMsg("Failed to connect to terminal service");
      setStatus("error");
    }
  };

  // auto-spawn on first render
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    spawn();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const copyCmd = (cmd: string) => {
    copyToClipboard(cmd);
    setCopiedCmd(cmd);
    setTimeout(() => setCopiedCmd(null), 2000);
  };

  // filter auth commands to relevant CLIs if installedClis provided
  const suggestions = installedClis
    ? AUTH_COMMANDS.filter((c) => installedClis.includes(c.cli) || c.cli === "git")
    : AUTH_COMMANDS;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* auth suggestions */}
      {suggestions.length > 0 && (
        <div className="shrink-0 px-4 pt-4 pb-2">
          <p className="text-[10px] font-medium text-foreground/40 uppercase tracking-wider mb-2">
            Suggested Auth Commands
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {suggestions.map((c) => (
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
      )}

      {/* terminal area */}
      <div className="flex-1 min-h-0 relative mx-4 mb-4 mt-2 rounded-md overflow-hidden bg-[#1a1a1a]">
        {status === "idle" || status === "spawning" ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex items-center gap-2 text-foreground/40">
              <RefreshCw className="h-4 w-4 animate-spin" />
              <span className="text-xs">Starting terminal...</span>
            </div>
          </div>
        ) : status === "error" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center">
            <Terminal className="h-8 w-8 text-foreground/20" />
            <p className="text-xs text-foreground/50">{errorMsg}</p>
            <Button size="sm" variant="outline" onClick={spawn}>
              <RefreshCw className="h-3 w-3 mr-1.5" />
              Retry
            </Button>
          </div>
        ) : wsUrl && sessionName ? (
          <TerminalViewer
            session={sessionName}
            wsUrl={wsUrl}
            readOnly={false}
            className="absolute inset-0"
          />
        ) : null}
      </div>
    </div>
  );
}
