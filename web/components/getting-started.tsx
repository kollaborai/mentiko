"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

import { TickCircleFilled, RecordCircleFilled, ArrowRight2Filled, ExportFilled, FolderOpenFilled } from "@aliimam/icons";
import { useWorkspace } from "@/lib/workspace-context";
import { unwrapApiData } from "@/lib/api-client";
import { useSharedRuns } from "@/lib/runs-store";
import { useSharedChains } from "@/lib/chains-store";
import { getTerminalAuthCommand } from "@/lib/agent-provider-catalog";

interface Step {
  id: string;
  title: string;
  description: string;
  href?: string;
  onClick?: () => void;
  done?: boolean | null;
}

const DISMISSED_KEY = "getting-started-dismissed";
const WORKSPACE_BANNER_KEY = "workspace-banner-dismissed";
const CLI_AUTH_KEY = "cli-auth-confirmed";

export function GettingStarted() {
  const { workspaces, workspacePath } = useWorkspace();
  const { runs } = useSharedRuns({ workspacePath });
  const { chains } = useSharedChains();

  const [hasAgentProfile, setHasAgentProfile] = useState<boolean | null>(null);
  const [hasWorkspace, setHasWorkspace] = useState<boolean | null>(null);
  const [cliAuthConfirmed, setCliAuthConfirmed] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [workspaceBannerDismissed, setWorkspaceBannerDismissed] = useState(false);

  const hasChains = chains.length > 0;
  const hasRuns = runs.length > 0;

  useEffect(() => {
    // load agent profiles (not in shared store — only needed here)
    fetch("/api/agent-profiles").then((r) => r.json()).then((data) => {
      const profiles = unwrapApiData<{ profiles?: unknown[] }>(data);
      setHasAgentProfile((profiles.profiles?.length ?? 0) > 0);
    }).catch(() => setHasAgentProfile(false));

    // defer detect-cli to avoid blocking dashboard load (~2s endpoint).
    if (!localStorage.getItem(CLI_AUTH_KEY)) {
      fetch("/api/system/detect-cli").then((r) => r.json()).then((cliData) => {
        if (cliData) {
          const cli = unwrapApiData<{ tools?: Array<{ name: string; authenticated?: boolean }> }>(cliData);
          const anyAuthed = cli.tools?.some((t) => t.authenticated === true) ?? false;
          if (anyAuthed) {
            localStorage.setItem(CLI_AUTH_KEY, "1");
            setCliAuthConfirmed(true);
          }
        }
      }).catch(() => {});
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- standard hydration from localStorage + sync from props */
  useEffect(() => {
    if (typeof window !== "undefined") {
      setDismissed(!!localStorage.getItem(DISMISSED_KEY));
      setWorkspaceBannerDismissed(!!localStorage.getItem(WORKSPACE_BANNER_KEY));
      setCliAuthConfirmed(!!localStorage.getItem(CLI_AUTH_KEY));
    }
    setHasWorkspace(workspaces.length > 0);
  }, [workspaces.length]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "1");
    setDismissed(true);
  };

  const handleWorkspaceBannerDismiss = () => {
    localStorage.setItem(WORKSPACE_BANNER_KEY, "1");
    setWorkspaceBannerDismissed(true);
  };

  const openTerminal = () => {
    window.dispatchEvent(new CustomEvent("toggle-terminal-panel"));
  };

  // Show workspace setup banner if no workspaces configured
  if (workspaces.length === 0 && !workspaceBannerDismissed) {
    return (
      <div className="bg-gradient-to-r from-amber-500/10 to-red-500/10 border border-amber-500/20 rounded-md p-4 mb-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded bg-amber-500/20">
            <FolderOpenFilled className="h-5 w-5 text-amber-500" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-medium">Set up your workspace</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Connect a project directory to start running chains
            </p>
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={() => window.dispatchEvent(new CustomEvent("open-welcome-panel"))}
                className="px-3 py-1.5 bg-foreground text-background text-xs rounded-md hover:bg-foreground/90 transition-colors flex items-center gap-1.5"
              >
                Start setup
                <ExportFilled className="h-3 w-3" />
              </button>
              <button
                onClick={handleWorkspaceBannerDismiss}
                className="text-xs text-muted-foreground hover:text-foreground/70 transition-colors"
              >
                dismiss
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Wait for all checks to load
  if (hasAgentProfile === null) return null;

  const steps: Step[] = [
    {
      id: "agent-config",
      title: "Configure an AI provider",
      description: "Set up Claude, Gemini, or another CLI — add your API key",
      href: "/settings/agent-configs",
      done: hasAgentProfile,
    },
    {
      id: "agent-configs",
      title: "Visit Agent Configs",
      description: "Review installed profiles and customize models, flags, env vars",
      href: "/settings/agent-configs",
      done: hasAgentProfile,
    },
    {
      id: "cli-auth",
      title: "Authenticate your CLI",
      description: `Run '${getTerminalAuthCommand("claude")}' in the terminal to complete OAuth auth`,
      onClick: () => { openTerminal(); },
      done: cliAuthConfirmed,
    },
    {
      id: "workspace",
      title: "Connect a workspace",
      description: "Link a project directory where your agents will run",
      href: "/workspaces",
      done: hasWorkspace,
    },
    {
      id: "create-chain",
      title: "Create your first chain",
      description: "Build an agent pipeline to automate a workflow",
      href: "/chains/new",
      done: hasChains,
    },
    {
      id: "run-chain",
      title: "Run a chain",
      description: "Execute your first chain and see live agent output",
      href: "/runs",
      done: hasRuns,
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;

  if (dismissed || allDone) return null;

  const progressPct = Math.round((doneCount / steps.length) * 100);

  return (
    <div className="bg-background border border-border/40 rounded-xl overflow-hidden mb-4">
      <div className="px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-medium">Getting started</h3>
            <span className="text-[10px] text-muted-foreground/60">{doneCount}/{steps.length} done</span>
          </div>
          <div className="h-1 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500/60 rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
        <button
          onClick={handleDismiss}
          className="text-[11px] text-muted-foreground hover:text-foreground/70 transition-colors shrink-0"
        >
          dismiss
        </button>
      </div>

      <div className="divide-y divide-muted/40">
        {steps.map((step) => {
          const content = (
            <div className="flex items-center gap-3 px-4 py-3 hover:bg-accent/40 transition-colors group">
              <div className="shrink-0">
                {step.done ? (
                  <TickCircleFilled className="h-4 w-4 text-green-500/70" />
                ) : (
                  <RecordCircleFilled className="h-4 w-4 text-muted-foreground/30" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-medium ${step.done ? "line-through text-muted-foreground/40" : ""}`}>
                  {step.title}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">{step.description}</p>
              </div>
              <ArrowRight2Filled className="h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors shrink-0" />
            </div>
          );

          if (step.onClick) {
            return (
              <button key={step.id} className="w-full text-left" onClick={step.onClick}>
                {content}
              </button>
            );
          }
          return (
            <Link key={step.id} href={step.href!}>
              {content}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
