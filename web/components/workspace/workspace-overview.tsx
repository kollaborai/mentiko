"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  MonitorFilled as HardDrive,
  GlobalFilled as Globe,
  BoxFilled as Container,
  CommandSquareFilled as Terminal,
  CodeFilled as Code,
  PlayFilled as Play,
  FolderOpenFilled as FolderOpen,
  ArrowSwapFilled as GitBranch,
  Link2Filled as Link2,
  FlashFilled as Zap,
} from "@aliimam/icons";
import { Button } from "@/components/ui/button";
import { useSharedRuns } from "@/lib/runs-store";
import type { Workspace } from "@/lib/workspace-storage";

interface RecentRun {
  id: string;
  chain: string;
  status: string;
  started: string;
  completed?: string;
}

function ExecBadge({ type }: { type: string }) {
  const config: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
    local: { icon: <HardDrive className="h-3 w-3" />, color: "text-foreground/50", label: "Local" },
    ssh: { icon: <Globe className="h-3 w-3" />, color: "text-blue-400", label: "SSH" },
    docker: { icon: <Container className="h-3 w-3" />, color: "text-purple-400", label: "Docker" },
  };
  const c = config[type] || config.local;
  return (
    <span className={`flex items-center gap-1.5 text-xs ${c.color}`}>
      {c.icon}
      {c.label}
    </span>
  );
}

export function WorkspaceOverview({
  workspace,
  onRefresh,
}: {
  workspace: Workspace;
  onRefresh: () => void;
}) {
  const { runs: sharedRuns } = useSharedRuns();
  const runs: RecentRun[] = sharedRuns
    .filter((r) => r.id)
    .slice(0, 5);

  const execType = workspace.execution?.type || "local";
  const envEntries = Object.entries(workspace.env || {});

  return (
    <div className="p-6 max-w-3xl space-y-8 overflow-y-auto h-full">
      {/* workspace info */}
      <div>
        <p className="text-[10px] font-medium text-foreground/40 uppercase tracking-wider mb-3">
          workspace
        </p>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <ExecBadge type={execType} />
            <span className="text-xs font-mono text-foreground/50">{workspace.path}</span>
          </div>
          {workspace.description && (
            <p className="text-xs text-foreground/50">{workspace.description}</p>
          )}
          {workspace.default_branch && (
            <p className="text-xs text-foreground/40">
              branch: <span className="font-mono">{workspace.default_branch}</span>
            </p>
          )}
        </div>
      </div>

      {/* project info */}
      {(workspace.project?.gitUrl || workspace.project?.defaultChain) && (
        <div>
          <p className="text-[10px] font-medium text-foreground/40 uppercase tracking-wider mb-3">
            project
          </p>
          <div className="space-y-2">
            {workspace.project?.gitUrl && (
              <div className="flex items-center gap-2 text-xs text-foreground/60">
                <Link2 className="h-3 w-3 shrink-0 text-foreground/30" />
                <a
                  href={workspace.project.gitUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono truncate hover:text-foreground transition-colors"
                >
                  {workspace.project.gitUrl}
                </a>
              </div>
            )}
            {workspace.project?.defaultChain && (
              <div className="flex items-center gap-2 text-xs text-foreground/60">
                <Zap className="h-3 w-3 shrink-0 text-foreground/30" />
                <Link href={`/chains?q=${encodeURIComponent(workspace.project.defaultChain)}`}
                  className="font-mono hover:text-foreground transition-colors">
                  {workspace.project.defaultChain}
                </Link>
                <span className="text-foreground/30">default chain</span>
              </div>
            )}
            {workspace.default_branch && (
              <div className="flex items-center gap-2 text-xs text-foreground/60">
                <GitBranch className="h-3 w-3 shrink-0 text-foreground/30" />
                <span className="font-mono">{workspace.default_branch}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* env vars */}
      {envEntries.length > 0 && (
        <div>
          <p className="text-[10px] font-medium text-foreground/40 uppercase tracking-wider mb-3">
            environment variables
          </p>
          <div className="space-y-1">
            {envEntries.map(([k]) => (
              <div key={k} className="flex items-center gap-2 text-xs">
                <span className="font-mono text-foreground/60">{k}</span>
                <span className="text-foreground/20">=</span>
                <span className="font-mono text-foreground/30">********</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* quick actions */}
      <div>
        <p className="text-[10px] font-medium text-foreground/40 uppercase tracking-wider mb-3">
          quick actions
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs gap-1.5"
            onClick={() => {
              // navigate to terminal tab via parent
              const el = document.querySelector('[data-tab="terminal"]') as HTMLButtonElement;
              el?.click();
            }}
          >
            <Terminal className="h-3.5 w-3.5" />
            Open Terminal
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs gap-1.5"
            onClick={() => {
              const el = document.querySelector('[data-tab="editor"]') as HTMLButtonElement;
              el?.click();
            }}
          >
            <Code className="h-3.5 w-3.5" />
            Open Editor
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs gap-1.5"
            asChild
          >
            <Link href="/chains">
              <Play className="h-3.5 w-3.5" />
              Run Chain
            </Link>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs gap-1.5"
            onClick={onRefresh}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      {/* recent runs */}
      <div>
        <p className="text-[10px] font-medium text-foreground/40 uppercase tracking-wider mb-3">
          recent runs
        </p>
        {runs.length === 0 ? (
          <p className="text-xs text-foreground/30">no runs yet</p>
        ) : (
          <div className="space-y-1">
            {runs.map((run) => (
              <a
                key={run.id}
                href={`/runs/${encodeURIComponent(run.id)}`}
                className="flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-muted transition-colors"
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    run.status === "completed"
                      ? "bg-green-400"
                      : run.status === "running"
                      ? "bg-amber-400 animate-pulse"
                      : run.status === "failed"
                      ? "bg-red-400"
                      : "bg-foreground/20"
                  }`}
                />
                <span className="text-xs font-mono truncate flex-1">{run.chain}</span>
                <span className="text-[10px] text-foreground/30 shrink-0">{run.status}</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
