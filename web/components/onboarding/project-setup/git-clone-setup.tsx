"use client";

import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft2Filled,
  GlobalFilled,
  FolderOpenFilled,
  RotateFilled,
  CommandSquareFilled,
} from "@aliimam/icons";
import { FolderBrowser } from "@/components/workspace/folder-browser";
import { SecretForm } from "@/components/secrets/secret-form";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { getApiErrorMessage } from "@/lib/api/api-client";

interface GitCloneSetupProps {
  onComplete: (data: {
    workspaceId: string;
    workspaceName: string;
    workspacePath: string;
    method: string;
  }) => void;
  onBack: () => void;
  workspacesDir?: string;
}

function parseRepoName(url: string): string {
  // https://github.com/user/mentiko.git -> mentiko
  // git@github.com:user/mentiko.git -> mentiko
  // https://github.com/user/mentiko -> mentiko
  const cleaned = url.replace(/\.git$/, "").replace(/\/$/, "");
  const segments = cleaned.split(/[/:]/);
  return segments[segments.length - 1] || "";
}

export function GitCloneSetup({
  onComplete,
  onBack,
  workspacesDir,
}: GitCloneSetupProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [url, setUrl] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [token, setToken] = useState("");
  const [secretSaved, setSecretSaved] = useState(false);
  const [parent, setParent] = useState(workspacesDir || "");
  const [parentManual, setParentManual] = useState(false);
  const [showBrowser, setShowBrowser] = useState(false);
  const [branch, setBranch] = useState("");
  const [name, setName] = useState("");
  const [nameManual, setNameManual] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [error, setError] = useState("");
  const [authMethod, setAuthMethod] = useState<"terminal" | "token">("terminal");
  const [ghAuthStarted, setGhAuthStarted] = useState(false);

  const derivedName = nameManual ? name : parseRepoName(url);

  useEffect(() => {
    if (workspacesDir && !parentManual) {
      setParent(workspacesDir);
    }
  }, [parentManual, workspacesDir]);

  const launchGhTerminal = useCallback(async () => {
    try {
      const sessionName = `gh-auth-${Date.now()}`;
      const res = await fetch("/api/terminal/spawn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: sessionName }),
      });
      if (!res.ok) return;

      await fetch(`/api/agents/${encodeURIComponent(sessionName)}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "gh auth login\n" }),
      });

      window.dispatchEvent(new CustomEvent("open-terminal-session", { detail: { session: sessionName } }));
      setGhAuthStarted(true);
    } catch {
      setError("failed to launch terminal");
    }
  }, []);

  const handleUrlChange = (val: string) => {
    setUrl(val);
    if (!nameManual) {
      setName(parseRepoName(val));
    }
  };

  const handleNameChange = (val: string) => {
    setName(val);
    setNameManual(true);
  };

  const handleSecretSave = useCallback(
    async (data: { name: string; envVar: string; value: string; description?: string }) => {
      setToken(data.value);
      setSecretSaved(true);
    },
    []
  );

  const handleSubmit = useCallback(async () => {
    if (!url.trim()) {
      setError("repository URL is required");
      return;
    }
    if (!parent.trim()) {
      setError("clone directory is required");
      return;
    }

    setCloning(true);
    setError("");

    try {
      // 1. clone
      const cloneRes = await fetchWithNamespace("/api/fs/git-clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          parent: parent.trim(),
          name: derivedName || undefined,
          token: visibility === "private" && token ? token : undefined,
          branch: branch.trim() || undefined,
        }),
      });

      const cloneData = (await cloneRes.json().catch(() => ({}))) as {
        name?: string;
        path?: string;
      };

      if (!cloneRes.ok) {
        setError(getApiErrorMessage(cloneData, "clone failed"));
        return;
      }

      // 2. create workspace
      const wsName = derivedName || cloneData.name || "repo";
      const wsRes = await fetchWithNamespace("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: wsName,
          path: cloneData.path,
          project: { gitUrl: url.trim() },
        }),
      });

      const wsData = (await wsRes.json().catch(() => ({}))) as {
        workspace?: { id?: string };
      };

      if (!wsRes.ok) {
        setError(getApiErrorMessage(wsData, "workspace creation failed"));
        return;
      }

      onComplete({
        workspaceId: wsData.workspace?.id || wsName,
        workspaceName: wsName,
        workspacePath: cloneData.path || "",
        method: "git",
      });
    } catch {
      setError("clone failed");
    } finally {
      setCloning(false);
    }
  }, [url, parent, derivedName, visibility, token, branch, fetchWithNamespace, onComplete]);

  return (
    <div className="space-y-5">
      <div className="text-center">
        <h2 className="text-lg font-semibold mb-1">Clone a repository</h2>
        <p className="text-sm text-foreground/50">
          pull down an existing git repo
        </p>
      </div>

      {/* URL */}
      <div className="space-y-1">
        <label className="text-xs text-foreground/50">Repository URL</label>
        <div className="relative">
          <GlobalFilled className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-foreground/30" />
          <input
            type="text"
            placeholder="https://github.com/user/repo.git"
            value={url}
            onChange={(e) => handleUrlChange(e.target.value)}
            className="w-full bg-muted rounded-md pl-8 pr-3 py-2 text-sm font-mono focus:outline-none focus:bg-accent placeholder:text-foreground/20"
            autoFocus
          />
        </div>
      </div>

      {/* visibility */}
      <div className="space-y-1">
        <label className="text-xs text-foreground/50">Visibility</label>
        <div className="flex gap-3">
          {(["public", "private"] as const).map((v) => (
            <label key={v} className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="visibility"
                checked={visibility === v}
                onChange={() => setVisibility(v)}
                className="accent-foreground"
              />
              <span className="text-xs text-foreground/70">{v}</span>
            </label>
          ))}
        </div>
      </div>

      {/* private auth */}
      {visibility === "private" && (
        <div className="space-y-3">
          <div className="flex gap-0.5 bg-muted/50 rounded-md p-0.5 w-fit">
            <button
              type="button"
              onClick={() => setAuthMethod("terminal")}
              className={`px-3 py-1.5 rounded text-xs transition-colors ${
                authMethod === "terminal"
                  ? "bg-background text-foreground"
                  : "text-foreground/40 hover:text-foreground"
              }`}
            >
              gh CLI
            </button>
            <button
              type="button"
              onClick={() => setAuthMethod("token")}
              className={`px-3 py-1.5 rounded text-xs transition-colors ${
                authMethod === "token"
                  ? "bg-background text-foreground"
                  : "text-foreground/40 hover:text-foreground"
              }`}
            >
              paste token
            </button>
          </div>

          {authMethod === "terminal" && !ghAuthStarted && (
            <div className="bg-muted/30 rounded-md p-3 space-y-3">
              <p className="text-[10px] text-foreground/40">
                opens a terminal running <span className="font-mono">gh auth login</span>
              </p>
              <button
                type="button"
                onClick={launchGhTerminal}
                className="flex items-center gap-2 px-3 py-2 rounded-md bg-card hover:bg-accent text-xs transition-colors w-full"
              >
                <CommandSquareFilled className="h-4 w-4 text-foreground/50" />
                open terminal & sign in
              </button>
            </div>
          )}

          {authMethod === "terminal" && ghAuthStarted && (
            <div className="flex items-center gap-2 text-xs text-foreground/50 bg-muted/30 rounded-md px-3 py-2">
              <span className="text-green-400">*</span>
              complete the flow in the terminal, then clone
              <button
                type="button"
                onClick={launchGhTerminal}
                className="ml-auto text-[10px] text-foreground/30 hover:text-foreground transition-colors"
              >
                relaunch
              </button>
            </div>
          )}

          {authMethod === "token" && !secretSaved && (
            <div className="bg-muted/30 rounded-md p-3 space-y-2">
              <p className="text-[10px] text-foreground/40">
                provide a personal access token
              </p>
              <SecretForm
                inline
                prefilledPreset="GITHUB_TOKEN"
                onSave={handleSecretSave}
              />
            </div>
          )}

          {authMethod === "token" && secretSaved && (
            <div className="flex items-center gap-2 text-xs text-foreground/50 bg-muted/30 rounded-md px-3 py-2">
              <span className="text-green-400">*</span>
              token saved
              <button
                type="button"
                onClick={() => {
                  setSecretSaved(false);
                  setToken("");
                }}
                className="ml-auto text-[10px] text-foreground/30 hover:text-foreground transition-colors"
              >
                change
              </button>
            </div>
          )}
        </div>
      )}

      {/* clone into */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-xs text-foreground/50">Clone into</label>
          <button
            type="button"
            onClick={() => setShowBrowser((v) => !v)}
            className="text-[10px] text-foreground/40 hover:text-foreground transition-colors flex items-center gap-1"
          >
            <FolderOpenFilled className="h-3 w-3" />
            {showBrowser ? "hide" : "browse"}
          </button>
        </div>
        <input
          type="text"
          placeholder={workspacesDir || "/path/to/parent"}
          value={parent}
          onChange={(e) => {
            setParent(e.target.value);
            setParentManual(true);
          }}
          className="w-full bg-muted rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:bg-accent placeholder:text-foreground/20"
        />
        {showBrowser && (
          <FolderBrowser
            initialPath={workspacesDir}
            onSelect={(p) => {
              setParent(p);
              setParentManual(true);
              setShowBrowser(false);
            }}
          />
        )}
      </div>

      {/* branch */}
      <div className="space-y-1">
        <label className="text-xs text-foreground/50">
          Branch <span className="text-foreground/30">(optional)</span>
        </label>
        <input
          type="text"
          placeholder="main"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          className="w-full bg-muted rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:bg-accent placeholder:text-foreground/20"
        />
      </div>

      {/* workspace name */}
      <div className="space-y-1">
        <label className="text-xs text-foreground/50">Workspace name</label>
        <input
          type="text"
          placeholder="derived from URL"
          value={derivedName}
          onChange={(e) => handleNameChange(e.target.value)}
          className="w-full bg-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:bg-accent placeholder:text-foreground/20"
        />
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-xs text-foreground/40 hover:text-foreground transition-colors"
        >
          <ArrowLeft2Filled className="h-3.5 w-3.5" />
          back
        </button>
        <Button
          onClick={handleSubmit}
          disabled={cloning || !url.trim() || !parent.trim()}
          className="gap-2"
        >
          {cloning ? (
            <>
              <RotateFilled className="h-4 w-4 animate-spin" />
              cloning...
            </>
          ) : (
            <>
              clone & create
              <GlobalFilled className="h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
