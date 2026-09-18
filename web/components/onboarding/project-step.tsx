"use client";

/**
 * ProjectStep — spec "Step 2: connect a project" source chooser.
 *
 * Renders existing projects (highlighting the selected one), then the
 * chooser cards: GitHub (recommended when connected — a real repository
 * browser, or a "Connect GitHub" prompt while local/manual alternatives stay
 * reachable), Local folder, New project, and a "More ways" disclosure for
 * Upload ZIP / Other Git URL / SSH / Docker. Every path reuses the existing
 * project-setup/* components exactly (onComplete/onBack/workspacesDir) — this
 * file only supplies the chooser shell and the GitHub repository browser,
 * which is new UI, not a rewrite of an existing component.
 *
 * When any path creates (or the user picks an existing) workspace, onSelect
 * is called with its id; the parent persists the choice via
 * POST /api/onboarding/workspace/select.
 *
 * Buttons are never disabled/greyed out — busy states show aria-busy plus a
 * spinner and are guarded against duplicate submits.
 */

import { useCallback, useEffect, useRef, useState, type ComponentType, type JSX } from "react";
import {
  ArrowLeft2Filled,
  BoxFilled,
  CommandSquareFilled,
  ExportFilled,
  FolderOpenFilled,
  GlobalFilled,
  MagicStarFilled,
  RotateFilled,
  SearchNormal1Filled,
} from "@aliimam/icons";
import { TerminalIcon } from "@/components/ui/terminal-icon";
import { GitCloneSetup } from "@/components/onboarding/project-setup/git-clone-setup";
import { LocalFolderSetup } from "@/components/onboarding/project-setup/local-folder-setup";
import { NewProjectSetup } from "@/components/onboarding/project-setup/new-project-setup";
import { UploadSetup } from "@/components/onboarding/project-setup/upload-setup";
import { SshSetup } from "@/components/onboarding/project-setup/ssh-setup";
import { DockerSetup } from "@/components/onboarding/project-setup/docker-setup";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { getApiErrorMessage } from "@/lib/api/api-client";
import { CURRENT_SETUP_VERSION } from "@/lib/onboarding/onboarding-constants";
import { cn } from "@/lib/utils";

type View = null | "github" | "local" | "new" | "upload" | "gitUrl" | "ssh" | "docker";

interface ProjectStepWorkspace {
  id: string;
  name: string;
  path?: string;
  execution?: { type?: string };
}

export interface ProjectStepProps {
  workspacesDir?: string;
  workspaces: ProjectStepWorkspace[];
  selectedWorkspaceId?: string | null;
  busy?: boolean;
  onSelect: (workspaceId: string) => void | Promise<void>;
}

interface ProjectSourceCard {
  key: Exclude<View, null>;
  title: string;
  description: string;
  Icon: ComponentType<{ className?: string }>;
}

const PRIMARY_CARDS: ProjectSourceCard[] = [
  { key: "github", title: "GitHub", description: "Browse accessible repositories.", Icon: CommandSquareFilled },
  { key: "local", title: "Local folder", description: "Use a folder on this machine.", Icon: FolderOpenFilled },
  { key: "new", title: "New project", description: "Start with an empty project.", Icon: MagicStarFilled },
];

const MORE_WAYS_CARDS: ProjectSourceCard[] = [
  { key: "upload", title: "Upload ZIP", description: "Bring in a ZIP.", Icon: ExportFilled },
  { key: "gitUrl", title: "Other Git URL", description: "Paste a Git URL.", Icon: GlobalFilled },
  { key: "ssh", title: "SSH", description: "Use a remote project.", Icon: TerminalIcon },
  { key: "docker", title: "Docker", description: "Run agents in a container.", Icon: BoxFilled },
];

interface GithubRepo {
  id: number;
  full_name: string;
  name: string;
  owner: string;
  visibility: string;
  default_branch: string;
}

function GithubRepositoryBrowser({
  onBack,
  onWorkspaceCreated,
}: {
  onBack: () => void;
  onWorkspaceCreated: (workspaceId: string) => void;
}) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [query, setQuery] = useState("");
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<GithubRepo | null>(null);
  const [branch, setBranch] = useState("");
  const [creating, setCreating] = useState(false);
  const createGuardRef = useRef(false);

  const search = useCallback(
    async (q: string) => {
      setLoading(true);
      setError("");
      try {
        const res = await fetchWithNamespace(
          `/api/integrations/github/repositories?limit=25${q ? `&query=${encodeURIComponent(q)}` : ""}`,
        );
        const data = (await res.json().catch(() => ({}))) as { repositories?: GithubRepo[] };
        if (!res.ok) {
          setError(getApiErrorMessage(data, "GitHub repositories unavailable"));
          return;
        }
        setRepos(data.repositories || []);
      } catch {
        setError("GitHub repositories unavailable");
      } finally {
        setLoading(false);
      }
    },
    [fetchWithNamespace],
  );

  useEffect(() => {
    void search("");
    // only on mount — further searches are driven by the input's onChange
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUseRepo = useCallback(async () => {
    if (!selected || createGuardRef.current) return;
    createGuardRef.current = true;
    setCreating(true);
    setError("");
    try {
      const res = await fetchWithNamespace("/api/onboarding/workspace/from-github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: selected.name,
          gitUrl: `https://github.com/${selected.full_name}.git`,
          branch: branch || selected.default_branch,
          idempotencyKey: crypto.randomUUID(),
          setupVersion: CURRENT_SETUP_VERSION,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { workspaceId?: string };
      if (!res.ok) {
        setError(getApiErrorMessage(data, "failed to import repository"));
        return;
      }
      if (data.workspaceId) onWorkspaceCreated(data.workspaceId);
    } catch {
      setError("failed to import repository");
    } finally {
      createGuardRef.current = false;
      setCreating(false);
    }
  }, [selected, branch, fetchWithNamespace, onWorkspaceCreated]);

  return (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="mb-1 text-lg font-semibold">Browse GitHub Projects</h2>
        <p className="text-sm text-foreground/50">pick a repository you can access</p>
      </div>

      <div className="relative">
        <SearchNormal1Filled className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground/30" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            void search(e.target.value);
          }}
          placeholder="Search your repositories"
          className="w-full rounded-md bg-muted py-2 pl-8 pr-3 text-sm placeholder:text-foreground/30 focus:bg-accent focus:outline-none"
          autoFocus
        />
      </div>

      {loading && <p className="text-xs text-foreground/40">loading repositories…</p>}
      {!loading && repos.length === 0 && !error && (
        <p className="text-xs text-foreground/40">No repositories found. Try another search or use a Git URL.</p>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}

      {repos.length > 0 && (
        <div className="max-h-56 space-y-1.5 overflow-y-auto">
          {repos.map((repo) => {
            const isSelected = selected?.id === repo.id;
            return (
              <button
                key={repo.id}
                type="button"
                onClick={() => {
                  setSelected(repo);
                  setBranch(repo.default_branch);
                }}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left transition-colors",
                  isSelected ? "border-amber-400/60 bg-amber-400/10" : "border-border/60 bg-card/20 hover:bg-accent/40",
                )}
              >
                <span className="truncate text-xs font-medium text-foreground/80">{repo.full_name}</span>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-1.5 py-0.5 text-[10px]",
                    repo.visibility === "private" ? "bg-foreground/10 text-foreground/50" : "bg-green-400/10 text-green-400",
                  )}
                >
                  {repo.visibility}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <div className="space-y-3 rounded-md bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="shrink-0 text-foreground/50">Default branch</span>
            <input
              type="text"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className="w-32 rounded-md bg-muted px-2 py-1 text-right font-mono text-xs focus:bg-accent focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={handleUseRepo}
            aria-busy={creating}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {creating && <RotateFilled className="h-3.5 w-3.5 animate-spin" />}
            Use this project
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 text-xs text-foreground/40 transition-colors hover:text-foreground"
      >
        <ArrowLeft2Filled className="h-3.5 w-3.5" />
        back
      </button>
    </div>
  );
}

function GithubConnectPrompt({
  connecting,
  onConnect,
  onQuickJump,
  onBack,
}: {
  connecting: boolean;
  onConnect: () => void;
  onQuickJump: (view: View) => void;
  onBack: () => void;
}) {
  return (
    <div className="space-y-5 text-center">
      <div>
        <h2 className="mb-1 text-lg font-semibold">Browse GitHub Projects</h2>
        <p className="text-sm text-foreground/50">Connect GitHub to browse your projects</p>
      </div>
      <button
        type="button"
        onClick={onConnect}
        aria-busy={connecting}
        className="mx-auto flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        {connecting && <RotateFilled className="h-3.5 w-3.5 animate-spin" />}
        Connect GitHub
      </button>
      <div className="flex items-center justify-center gap-3 text-[11px] text-foreground/40">
        <button type="button" onClick={() => onQuickJump("local")} className="transition-colors hover:text-foreground">
          Local folder
        </button>
        <span>·</span>
        <button type="button" onClick={() => onQuickJump("new")} className="transition-colors hover:text-foreground">
          New project
        </button>
        <span>·</span>
        <button type="button" onClick={() => onQuickJump("gitUrl")} className="transition-colors hover:text-foreground">
          Other Git URL
        </button>
      </div>
      <button
        type="button"
        onClick={onBack}
        className="mx-auto flex items-center gap-1 text-xs text-foreground/40 transition-colors hover:text-foreground"
      >
        <ArrowLeft2Filled className="h-3.5 w-3.5" />
        back
      </button>
    </div>
  );
}

export function ProjectStep({ workspacesDir, workspaces, selectedWorkspaceId, busy, onSelect }: ProjectStepProps): JSX.Element {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [view, setView] = useState<View>(null);
  const [moreWaysOpen, setMoreWaysOpen] = useState(false);
  const [githubStatus, setGithubStatus] = useState<"loading" | "connected" | "not_connected">("loading");
  const [connecting, setConnecting] = useState(false);
  const connectGuardRef = useRef(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const selectGuardRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithNamespace("/api/integrations/github/connection");
        const data = (await res.json().catch(() => ({}))) as { status?: string };
        if (!cancelled) setGithubStatus(data.status === "connected" ? "connected" : "not_connected");
      } catch {
        if (!cancelled) setGithubStatus("not_connected");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchWithNamespace]);

  const runSelect = useCallback(
    async (workspaceId: string) => {
      if (selectGuardRef.current) return;
      selectGuardRef.current = true;
      setPendingId(workspaceId);
      try {
        await onSelect(workspaceId);
      } finally {
        selectGuardRef.current = false;
        setPendingId(null);
      }
    },
    [onSelect],
  );

  const handleSubComplete = useCallback(
    (data: { workspaceId: string }) => {
      setView(null);
      void runSelect(data.workspaceId);
    },
    [runSelect],
  );

  const handleConnectGithub = useCallback(async () => {
    if (connectGuardRef.current) return;
    connectGuardRef.current = true;
    setConnecting(true);
    try {
      const res = await fetchWithNamespace("/api/integrations/github/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), setupVersion: CURRENT_SETUP_VERSION }),
      });
      const data = (await res.json().catch(() => ({}))) as { authorizationUrl?: string };
      if (res.ok && data.authorizationUrl) {
        window.location.href = data.authorizationUrl;
        return;
      }
    } finally {
      connectGuardRef.current = false;
      setConnecting(false);
    }
  }, [fetchWithNamespace]);

  const isBusyFor = (id: string) => pendingId === id || Boolean(busy && selectedWorkspaceId === id);

  if (view === "local") {
    return <LocalFolderSetup onComplete={handleSubComplete} onBack={() => setView(null)} workspacesDir={workspacesDir} />;
  }
  if (view === "new") {
    return <NewProjectSetup onComplete={handleSubComplete} onBack={() => setView(null)} workspacesDir={workspacesDir} />;
  }
  if (view === "upload") {
    return <UploadSetup onComplete={handleSubComplete} onBack={() => setView(null)} workspacesDir={workspacesDir} />;
  }
  if (view === "gitUrl") {
    return <GitCloneSetup onComplete={handleSubComplete} onBack={() => setView(null)} workspacesDir={workspacesDir} />;
  }
  if (view === "ssh") {
    return <SshSetup onComplete={handleSubComplete} onBack={() => setView(null)} />;
  }
  if (view === "docker") {
    return <DockerSetup onComplete={handleSubComplete} onBack={() => setView(null)} />;
  }
  if (view === "github") {
    if (githubStatus === "connected") {
      return (
        <GithubRepositoryBrowser
          onBack={() => setView(null)}
          onWorkspaceCreated={(workspaceId) => handleSubComplete({ workspaceId })}
        />
      );
    }
    if (githubStatus === "loading") {
      return <p className="text-center text-xs text-foreground/40">checking GitHub connection…</p>;
    }
    return (
      <GithubConnectPrompt
        connecting={connecting}
        onConnect={handleConnectGithub}
        onQuickJump={setView}
        onBack={() => setView(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="mb-1 text-base font-semibold">Connect a project</h2>
        <p className="text-xs text-foreground/50">Choose where your agents will work.</p>
      </div>

      {workspaces.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-foreground/50">Existing projects</p>
          <div className="space-y-1">
            {workspaces.map((workspace) => {
              const selected = workspace.id === selectedWorkspaceId;
              const rowBusy = isBusyFor(workspace.id);
              return (
                <div
                  key={workspace.id}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-md border px-3 py-1.5",
                    selected ? "border-amber-400/60 bg-amber-400/10" : "border-border/60 bg-card/20",
                  )}
                >
                  <div className="min-w-0">
                    <p className={cn("truncate text-xs font-medium", selected ? "text-amber-400" : "text-foreground/80")}>
                      {workspace.name}
                    </p>
                    {workspace.path && <p className="truncate text-[11px] text-foreground/40">{workspace.path}</p>}
                  </div>
                  {selected ? (
                    <span className="shrink-0 text-[11px] font-medium text-amber-400">Selected</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void runSelect(workspace.id)}
                      aria-busy={rowBusy}
                      className="inline-flex shrink-0 items-center gap-1.5 text-xs text-foreground/60 transition-colors hover:text-foreground"
                    >
                      {rowBusy && <RotateFilled className="h-3 w-3 animate-spin" />}
                      Use This Project
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {PRIMARY_CARDS.map((card) => (
          <button
            key={card.key}
            type="button"
            onClick={() => setView(card.key)}
            className="group flex flex-col items-start gap-1.5 rounded-md border border-border/60 bg-card/20 p-3 text-left transition-colors hover:bg-accent/40"
          >
            <div className="flex w-full items-center justify-between">
              <card.Icon className="h-4 w-4 text-foreground/40 transition-colors group-hover:text-foreground/70" />
              {card.key === "github" && githubStatus === "connected" && (
                <span className="rounded-full bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                  Recommended
                </span>
              )}
            </div>
            <div>
              <p className="text-xs font-medium">{card.title}</p>
              <p className="text-[10px] leading-snug text-foreground/40">{card.description}</p>
            </div>
          </button>
        ))}
      </div>

      <div className="text-center">
        <button
          type="button"
          onClick={() => setMoreWaysOpen((v) => !v)}
          className="text-[11px] text-foreground/40 transition-colors hover:text-foreground"
        >
          {moreWaysOpen ? "Hide more ways" : "More ways to connect a project"}
        </button>
      </div>

      {moreWaysOpen && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {MORE_WAYS_CARDS.map((card) => (
            <button
              key={card.key}
              type="button"
              onClick={() => setView(card.key)}
              className="flex flex-col items-start gap-1 rounded-md border border-border/60 bg-card/20 p-2.5 text-left transition-colors hover:bg-accent/40"
            >
              <card.Icon className="h-4 w-4 text-foreground/40" />
              <p className="text-[11px] font-medium">{card.title}</p>
              <p className="text-[10px] text-foreground/40">{card.description}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
