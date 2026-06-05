"use client";

import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft2Filled,
  MagicStarFilled,
  FolderOpenFilled,
  RotateFilled,
} from "@aliimam/icons";
import { FolderBrowser } from "@/components/workspace/folder-browser";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { getApiErrorMessage } from "@/lib/api/api-client";

interface NewProjectSetupProps {
  onComplete: (data: {
    workspaceId: string;
    workspaceName: string;
    workspacePath: string;
    method: string;
  }) => void;
  onBack: () => void;
  workspacesDir?: string;
}

export function NewProjectSetup({
  onComplete,
  onBack,
  workspacesDir,
}: NewProjectSetupProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [projectName, setProjectName] = useState("");
  const [parentPath, setParentPath] = useState(workspacesDir || "");
  const [parentManual, setParentManual] = useState(false);
  const [showBrowser, setShowBrowser] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const fullPath =
    parentPath && projectName
      ? `${parentPath.replace(/\/$/, "")}/${projectName}`
      : "";

  useEffect(() => {
    if (workspacesDir && !parentManual) {
      setParentPath(workspacesDir);
    }
  }, [parentManual, workspacesDir]);

  const handleSubmit = useCallback(async () => {
    if (!projectName.trim()) {
      setError("project name is required");
      return;
    }
    if (!parentPath.trim()) {
      setError("parent directory is required");
      return;
    }

    setCreating(true);
    setError("");

    try {
      // 1. create directory
      const mkdirRes = await fetchWithNamespace("/api/fs/mkdir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parent: parentPath.trim(),
          name: projectName.trim(),
        }),
      });

      const mkdirData = (await mkdirRes.json().catch(() => ({}))) as {
        path?: string;
      };

      if (!mkdirRes.ok) {
        setError(getApiErrorMessage(mkdirData, "failed to create directory"));
        return;
      }

      const createdPath = mkdirData.path || fullPath;

      // 2. create workspace
      const wsRes = await fetchWithNamespace("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: projectName.trim(),
          path: createdPath,
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
        workspaceId: wsData.workspace?.id || projectName.trim(),
        workspaceName: projectName.trim(),
        workspacePath: createdPath,
        method: "new",
      });
    } catch {
      setError("failed to create project");
    } finally {
      setCreating(false);
    }
  }, [projectName, parentPath, fullPath, fetchWithNamespace, onComplete]);

  return (
    <div className="space-y-5">
      <div className="text-center">
        <h2 className="text-lg font-semibold mb-1">Start from scratch</h2>
        <p className="text-sm text-foreground/50">
          create a new empty project directory
        </p>
      </div>

      {/* project name */}
      <div className="space-y-1">
        <label className="text-xs text-foreground/50">Project name</label>
        <input
          type="text"
          placeholder="my-project"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          className="w-full bg-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:bg-accent placeholder:text-foreground/20"
          autoFocus
        />
      </div>

      {/* parent directory */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-xs text-foreground/50">Create in</label>
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
          value={parentPath}
          onChange={(e) => {
            setParentPath(e.target.value);
            setParentManual(true);
          }}
          className="w-full bg-muted rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:bg-accent placeholder:text-foreground/20"
        />
        {showBrowser && (
          <FolderBrowser
            initialPath={workspacesDir}
            onSelect={(p) => {
              setParentPath(p);
              setParentManual(true);
              setShowBrowser(false);
            }}
          />
        )}
      </div>

      {/* full path preview */}
      {fullPath && (
        <div className="flex items-center gap-2 bg-muted/30 rounded-md px-3 py-2">
          <FolderOpenFilled className="h-3 w-3 text-foreground/40 shrink-0" />
          <span className="text-xs font-mono text-foreground/60 truncate">
            {fullPath}
          </span>
        </div>
      )}

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
          disabled={creating || !projectName.trim() || !parentPath.trim()}
          className="gap-2"
        >
          {creating ? (
            <>
              <RotateFilled className="h-4 w-4 animate-spin" />
              creating...
            </>
          ) : (
            <>
              create project
              <MagicStarFilled className="h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
