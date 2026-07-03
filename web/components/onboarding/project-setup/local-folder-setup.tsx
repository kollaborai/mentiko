"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft2Filled,
  FolderOpenFilled,
  RotateFilled,
} from "@aliimam/icons";
import { FolderBrowser } from "@/components/workspace/folder-browser";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { getApiErrorMessage } from "@/lib/api/api-client";
import type { Workspace } from "@/lib/workspaces/workspace-storage";

interface LocalFolderSetupProps {
  onComplete: (data: {
    workspaceId: string;
    workspaceName: string;
    workspacePath: string;
    method: string;
  }) => void;
  onBack: () => void;
  workspacesDir?: string;
}

function normalizePath(path: string): string {
  return path.replace(/\/+$/, "") || "/";
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function makeUniqueWorkspaceName(baseName: string, existingWorkspaces: Workspace[]): string {
  const trimmed = baseName.trim() || "workspace";
  const existingIds = new Set(existingWorkspaces.map((workspace) => workspace.id));

  if (!existingIds.has(slugify(trimmed))) {
    return trimmed;
  }

  let suffix = 2;
  while (existingIds.has(slugify(`${trimmed} ${suffix}`))) {
    suffix += 1;
  }

  return `${trimmed} ${suffix}`;
}

export function LocalFolderSetup({ onComplete, onBack, workspacesDir }: LocalFolderSetupProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [selectedPath, setSelectedPath] = useState(workspacesDir || "");
  const [pathManual, setPathManual] = useState(false);
  const [name, setName] = useState("");
  const [nameManual, setNameManual] = useState(false);
  const [existingWorkspaces, setExistingWorkspaces] = useState<Workspace[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const derivedName = nameManual
    ? name
    : selectedPath.split("/").filter(Boolean).pop() || "";

  const selectedWorkspace = useMemo(() => {
    if (!selectedPath) return null;
    const normalizedSelected = normalizePath(selectedPath);
    return existingWorkspaces.find((workspace) => normalizePath(workspace.path) === normalizedSelected) ?? null;
  }, [existingWorkspaces, selectedPath]);

  useEffect(() => {
    if (workspacesDir && !pathManual) {
      setSelectedPath(workspacesDir);
    }
  }, [pathManual, workspacesDir]);

  useEffect(() => {
    let cancelled = false;

    const loadWorkspaces = async () => {
      try {
        const res = await fetchWithNamespace("/api/workspaces");
        const raw = await res.json().catch(() => ({})) as {
          data?: { workspaces?: Workspace[] };
          workspaces?: Workspace[];
        };
        const data = raw.data ?? raw;
        const workspaces = Array.isArray(data.workspaces) ? data.workspaces : [];
        if (!cancelled) {
          setExistingWorkspaces(workspaces);
        }
      } catch {
        // keep the default empty state if the workspace index cannot be loaded
      }
    };

    loadWorkspaces();

    return () => {
      cancelled = true;
    };
  }, [fetchWithNamespace]);

  const handleSelect = (path: string) => {
    setSelectedPath(path);
    setPathManual(true);
    if (!nameManual) {
      setName(path.split("/").filter(Boolean).pop() || "");
    }
  };

  const handleNameChange = (val: string) => {
    setName(val);
    setNameManual(true);
  };

  const submitWorkspace = useCallback(async (workspaceName: string) => {
    if (!selectedPath) {
      setError("select a folder first");
      return;
    }

    setCreating(true);
    setError("");

    try {
      const wsName = workspaceName.trim() || "workspace";
      const res = await fetchWithNamespace("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: wsName, path: selectedPath }),
      });

      const raw = (await res.json().catch(() => ({}))) as {
        data?: { workspace?: { id?: string } };
        workspace?: { id?: string };
      };
      const data = raw.data ?? raw;

      if (!res.ok) {
        setError(getApiErrorMessage(raw, "failed to create workspace"));
        return;
      }

      onComplete({
        workspaceId: data.workspace?.id || wsName,
        workspaceName: wsName,
        workspacePath: selectedPath,
        method: "local",
      });
    } catch {
      setError("failed to create workspace");
    } finally {
      setCreating(false);
    }
  }, [selectedPath, fetchWithNamespace, onComplete]);

  const handleSubmit = useCallback(() => {
    void submitWorkspace(derivedName || "workspace");
  }, [derivedName, submitWorkspace]);

  const handleCreateAnother = useCallback(() => {
    void submitWorkspace(makeUniqueWorkspaceName(derivedName || "workspace", existingWorkspaces));
  }, [derivedName, existingWorkspaces, submitWorkspace]);

  const handleReattach = useCallback(() => {
    if (!selectedWorkspace) return;
    onComplete({
      workspaceId: selectedWorkspace.id,
      workspaceName: selectedWorkspace.name,
      workspacePath: selectedWorkspace.path,
      method: "reattach",
    });
  }, [onComplete, selectedWorkspace]);

  return (
    <div className="space-y-5">
      <div className="text-center">
        <h2 className="text-lg font-semibold mb-1">Use an existing folder</h2>
        <p className="text-sm text-foreground/50">
          browse to a project directory on this machine
        </p>
      </div>

      {/* folder browser as primary UI */}
      <div className="space-y-1">
        <label className="text-xs text-foreground/50">Select folder</label>
        <FolderBrowser
          onSelect={handleSelect}
          initialPath={workspacesDir}
          defaultSortKey="date"
          defaultSortDir="desc"
        />
      </div>

      {/* selected path display */}
      {selectedPath && (
        <div className="flex items-center gap-2 bg-muted/30 rounded-md px-3 py-2">
          <FolderOpenFilled className="h-3 w-3 text-foreground/40 shrink-0" />
          <span className="text-xs font-mono text-foreground/60 truncate">
            {selectedPath}
          </span>
        </div>
      )}

      {/* workspace name - only shown after folder is selected */}
      {selectedPath && (
        <div className="space-y-1">
          <label className="text-xs text-foreground/50">Workspace name</label>
          <input
            type="text"
            placeholder="derived from folder name"
            value={derivedName}
            onChange={(e) => handleNameChange(e.target.value)}
            className="w-full bg-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:bg-accent placeholder:text-foreground/20"
          />
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
        {!selectedWorkspace ? (
          <Button
            onClick={handleSubmit}
            disabled={creating || !selectedPath}
            className="gap-2"
          >
            {creating ? (
              <>
                <RotateFilled className="h-4 w-4 animate-spin" />
                creating...
              </>
            ) : (
              <>
                create workspace
                <FolderOpenFilled className="h-4 w-4" />
              </>
            )}
          </Button>
        ) : (
          <div className="rounded-md bg-muted/30 px-3 py-3 space-y-3">
            <div className="space-y-1">
              <p className="text-xs font-medium text-foreground/80">
                this folder is already registered as
                <span className="ml-1 font-mono text-foreground/60">{selectedWorkspace.name}</span>
              </p>
              <p className="text-[10px] font-mono text-foreground/40 truncate">
                {selectedWorkspace.path}
              </p>
              <p className="text-[10px] text-foreground/40">
                reattach it or create another instance from the same folder.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={handleReattach} disabled={creating} className="gap-2">
                <FolderOpenFilled className="h-3.5 w-3.5" />
                reattach existing
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleCreateAnother}
                loading={creating}
                className="gap-2"
              >
                <RotateFilled className="h-3.5 w-3.5" />
                create another instance
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
