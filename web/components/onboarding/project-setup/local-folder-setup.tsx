"use client";

import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft2Filled,
  FolderOpenFilled,
  RotateFilled,
} from "@aliimam/icons";
import { FolderBrowser } from "@/components/workspace/folder-browser";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { getApiErrorMessage } from "@/lib/api-client";

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

export function LocalFolderSetup({ onComplete, onBack, workspacesDir }: LocalFolderSetupProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [selectedPath, setSelectedPath] = useState(workspacesDir || "");
  const [pathManual, setPathManual] = useState(false);
  const [name, setName] = useState("");
  const [nameManual, setNameManual] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const derivedName = nameManual
    ? name
    : selectedPath.split("/").filter(Boolean).pop() || "";

  useEffect(() => {
    if (workspacesDir && !pathManual) {
      setSelectedPath(workspacesDir);
    }
  }, [pathManual, workspacesDir]);

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

  const handleSubmit = useCallback(async () => {
    if (!selectedPath) {
      setError("select a folder first");
      return;
    }

    setCreating(true);
    setError("");

    try {
      const wsName = derivedName || "workspace";
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
  }, [selectedPath, derivedName, fetchWithNamespace, onComplete]);

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
      </div>
    </div>
  );
}
